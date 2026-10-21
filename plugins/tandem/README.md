# tandem

[![CI](https://github.com/bgmacris/quimera-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/bgmacris/quimera-ai/actions/workflows/ci.yml)

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
> detection + **executable locators** (`sel:`) to act **without reading a snapshot to find the element**,
> with a fingerprint gate that makes skipping the snapshot honest.

## What it is for — and what was measured

tandem is for work where **a human and Claude share one browser**: you clear what only you can
(captchas, anti-bot checkpoints, 2FA, client certificates, AutoFirma), Claude does the rest in the same
window, and what it learns about the site is kept as a profile you can read and edit.

It is **not** a context-saving tool any more, and we measured that:

- **WebArena-Verified mini-pilot (2026-10-21)**: Magento admin, 3 task templates × 4 instances × 4
  arms (A snapshot · B `browser_find` · C + site profile · D + recipes), Sonnet, @playwright/mcp 0.0.83.
  **48/48 tasks succeeded in every arm** — these templates were too easy to separate the arms by success.
- With a warm profile (instances 3–4) the agent **read 4–7× less of the page**: 2.3–3.6 KB per task
  (C, D) vs 10–24 KB (A, B).
- It did **not** make tasks cheaper: B (no memory) was the cheapest arm, 0.060 $/task vs 0.072 (C)
  and 0.076 (D). Fixed overhead (system prompt, turns) dominates the cost; C/D only broke even with B
  from the third instance. One site, one run per cell, machine load varied — an indication, not a law.
- Why the old gap closed: since 0.0.78 the MCP distills its snapshots and adds `browser_find`. On that
  admin a snapshot was ~5 KB (one measured task), not the ~105 KB measured on 0.0.76.

Historical (0.0.76, 2026-06-29, bytes only): profile ↔ snapshot ~16–30× smaller, a targeted extraction
vs its snapshot ~110× ([`docs/01`](docs/01-navigation-memory.md)). Kept for the record; not a current claim.

**Open question, not answered yet:** whether site memory raises *success* on hard sites (long
navigation, ambiguous pages). That needs a pilot with templates where the plain arms fail.

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
- **Executable locators (`sel:`)** — *maintained, frozen*: no new features until a measurement shows
  they raise success (see above). The profile doesn't just *describe* locators, it makes them
  *actionable*. The agent clicks/types by durable selector (`role=button[name="…"]`) **without first
  reading a snapshot to get refs**. Where the saving is: an action's own result is small either way
  (with `--output-dir` the MCP files its page snapshot and returns ~0.2–0.3 KB — measured by an external
  review); what a known locator avoids is the snapshot READ needed to find the element (KBs to tens of
  KBs). Skip it only when the route's fingerprint returns `match` (a gate, not faith).
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

Via the **quimera-ai** marketplace for Claude Code:

```
/plugin marketplace add bgmacris/quimera-ai
/plugin install tandem@quimera-ai
```

Requires Google Chrome (or Chromium) and Node 22+ (native `WebSocket`/`fetch` used by the CDP
commands `cookies`/`intercept`/`pdf`, no external deps; `npx` launches the Playwright MCP).

## Quickstart — a real 2-minute run

On `books.toscrape.com` (a public scraping sandbox, no login), reproducing exactly the profile
shipped in [`examples/`](examples/books.toscrape.com.md):

1. `/tandem:browser-start` — the shared window opens.
2. Ask Claude, in plain words:
   > "Navigate to books.toscrape.com and recon it: the route skeleton, the locator for a book pod,
   > and how pagination works. Then propose a `tandem:map` profile."

   Claude explores the rendered DOM, drafts the profile, you confirm, and it is saved to
   `~/.claude/tandem/sites/books.toscrape.com.md` (compare it with `examples/`).
3. Next time you navigate there, the profile **auto-injects**; Claude acts by durable `sel:` (e.g.
   extract all 20 book pods of a page) without first re-deriving the page.
4. `/tandem:browser-stop`.

If a site puts up a captcha or a login, you clear it with the mouse in that same window and Claude
continues from the already-rendered page — that is the human-in-the-loop handoff.

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
| `TANDEM_AUTOSTART` | on (off under WSL) | `1`/`0`: start tandem's Chrome automatically on the first `browser_*` call. Off by default under WSL, where the browser is often an external Windows Chrome |
| `TANDEM_MCP_ARGS` | — | extra `@playwright/mcp` flags, appended last so they override tandem's defaults (`--output-max-size 52428800 --timeout-action 10000`), e.g. `--image-responses omit` |
| `TANDEM_CHROME_ARGS` | — | extra Chrome flags (e.g. `--headless=new` for unattended runs/CI) |
| `TANDEM_CDP_PORT`   | `9222` | CDP port on loopback. Wins over the port saved by the last start (`cdp-port`); set it where Claude Code gets its env (shell or settings `env`) so the MCP, commands and hooks all see it |
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

## Troubleshooting

- **`File access denied … outside allowed roots`** when passing `filename` to a browser tool: @playwright/mcp
  only writes files under the output dir (`~/.claude/tandem/output/`)
  or the MCP's workspace root. Use an absolute path inside the output dir, or omit `filename`.
- **`ECONNREFUSED 127.0.0.1:9222`** means no Chrome is running → `/tandem:browser-start`.

## Development

Before publishing or after touching the shell/JS, two checks (neither starts Chrome):

```
tests/smoke.sh                                   # tandem:map engine + regression guards
shellcheck -x -S style scripts/*.sh bin/* tests/*.sh   # shell lint (brew install shellcheck)
```

CI (`.github/workflows/ci.yml`) runs both on every push/PR — `smoke.sh` on `ubuntu-latest` and
`macos-latest`, `shellcheck` on `ubuntu-latest`.

`smoke.sh` isolates state in a temporary `TANDEM_DATA_DIR` and verifies: parsing of all
scripts, the `+x` bit on the invocables, `map.sh` (including `index` with valid JSON even when the
frontmatter has quotes), `fingerprint` (capture/check/drift and **rejection of a host with
traversal**), and the injection hook (silent without a profile · once-per-session · cleanup).
The real start/stop of Chrome needs a display and is tested by hand: `/tandem:browser-start`
→ `/tandem:browser-status` → `/tandem:browser-stop`.

## Requirements and scope

- **macOS**: supported and tested (CI + manual).
- **Linux**: supported. Engine tests, shellcheck and a real headless-Chrome e2e (daemon, recorder,
  intercept over several tabs, cookies, pdf, external mode) run in CI on `ubuntu-latest`.
- **Windows native** (people do run it): the MCP launcher is node (`scripts/mcp-launch.mjs`, no more
  hand-patched `.mcp.json`), and the engine + MCP handshake run in CI on `windows-latest`. The browser
  lifecycle (`lib.sh`) runs in Git Bash and is **best effort** — Chrome is autodetected under Program
  Files / LocalAppData but start/stop is not verified there. Reliable option: start Chrome yourself and
  use **external browser mode** (below).
- **WSL2**: behaves as Linux. If the browser is the **Windows** Chrome reached over mirrored networking,
  use external browser mode — tandem's own start would open a Linux Chrome instead (autostart is off
  under WSL by default for that reason).

### External browser mode

`TANDEM_BROWSER=external`: tandem never launches or kills a browser; it only talks to the CDP port.
`browser-start` checks that something answers, `browser-stop` and `SessionEnd` leave it alone,
`status` says `mode: external`. To delegate the lifecycle (e.g. a script that starts the Windows
Chrome with its certificates), set `TANDEM_BROWSER_START_CMD` / `TANDEM_BROWSER_STOP_CMD` (run with
`sh -c`); with a start command, autostart uses it.
- Google Chrome or Chromium · Node 22+ · Claude Code v2.1.120+.
