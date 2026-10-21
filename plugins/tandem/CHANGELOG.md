# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/); semantic versioning.

## [Unreleased]

From real usage (two teammates on 0.6.0, 1.903 + 1.846 tool calls): the site profile never reached the
model whole — a 26 KB profile became a 2 KB preview on every navigate — and one `localhost` profile
mixed 9 different local apps.

### Added
- **Profile index** (`scripts/profile.mjs`): a profile ≤ 6,000 chars is injected whole; a bigger one
  as an INDEX ≤ 2,000 chars (frontmatter, sections with sizes, recipe signatures, routes) with the
  absolute command to fetch a section. Instruction-like lines are still searched in the whole profile.
  Real 26 KB profile → 2.4 KB of context that describes all of it (was a 2 KB arbitrary cut).
- `map.sh show <key> --section "<title>"` and `map.sh sections <key>`.
- `scripts/cdp-record.mjs`: records ALL tabs of tandem's Chrome to a HAR 1.2 file (browser-level
  `Target.setAutoAttach`, one connection, no collision with Playwright). Each redirect hop is its own
  entry; request headers from `requestWillBeSentExtraInfo` (sec-fetch-*, referer); Set-Cookie of
  redirect hops matched by `statusCode` (an ExtraInfo can arrive after the next hop: 3 of 4 runs).
  Validated against WebArena-Verified's HAR parser (redirect, POST form, JSON body, new tab).
- `scripts/cdp.mjs` (shared CDP client with timeouts, flattened sessions) and `scripts/har.mjs`
  (pure CDP→HAR, `tests/har.test.mjs`).
- `bench/webarena/` (repo root): benchmark harness — arms A–D, isolated `claude -p` per task,
  HAR + metrics per task, report by arm and by instance within template.
- `tests/e2e.sh`: real Chrome end-to-end (daemon, recorder, intercept over several tabs, cookies,
  pdf/png) + a headless CI job. `TANDEM_CHROME_ARGS` passes extra Chrome flags (e.g. `--headless=new`).

### Changed
- **Profile key includes a non-default port**: `localhost:5184` → `localhost_5184` (`_`, not `:`, which
  Windows forbids in filenames). Reads fall back to the legacy port-less profile/fingerprints, so
  existing profiles keep working; new ones are written per port. `host.test.mjs` updated (the old
  "port discarded" rule was a deliberate decision, now revised).
- **intercept**: `start` runs the capture as a background daemon and returns at once (it used to
  block the slash command until Ctrl-C); new `stop`/`status`; captures **all tabs** with the shared
  engine `scripts/capture.mjs` (also used by `cdp-record`): redirect hops shown (`→ <url>`).
- **pdf**: real PDF by default — `Page.printToPDF` works on headful Chrome now (verified, Chrome 155);
  `--png` is a full-page capture that no longer resizes the human's window; captures the visible,
  focused tab instead of whatever `/json` lists first.
- **cookies**: whole jar via browser-level `Storage.getCookies` (no tab needed); `--domain` matches
  the domain and its subdomains on a label boundary (`example.com` ≠ `notexample.com`; IPs exact);
  warns when `curl`/`headers` merge several domains into one Cookie header.
- The three CDP tools share `scripts/cdp.mjs` (timeouts on connect and calls).
- CI: Node 22/24/26 matrix, shellcheck over install.sh and adapters, adapter + bench parse checks.

### Fixed
- New tabs: the capture now pauses them until Network is on (their document request was missed),
  sending enable + resume together (awaiting enable on a paused tab deadlocked it at about:blank).
- CLIs piped into `grep -q`/`head` crashed with EPIPE.

## [0.8.0] — 2026-10-20

Foundations: several sessions sharing one Chrome, one data dir for every IDE, and the site-profile
memory hardened against poisoning (writes gated outside the model, reads marked as data).

### Added
- **Write gate for site profiles** (`scripts/guard-sites.mjs`, PreToolUse on Write/Edit/MultiEdit/Bash):
  a write to `sites/*.md` becomes a permission prompt for the human. Rationale: profiles are re-injected
  in every later session, and memory-poisoning research (PMPA, arXiv 2609.13889, tested on Claude Code)
  shows prompt-level defenses barely help once memory is poisoned. Verified that `bypassPermissions`
  does not auto-approve a hook's `ask`. Bash coverage is heuristic (defense in depth).
- **Session leases** (`scripts/session-hook.mjs`): each session that uses a `browser_*` tool holds a
  lease; SessionEnd stops Chrome only when no other live lease remains (12 h TTL for crashed sessions).
  Also in the Cursor adapter.
- Re-injection after compaction: SessionStart(`compact`) clears the session's injection markers.
- `scripts/paths.mjs`: single node-side source for data dir and CDP port. `scripts/redact.mjs`.
- `tests/lifecycle.test.mjs` (31 cases) + hooks.json integrity checks in `smoke.sh`.

### Changed
- **One data dir for all IDEs**: the Cursor/OpenCode adapters default to `~/.claude/tandem` (was
  `~/.local/share/tandem`, same port → silent wrong profile + split site memory). `install.sh` migrates.
- Injected profile wrapped as DATA with provenance (`<tandem-site-profile>`), capped at 9,000 chars
  (Claude Code moves additionalContext over 10,000 chars to a file, leaving a 2,000-char preview),
  and instruction-like lines are surfaced with a warning instead of passed silently.
- `browser-start` refuses a CDP on the port that is not tandem's own profile; `status` flags it.
- Port precedence: `TANDEM_CDP_PORT` now beats the `cdp-port` file (it used to be ignored once the
  file existed, while the error message recommended it). Same rule in bash and node.
- `stop` waits for Chrome to exit (SIGKILL after ~5 s); `restart` no longer races the profile lock.
- Data dir is `0700`; intercept log is `0600` and redacts Authorization/Cookie/CSRF headers unless
  `start --reveal`.
- Skill: the profile is "separate", not "clean" — it holds every login done in it.

### Fixed
- Injection marker was written before reading the profile (a failed read marked the host as done).

## [0.7.0] — 2026-10-20

Catch-up with @playwright/mcp (seven releases behind) + the Cursor/OpenCode adapters.

### Added
- **Cursor and OpenCode adapters** (`adapters/`, `install.sh`, `README.adapters.md`) — contributed by
  @OriolFiblaSancho (PR #1). Profile-injection logic shared by all IDEs in `scripts/map-inject-core.mjs`.

### Changed
- @playwright/mcp pinned **0.0.76 → 0.0.83**. Brings `browser_find` (search the snapshot, return only
  matching nodes) and distilled snapshots; documented in the `tandem` skill and the subagent.
- MCP launched with `--no-webmcp` (tools a page registers via WebMCP are untrusted input) and
  `--file-paths absolute`.
- README figures (16–30×, ~18×) now carry an explicit caveat: bytes measured vs 0.0.76, not task
  success; re-measurement pending.

### Removed
- The "retry once after `stop`→`start`" workaround (skill, `browser-start`, subagent, READMEs,
  OpenCode prompt). 0.0.79 reconnects to a restarted Chrome on its own — verified 2026-10-20 with a
  stdio MCP client: 0.0.76 fails the first call after restart (`Target page, context or browser has
  been closed`), 0.0.83 passes it (2/2 runs).
- `UPSTREAM.md`: written for a fork workflow; the adapters now live in this repo.

### Fixed
- Skill rule for `filename`: the MCP only writes under the output dir or its workspace root ("File access
  denied … outside allowed roots") — verified on 0.0.76 too, so the old "use any absolute path" advice
  was already wrong (real usage logged 15 such errors on 0.0.76).

## [0.6.0] — 2026-06-26

Direct-CDP commands (`cookies`, `intercept`, `pdf`): they capture what page JS
can't reach (HttpOnly, response bodies) without going through Playwright. + hardening.

### Added
- `scripts/cdp-cookies.mjs` + `bin/tandem-cookies` + `commands/cookies.md`: exports all of
  tandem's Chrome cookies via direct CDP (`Network.getAllCookies`), including HttpOnly and
  Secure (inaccessible from page JS). Formats: `list` (table), `json`, `curl`, `headers`,
  `netscape`. Filter by `--domain`. No external dependencies (native WebSocket + fetch, Node 22+).
- `scripts/cdp-intercept.mjs` + `bin/tandem-intercept` + `commands/intercept.md`: an HTTP sniffer
  that captures request+response bodies of the active tab via CDP (`Network.enable` + `getResponseBody`
  + `getRequestPostData`). Subcommands `start/show/clear/count`. Filters by URL, method, status,
  mime. 32KB cap per body. NDJSON persistence in `~/.claude/tandem/intercept.ndjson`.
- `scripts/cdp-pdf.mjs` + `bin/tandem-pdf` + `commands/pdf.md`: captures the current page as a
  PDF (`Page.printToPDF`, requires `--headless`) with automatic fallback to a full-page PNG screenshot
  via `Page.captureScreenshot` + `Page.getLayoutMetrics` + `Emulation.setDeviceMetricsOverride`
  (always works in tandem's headful mode). Output prefixed `pdf:` or `png:` so the
  agent knows which format was produced.

### Security
- `norm()` in `page-signals.mjs`: added a printable-ASCII filter (`\x20-\x7E`) and a 120-character
  cap per signal. Closes the stored-prompt-injection vector via DOM → profile → context.
- `hook-inject-profile.mjs`: sanitizes the `session_id` from the input JSON before using it as a
  path component (`rmSync`). Closes path traversal via a `session_id` with `..`.
- `fingerprint.mjs`: atomic write (`writeFileSync` to `.tmp` + `renameSync`) to avoid silent
  loss of fingerprints from an interrupted write.

## [0.5.0] — 2026-06-22

Executable recipes: *procedural memory* over the `sel:` values.

### Added
- Profile recipes are PARAMETERIZED and executable (flat-YAML format under `## Recipes`), replacing
  the numbered prose. `scripts/recipe.mjs` (+ `tests/recipe.test.mjs`) parses, validates, and compiles them.
- Two execution modes (hybrid): `--step` (steps the agent runs with the tools, observable,
  safe default) and `--fast` (a Playwright function in 1 tool call via `browser_run_code_unsafe`).
  `recipe.mjs` compiles; the agent executes. Wired into `smoke.sh` §8 → 49 asserts.
- v1 actions: `navigate`, `type`, `click`, `wait-url`, `return`/`extract`.

### Security
- `browser_run_code_unsafe` is RCE-equivalent. Layered defense: only recipes from the co-curated store;
  data (args) enters via `JSON.stringify` (inert); the `sel:` template is escaped per-engine
  (reuses `selector.mjs`); `assertCompiledSafe` validates the skeleton against an allowlist; mandatory
  dry-run before `--fast`. An injection test verifies that a hostile payload stays inert.

## [0.4.0] — 2026-06-22

Token-frugal navigation: the profile makes the locators **executable**.

### Added
- `sel:` field (optional) per locator in `sites/<host>.md`: a Playwright selector the agent passes
  as `target` to act **without `browser_snapshot`**. Instance (direct) vs template (a slot
  the recipe fills, for class locators like rows).
- `scripts/selector.mjs` + `tests/selector.test.mjs`: generates the `sel:` with the correct escapes
  (quotes, regex metacharacters, `/` delimiter) so the syntax isn't typed by hand.
  Wired into `smoke.sh` §7 → 47 asserts.
- Frugal flow in `skills/map` and `skills/tandem`, **tied to `fingerprint.mjs check`** as a gate
  (skip the snapshot only if the route returns `match`; `wait_for` on deferred-render SPAs).

### Changed
- `skills/map`: the re-check reflex no longer says "confirm with a targeted `browser_snapshot`" but
  "validate with `fingerprint check`" — cheaper, and it tells you which locator changed. Reconciles the
  contradiction with the frugal flow.

### Measurement (verified, reproducible method)
- A `browser_snapshot` of the tree weighs **~18×** the whole profile: `wc -c` → Wikipedia snapshot
  105,571 B (~26k tok, ÷4) vs a real site profile 5,581 B (~1.4k tok). The profile is injected 1×/session;
  the snapshot was repeated per action. A task-equivalent measurement (needs login) is left for v2.

## [0.3.0] — 2026-06-22

Pre-release hardening: code audit + closing findings + tests.

### Changed
- `mcp-launch.sh`: the Playwright MCP version is now **pinned** (`@playwright/mcp@0.0.76`)
  instead of `@latest`, which left each launch at the mercy of a different version (silent
  breakage + supply-chain surface). Override with `TANDEM_MCP_VERSION`.
- `map.sh index`: the JSON is serialized with node instead of concatenating strings, so a frontmatter
  with quotes or a backslash no longer breaks `index.json`.

### Added
- `scripts/page-signals.mjs`: **single source** of the page fingerprint (the canonical evaluate
  previously lived as a snippet in the skill). `norm` + `collectSignals` defined once;
  `page-signals.mjs print` emits the self-contained blob for `browser_evaluate`, serialized from
  those same functions (it can't diverge from the tested code).
- `tests/smoke.sh`: a smoke test of the `tandem:map` engine without starting Chrome (parsing, `+x`
  bit, `map.sh`, `fingerprint` with E2E drift, injection hook) — 45 asserts.
- `tests/page-signals.test.mjs`: 19 asserts over `norm`/`collectSignals` with a targeted mock DOM,
  dedup, and blob↔function consistency.

### Fixed
- `fingerprint.mjs`: the `argv` host went raw into the store path → **path traversal** when
  capturing/reading. It now normalizes like `map.sh` and requires a plausible hostname.
- `fingerprint.mjs`: the executable bit (`+x`) was missing; the skill invokes it by direct path, so
  in production it failed with `rc=126`. The smoke test caught it.
- `lib.sh`: unused retry counter (`i`→`_`).

### Tooling
- `shellcheck -x -S style` clean across all the shell. README §Development documents how to run
  the checks (none start Chrome; the real Chrome cycle is tested by hand).

## [0.2.0] — 2026-06-22

- Publishing prep and **Linux support** (Chromium autodetection via PATH; port status
  with `lsof` or, failing that, `ss`). macOS supported and tested; Linux without CI yet.
