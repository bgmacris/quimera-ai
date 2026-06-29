# tandem

A Chrome browser **shared in real time** between you and Claude Code that **learns how each site
is navigated**. One window: you drive it with the mouse (and clear captchas, anti-bot checkpoints,
2FA logins); Claude operates over CDP via the [Playwright MCP](https://github.com/microsoft/playwright-mcp)
(reads the rendered DOM, runs JS, takes snapshots, inspects the network). And with `tandem:map`, Claude
remembers each site's skeleton, locators, and recipes so it navigates *knowingly* instead of
re-deriving the DOM every time.

> **Honest framing.** The shared browser is wiring of existing parts (Chrome + CDP + Playwright MCP)
> made ready for human-in-the-loop. And it's not virgin territory: by 2026 there's already
> cross-session site memory (e.g. WebCoach), *semantic locators* by role+name as standard practice, and
> human handoff for captcha/login (AuthRelay, Cloudflare Browser Run, BrowserAct). tandem's difference
> isn't inventing a new piece: it's **where the whole thing lives** — local, on the **same real Chrome
> you see and touch**, native to the terminal/Claude Code, with a **co-curated, human-readable** site
> memory (`sites/<host>.md` in markdown you edit and commit, not an opaque store nor a cloud SaaS). On
> top of that, `tandem:map` adds what is genuinely hard to find combined: structural-signal drift
> detection + **executable locators** (`sel:`) to act **without re-snapshotting** (~18× less per
> action, measured), with a fingerprint gate that makes skipping the snapshot honest.

## What sets it apart: `tandem:map`

Operating a known site normally costs a huge `browser_snapshot` every time, with ephemeral refs that
change between pages. `tandem:map` persists a **per-site profile**
(`~/.claude/tandem/sites/<host>.md`, outside git) with:

- **Route skeleton** and **durable locators** anchored by role+name from the accessibility tree
  (not by fragile refs nor position), multi-anchor.
- **Recipes** for navigation and **gotchas**, each line dated and tagged `[verified]`/`[hypothesis]`.
- **Auto-injection**: when you navigate to a host with a profile, a `PostToolUse` hook injects the
  profile into Claude's context — once per session, silent if there's no profile.
- **Drift by signal, not by date**: a fingerprint of the *skeleton* (not the data) detects when a
  page's structure changed, so only what's affected gets re-validated.
- **Executable locators (`sel:`)**: the profile doesn't just *describe* locators, it makes them
  *actionable*. The agent clicks/types by durable selector (`role=button[name="…"]`) **without
  re-snapshotting** — a tree snapshot weighs ~18× the whole profile. Skip it only when the route's
  fingerprint returns `match` (a gate, not faith).
- **Executable recipes** (*procedural memory*): repeated, named tasks (`open-ticket-by-id
  TCK-2026-123`) live as **parameterized** recipes that compile to observable steps (`--step`) or to a
  single-tool-call Playwright function (`--fast`). Co-curated and human-readable.

The design and the research behind it: [`docs/01-navigation-memory.md`](docs/01-navigation-memory.md).

## Architecture

```
Chrome (headed, dedicated profile, --remote-debugging-port on 127.0.0.1)
   ▲ mouse (human)                ▲ CDP (Claude)
   └── visible window             └── npx @playwright/mcp --cdp-endpoint → browser_* tools
```

- **`scripts/chrome-daemon.sh`** `{start|stop|restart|status}` — Chrome lifecycle, idempotent,
  based on the CDP healthcheck (the source of truth for state is CDP, not the PID).
- **`scripts/mcp-launch.sh`** — the `.mcp.json` command; only launches the Playwright MCP (lazy, it
  doesn't start Chrome, so `initialize` never blocks).
- **`scripts/map.sh`**, **`scripts/fingerprint.mjs`**, **`scripts/page-signals.mjs`**,
  **`scripts/selector.mjs`**, **`scripts/recipe.mjs`**, **`scripts/hook-inject-profile.mjs`** —
  the `tandem:map` engine (profile store, page fingerprint, drift, executable selectors,
  recipes, auto-injection). `page-signals.mjs print` emits the canonical evaluate; `selector.mjs`
  generates the `sel:` values; `recipe.mjs compile` compiles recipes to Playwright (`--fast`) or steps (`--step`).
- **`skills/`** — `tandem` (how to operate the shared browser) and `map` (site memory).
- **`agents/web-navigator.md`** — subagent for heavy extraction without polluting the main context.

## Installation

Via the **quimera** marketplace for Claude Code:

```
/plugin marketplace add bgmacris/quimera
/plugin install tandem@quimera
```

Requires Google Chrome (or Chromium) and Node 18+ (`npx` launches the Playwright MCP).

## Usage

1. `/tandem:browser-start` — opens the shared window.
2. Ask Claude to navigate/analyze. If a wall requires a human, you clear it with the mouse and Claude
   continues from the already-rendered DOM.
3. The first time you navigate to a site, if there's a `tandem:map` profile, it loads on its own. To
   create one: ask Claude for a recon (it explores → proposes a draft → you confirm → it's saved).
4. `/tandem:browser-status` · `/tandem:browser-stop`.

## Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `TANDEM_CHROME_BIN` | autodetect (macOS/Linux) | path to the Chrome/Chromium binary |
| `TANDEM_CDP_PORT`   | `9222` | CDP port on loopback |
| `TANDEM_DATA_DIR`   | `~/.claude/tandem` | Chrome profile, logs, and site profiles |

## Security

- **Dedicated** profile at `${TANDEM_DATA_DIR}/chrome-profile` — never your personal Chrome.
- CDP on **loopback** (`127.0.0.1`), no auth: any local process controls the browser while it's
  alive → keep it short-lived, close with `/tandem:browser-stop` and on `SessionEnd`.
- The profile accumulates cookies/tokens from logins: treat it as a secret, outside git and backups.
- `tandem:map` profiles store **structure** (routes, locators), never sensitive data, and live
  outside git by default.
- `browser_evaluate`/`browser_run_code_unsafe` run arbitrary JS on the page: for analysis,
  not for destructive actions nor exfiltration.

## Development

Before publishing or after touching the shell/JS, two checks (neither starts Chrome):

```
tests/smoke.sh                                   # tandem:map engine + regression guards
shellcheck -x -S style scripts/*.sh bin/* tests/*.sh   # shell lint (brew install shellcheck)
```

`smoke.sh` isolates state in a temporary `TANDEM_DATA_DIR` and verifies: parsing of all
scripts, the `+x` bit on the invocables, `map.sh` (including `index` with valid JSON even when the
frontmatter has quotes), `fingerprint` (capture/check/drift and **rejection of a host with
traversal**), and the injection hook (silent without a profile · once-per-session · cleanup).
The real start/stop of Chrome needs a display and is tested by hand: `/tandem:browser-start`
→ `/tandem:browser-status` → `/tandem:browser-stop`.

## Requirements and scope

- **macOS**: supported and tested.
- **Linux**: Chromium autodetection implemented (uses `lsof` or `ss`); **not tested in CI** yet.
- **Windows**: not supported (the lifecycle is bash/POSIX).
- Google Chrome or Chromium · Node 18+ · Claude Code v2.1.120+.
