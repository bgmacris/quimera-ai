# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/); semantic versioning.

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
