# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/); semantic versioning.

## [Unreleased]

## [0.9.7] — 2026-10-30

### Added
- **PDFs that reach the agent's tab are saved as they arrive — form POSTs and downloads included** (T297,
  research R07). Chrome's PDF viewer is opaque to the MCP (snapshot 0 bytes, find nothing, evaluate an empty
  `<body>`), and afterwards a PDF can't always be had back: the HTTP cache keeps no POST response, a GET to
  the same URL returns another document, and the Network domain — so HAR and `tandem-intercept` — sees the
  viewer's HTML stub, not the PDF (Chrome swaps the body; measured). The Fetch domain at the Response stage
  does see the real bytes. The launcher (which already follows the agent's tab for focus emulation) now
  intercepts documents in that tab while its tools run (+ the 15 s linger); a 2xx `application/pdf`, or an
  `attachment` named `*.pdf`, is written to `output/pdf/` and the proxy appends `### tandem: PDF captured`
  with the path to that tool call's result (or the next one). The response goes on unchanged: the human sees
  the PDF in the viewer as before. Measured: +3 ms per navigation; if the launcher dies with a response
  paused, Chrome lets it through. The agent reads the file with the Read tool (pages as images) or
  pdftotext — no new dependency. The agent's tab only, as decided; `TANDEM_PDF_CAPTURE=0` turns it off.
  Also covered: iframes (same- and cross-origin), `<embed>`/`<object>`, a PDF framed inside a cross-origin
  iframe (child iframes are auto-attached and armed before they run; a paused child resumes if the
  launcher dies — measured), and **`blob:` PDFs** a page makes — `URL.createObjectURL` is wrapped (a Proxy
  over the native: `toString` still reads `[native code]`) in the agent's tab, and a blob typed as PDF, or an
  untyped one whose first 5 bytes (a synchronous Range read, ~12 ms on 20 MB) are `%PDF-`, is read at once —
  it dies with its page; an asynchronous sniff lost that race on an 8 MB blob (measured) — and handed over
  through a CDP binding; what comes that way is page-controlled, so only a blob: URL of the exact form with
  `%PDF-` bytes, under the size and count caps, is written. Cost measured on a 4 MB blob: ~200 ms.
  The tab-following cycle is now shared (`scripts/agent-tab.mjs`) by focus emulation and the capture.
  When the last URL a result showed matches no tab (the session's first call with several tabs, or the
  tab moved on its own: a script navigation, a blob:, a redirect, the human), the proxy asks the MCP
  itself (`browser_tabs list`, an id of its own, the answer never reaches the client) which tab is the
  agent's. That answer marks the tab's change as reported inside the MCP, so when the tab moved the proxy
  gives the agent's next result the `### Page` URL it would otherwise have lost (tab drift keeps warning).
  The tab is now followed on any URL scheme (`extractTabUrl`), not only http(s). `TANDEM_DEBUG=1` logs
  what the launcher does to its stderr.
- **`tandem-pdf` on a tab that shows a PDF saves the original** (`pdf-source:<path>`) — for PDF tabs opened
  before the capture or by the human: from Chrome's HTTP cache (`Page.getResourceContent`), else a same-URL
  `fetch()` checked to be a PDF. `--url <url>` picks the agent's tab; `--text` adds a `pdftotext -layout`
  copy. When a result shows a `.pdf` tab that was not captured, the proxy says how to get it.
  Tests: `tests/pdf-capture-e2e.mjs` (e2e [3e], the real MCP: the session's first call with several tabs,
  POST, GET, download, blob: in a new tab and in the same tab, a PDF inside a cross-origin iframe, forged
  binding calls writing nothing, ordinary pages untouched), PDF steps in `tests/e2e.sh` [3], unit tests in
  `tests/focus.test.mjs` (proxy notes and probe, detection, file names).

### Fixed
- **`tandem-pdf` on a PDF tab printed Chrome's viewer frame** ("doc.pdf 1/1"), not the document, and said
  nothing. Now it saves the original, or fails with the reason.

### Known limits
- Not captured: what arrives outside the agent's tools' run + 15 s (the scope chosen); a blob URL made inside a
  worker (a worker's blob turned into a URL by the page is captured); a blob made before the capture armed
  (the page loaded while the agent wasn't working). A POST-generated PDF missed that way can't be had
  afterwards. While the tab is held, an exact comparison can tell the wrapper from the native
  (`function () { [native code] }` vs `function createObjectURL() { [native code] }`). Chrome's viewer holds
  the bytes but hands its stream out once (`mimeHandlerPrivate.getStreamInfo`) — not a route.

## [0.9.6] — 2026-10-30

Findings of the two real-use benchmarks of 2026-10-30.

### Added
- **The agent is told when its tab moved without it asking** (`scripts/tab-drift.mjs`). Nobody owns a
  tab: in the Reddit task two clicks by the human took the agent's tab to another page mid-measure, and
  the agent noticed only because one of them opened a new tab. @playwright/mcp does print the new
  `### Page` URL in the next result, but unmarked in the middle of the output. The PostToolUse hook now
  remembers where the tab is after each browser call; when a call that only reads (snapshot, evaluate
  without navigation code, wait_for…) finds it on another URL (hash ignored), it adds a warning to the
  model's context. Changes within 15 s of the agent's own move are taken as its late effects (a redirect
  after a click) — a human click inside that window goes unreported. `TANDEM_TAB_DRIFT=0` turns it off.
  The remembered URL is the one the sandbox guard uses, now the tab's real URL (after redirects) and
  updated by read tools too. Claude Code only; the Cursor/OpenCode adapters don't run it. Tests:
  `tests/drift.test.mjs`, and `tests/drift-e2e.mjs` (e2e [3d]: another CDP client moves the tab, the real
  MCP's next `browser_evaluate` carries the new URL, the warning names both).
- **`type-slowly` recipe step**: key by key (`pressSequentially` in `--fast`, `browser_type slowly:true`
  in `--step`), for autocompletes that need real key events (Renfe's station field).

### Fixed
- **Profiles with Spanish section names had no recipes or locators, silently**: `## Recetas` and
  `## Localizadores` are now read like `## Recipes` / `## Locators`; and `recipe.mjs validate` no longer
  exits 0 with no output when it found no recipe — it says whether the section is missing or empty.
- **`selector.mjs --regex` escaped a template slot** (`{dia}` → `\{dia\}`, no longer a slot), so regex
  templates had to be written by hand. Slots are kept; an anchored trailing slot gets `(?!\w)` (not
  `\b`, which never matches after a value ending in `:`). Checked in Chrome.
- **Read-only Bash commands asked to approve a profile write**: `node fingerprint.mjs check …; md5 -q
  sites/*.fingerprints.json` matched the heuristic (it mentions the store and runs `node`). The command is
  now judged per pipeline segment, with known readers (`fingerprint.mjs`, `md5`, `shasum`, `jq`, `cd`…)
  skipped unless redirected. The bypass-mode notice no longer says the profile "was written" from a
  PreToolUse hook — nothing is written yet.
- **The sandbox guard's deny offered `browser_snapshot` first**: on a long text file it flattens the text
  and cuts it at ~1.5 KB; `fetch()` from a normal page reads it whole. Now `fetch()` comes first.

## [0.9.5] — 2026-10-30

### Fixed
- **A click on a background tab, a covered or a minimized window hung until `--timeout-action` (10 s)**,
  with one session too: @playwright/mcp connects with `noDefaults`, which skips Playwright's
  `Emulation.setFocusEmulationEnabled`; Chrome then stops painting the page and the click's "stable" check
  waits for animation frames forever. Same if the human switches tabs while the agent works. The MCP
  launcher is now a transparent stdio proxy that switches focus emulation on for the agent's current tab
  (the last URL a result showed, as the sandbox guard guesses it) before each tool call reaches the MCP, and
  off 15 s after the last one ends — always on would make an animated hidden page cost what a visible one
  does (~26–30 % of a core measured). 15 s = the knee of 948 real pauses between browser calls. The
  emulation is session-scoped (verified: detaching drops it), so it dies with the launcher.
  `TANDEM_FOCUS_EMULATION=0` restores the plain launcher; `TANDEM_FOCUS_LINGER_MS`. The Cursor/OpenCode
  adapters start the MCP through the same launcher (`mcp-wrap.sh` → `mcp-launch.sh` → `mcp-launch.mjs`), so
  they get it too — not tried inside those IDEs. Tests: `tests/focus.test.mjs` (the proxy, no Chrome) and
  `tests/focus-e2e.mjs` (the real MCP clicks a background tab: 10 s timeout without, ~0.6 s with; e2e step
  [3c]). Checked headful on macOS — background tab, minimized, covered window (10 s timeout without, ~0.6 s
  with) and ⌘H (4.5 s without) — and in two real-use sessions (159 browser calls, none over 10 s). With a
  tiling window manager (AeroSpace) a window on another workspace still counts as visible to Chrome: there the
  emulation only matters for a background tab, ⌘H or ⌘M.

## [0.9.4] — 2026-10-29

### Fixed
- **`browser_evaluate`, `browser_click` & co. hung forever on pages that cannot run scripts** — documents
  served with CSP `sandbox`, as every `raw.githubusercontent.com` file is (2 of 5 research runs of the
  tandem-vs-Firecrawl bench hung reading READMEs). The cause is in @playwright/mcp 0.0.83: the wait after
  each action is a `setTimeout` inside the page, which such a page never runs (fix proposed upstream:
  microsoft/playwright#43746). Until it ships, the autostart hook probes the current tab before the calls
  that go through that wait (a microtask: hidden tabs delay timers, never microtasks) and denies them with
  what to do instead (`browser_snapshot`, or `fetch()` from a normal page). ~20 ms per guarded call;
  `TANDEM_SANDBOX_GUARD=0` turns it off. Not in the Cursor/OpenCode adapters.

## [0.9.3] — 2026-10-21

From an external audit of 0.9.2; each point reproduced before fixing, each with a regression test.

### Fixed
- **`install.sh` installed the Cursor adapter on machines without Cursor**: the legacy `~/.cursor/tandem`
  symlink created `~/.cursor`, which then read as "Cursor detected". IDEs are now detected before
  anything is written, and the legacy link is made only where `~/.cursor` already exists.
- **Bash slipped past the site-profile gate** with `cd ~/.claude/tandem && … > sites/x.md`,
  `S=$HOME/.claude/tandem; … > $S/sites/x.md` and `… | sponge …`: the store now counts as mentioned
  when the data dir and the word `sites` both appear; `sponge`/`truncate` count as writers.
- **The gate asked before there was a browser**: with Chrome down, the approved call failed with
  ECONNREFUSED. The autostart hook now ensures Chrome first and answers the gate after (a deny still wins).
- **Switching tabs didn't inject the profile**: `browser_tabs select` prints only the tab list, no
  `### Page` (MCP 0.0.83, verified). The URL comes from the `(current)` line — only when unambiguous
  (one current line, one `](`), since the title and path are page-controlled.

### Changed
- **The Bash gate costs ~14 ms instead of ~80 ms per Bash call** (every Bash call of every session, not
  just browser ones): an `sh` prefilter runs node only when the input contains `sites`, which every Bash
  hit needs (asserted in the tests). Write/Edit keep going through node — a symlinked path may contain
  neither `tandem` nor `sites`.
- Chrome starts with `--disable-sync` (a dedicated profile was syncing/dialing Google in the background).
  Not `--disable-background-networking`: it also stops Safe Browsing and component updates in a browser
  the human logs into.
- README documents what the profile-write gate covers and what it doesn't; the gate's header comment no
  longer claims bypass mode leaves an `ask` alone (it doesn't, since 0.9.0).

## [0.9.2] — 2026-10-21

### Fixed
- **A relative `filename` on an MCP tool still slipped past the site-profile gate.** 0.9.1 resolved it
  against `output/`; @playwright/mcp 0.0.83 resolves it against its own working directory (verified),
  so from a session in `$HOME`, `filename: ".claude/tandem/sites/x.md"` wrote a profile unasked (found
  by an external audit of 0.9.1). The gate now checks every plausible base — the session `cwd` from
  the hook input, the hook's own cwd, and `output/` — and asks if any lands in `sites/`.
- `tests/mcp-handshake.mjs` fails if Cursor's per-tool lease matchers drift from the MCP's `tools/list`
  (a tool added by an MCP upgrade would not renew the lease).

## [0.9.1] — 2026-10-21

From an external audit of 0.9.0; each point reproduced or checked before fixing.

### Fixed
- **`/clear` and `/resume` killed the shared Chrome** (tabs and session cookies lost): they fire
  SessionEnd (`reason` clear/resume) and `end` didn't look at it. Now the lease is kept and handed to
  the new session (SessionStart `clear|resume` → `session-hook.mjs handoff`). Idea from PR #4 (Gabriel).
- **The MCP's own tools could write site profiles past the gate**: `filename` on evaluate/snapshot/
  screenshot/… writes wherever the MCP's roots allow (verified with the real MCP 0.0.83: evaluate +
  filename wrote `sites/evil.example.md`). The gate now checks `filename` (relative paths resolve
  against `output/`) and the code of `run_code_unsafe` (heuristic). It runs inside the autostart
  hook — one node process per browser call, not two.
- **Instruction-like lines hidden in a JSON-escaped file** (what evaluate+filename writes) escaped the
  ⚠ notice: escaped line breaks are decoded before scanning.
- **Autostart drove whatever answered CDP**: a personal Chrome with remote debugging (real sessions)
  on tandem's port was used silently. Now a foreign owner → deny (as browser-start does); external
  mode and an invisible owner (`unknown`, e.g. Windows Chrome from WSL) are still allowed. Fast path
  via tandem's pidfile: +30 ms per call (measured), the full check only when that fails.
- **A page could choose which profile gets injected** by printing `Page URL: https://…` in its content
  or console. The URL now comes only from the MCP's own line-anchored `### Page` section, and never
  from read-only tools (evaluate, console, run_code, network, find). In 0.0.83 that section precedes
  anything the page controls (verified with a hostile console.log on click).
- **Adapters**: Cursor renews its lease on every browser tool (was only `browser_navigate`); OpenCode
  now holds a lease (touched on every browser tool, dropped on `session.deleted`, never stops Chrome) —
  before, the last Claude Code session to end stopped the Chrome an OpenCode user was driving.
  README.adapters.md documents that neither has the site-profile write gate.

## [0.9.0] — 2026-10-21

First public release since 0.6.0: **0.7.0 and 0.8.0 below were never published on their own** — coming
from 0.6.0, read all three. Upgrade notes: the data dir is `~/.claude/tandem` (migrated by
`install.sh`; the Claude Code plugin always used it); profiles for `host:port` are now saved per port
(old port-less profiles are still read); Windows no longer needs `.mcp.json` patched by hand.

From real usage (two teammates on 0.6.0, 1.903 + 1.846 tool calls): the site profile never reached the
model whole — a 26 KB profile became a 2 KB preview on every navigate — and one `localhost` profile
mixed 9 different local apps.

### Added
- **Profile index** (`scripts/profile.mjs`): a profile ≤ 6,000 chars is injected whole; a bigger one
  as an INDEX ≤ 2,000 chars (frontmatter, sections with sizes, recipe signatures, routes) with the
  absolute command to fetch a section. Instruction-like lines are still searched in the whole profile.
  Real 26 KB profile → 2.4 KB of context that describes all of it (was a 2 KB arbitrary cut).
- `map.sh show <key> --section "<title>"` and `map.sh sections <key>`.
- **Chrome autostart** (`scripts/autostart.mjs`, PreToolUse on `browser_*`): if no CDP answers, start
  tandem's Chrome before the call and tell the model; if autostart is off or fails, DENY the call with
  a clear instruction instead of a raw ECONNREFUSED. Default on, **off under WSL** (the browser there is
  often an external Windows Chrome — starting tandem's Linux one would hide the right browser);
  `TANDEM_AUTOSTART=1|0` forces it. Verified in a real `claude -p` session: Chrome down → first
  `browser_navigate` started it, the model got the notice, SessionEnd stopped it.
- `TANDEM_MCP_ARGS`: extra @playwright/mcp flags, appended last so they override tandem's defaults
  (verified: `--timeout-action 2000` → a hidden-element click fails at 2.0 s instead of 10.0 s).

- **Node MCP launcher** (`scripts/mcp-launch.mjs`; `.mcp.json` now runs `node …/mcp-launch.mjs`):
  Windows teammates no longer hand-patch `.mcp.json` to `bash.exe` in the plugin cache (lost on each
  update). `npx.cmd` through cmd.exe with quoting (data dirs with spaces). `mcp-launch.sh` stays as a
  wrapper for the adapters. Verified: MCP handshake (25 tools) with a data dir containing a space, and a
  real `claude -p --plugin-dir` session loading the tools (`${CLAUDE_PLUGIN_ROOT}` expands in `args`).
  CI gains a `windows-latest` job (engine tests + handshake). [Windows itself: verified only once CI runs.]
- **External browser mode** (`TANDEM_BROWSER=external`, optional `TANDEM_BROWSER_START_CMD` /
  `_STOP_CMD`): tandem only talks to the CDP port — for the Windows Chrome driven from WSL (certificates,
  AutoFirma) and other browsers tandem cannot manage. e2e covers it (5 checks).
- Chrome autodetection on Windows (Git Bash): Program Files / LocalAppData.

### Fixed (platform)
- The site-profile write gate never fired on **Windows**: it compared `startsWith(sitesDir + '/')`, and
  Windows paths use `\`. Now `path.relative` (checked with win32 path semantics). Bash detection also
  matches forward-slash forms of the store path.

### Changed (positioning, after the WebArena mini-pilot)
- tandem is presented as **human-in-the-loop browser + co-curated site memory**, no longer as a
  context-saving tool. Pilot (Magento admin, 3 templates × 4 instances × 4 arms, Sonnet, MCP 0.0.83):
  48/48 success in every arm; a warm profile read 4–7× fewer bytes but did not lower cost (the arm
  without memory was cheapest). The "~16–30× smaller" figure (0.0.76) stays only as history.
- Skills: `sel:` is still used when the fingerprint gate says `match`, but a snapshot is no longer
  treated as something to avoid at any cost (0.0.83 snapshots are distilled, ~5 KB on an admin page).
- `sel:` + fingerprint: **maintained, frozen** — nothing removed, no new features until a measurement
  shows they raise success.

### Fixed (review of the whole branch, 2026-10-21 — each reproduced or read in the code first)
- **Scripts launched through a symlinked path did nothing** (`isCli` compared the typed path with the
  real one): the MCP launcher exited 0 and the tools vanished; hooks silently no-op'd. Shared
  `scripts/is-main.mjs` (realpath) in all 9 entry points.
- **SessionEnd stopped Chrome for sessions that never used it** (a `claude -p`, a cron, an OpenCode
  user, a human who only ran `/tandem:browser-start`): now only the last session that HAD a lease stops it.
- **Cursor adapter**: `run-session-hook.sh` left the linked dir (`../../..` without `cd -P`), and
  `mcp-cursor-launch.sh` pointed at a non-existent `adapters/cursor/shared` (already broken on 0.6.0).
- **Windows**: autostart and SessionEnd exec'd `chrome-daemon.sh` directly (Node can't run a `.sh`) →
  `bash <script>`. Autostart's exec timeout 30 → 40 s (under the hook's 45 s).
- **Write gate**: case-insensitive on macOS/Windows (`…/Tandem/sites/x.md` bypassed it); Bash writers
  `ln`, `curl`, `wget`, `rsync`, `tar`, `unzip`, `patch` added (still a heuristic).
- **Write gate in interactive bypass-permissions mode: approved on its own, no prompt** (verified live
  2026-10-21: the hook said `ask`, Claude Code accepted it 40 ms later with source `config`/`mode`).
  The 0.8.0 note "bypass does not auto-approve" held only for `-p`. Now explicit: in bypass the write
  is allowed **with a visible notice** to review it (`systemMessage`, logged as `hook_system_message`);
  `TANDEM_PROFILE_GATE=strict` denies instead. Default and auto mode still ask (a live test in auto
  mode reached the human: source `user_temporary`). Both bypass paths verified live.
- `stop_chrome` waits up to ~10 s (was 5) before SIGKILL — a loaded machine flushes cookies slowly.
- intercept: a stale pidfile naming a recycled PID is ignored (command line checked) instead of
  SIGTERMing someone else's process.
- `--tab N` out of range is an error, not a silent capture of tab 0.
- **tests/smoke.sh never failed on a failing suite** (`node x | sed` returned sed's status), so CI on
  Linux/macOS could not catch engine-test failures. `run_suite` returns the suite's own status
  (verified by forcing a failure).
- Bench: `--until` earlier than now means tomorrow; no hang waiting for a recorder that already exited.
- **CRLF profiles lost their locators** (first Windows CI run: 3 of 8 parsed): the parsers split on
  `\n` and every line-anchored regex failed on the trailing `\r`. A Windows checkout (autocrlf) or
  editor produces exactly that. Line endings are normalized before parsing.
- CI: test failures are emitted as GitHub annotations (public; job logs need auth to download), with
  the Chrome log tail for e2e.

### Fixed (WebArena mini-pilot, 2026-10-21 — 48 runs on a machine at load ~20)
- `chrome-daemon.sh start` removes a stale profile lock (`SingletonLock`/`Socket`/`Cookie`) when no
  process uses the profile. The lock is `<hostname>-<pid>` and the Mac's hostname follows the network:
  after a change Chrome reports the profile "in use on another computer". Headless still started
  (e2e covers it); the headful dialog case is not verified.
- `TANDEM_CDP_WAIT` (seconds, default 15): how long `start` waits for CDP. Under heavy load Chrome took
  8–42 s to reach its first log line and 3 bench runs failed at 15 s; the bench now uses 60.
- Bench harness: an MCP that never connected (`init` status ≠ connected) is a harness error, not an
  agent failure (one run answered without a browser and was scored 0); a rerun starts from an EMPTY
  run dir (a leftover `agent_response.json` was scored as new — the agent could not overwrite it:
  Write refuses an unread existing file); the report no longer prints an `#undefined` instance row.

### Changed (MCP defaults)
- `--output-max-size 52428800`: the output dir (page snapshots/screenshots — a teammate's held 16 with
  tax IDs, another had 1,155 files) now evicts its oldest files past 50 MB (verified with a small threshold).
- `--timeout-action 10000` (was 5,000): the MCP uses one timeout for clicks AND screenshots; 17 % of a
  teammate's screenshots failed "waiting for fonts". A selector that matches nothing still fails at once.
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

### Fixed (external review of 0.6.0, 2026-10-21 — each confirmed, then re-verified on the branch)
- **One-line locators were dropped silently** (`- name:   sel: … | verified …`): the shipped example
  lost 5 of its 8. Both forms now parse; trailing annotations are separated from the selector;
  `recipe.mjs validate` reports Locators lines it cannot read.
- **`navigate` accepted `file:`/`javascript:` through `--fast`.** The MCP's browser_navigate blocks
  `file:`, but `--fast` runs `page.goto` in browser_run_code_unsafe: an untrusted argument changed what
  the recipe does. Both modes now take absolute http(s) URLs only (literal checked by validate).
- **`extract` took the first of N silently** (`.first()`): now strict (several matches = error, like
  clicks); new **`extract-all`** returns a list. The example recipe reads its listing with it.
- `validate` now checks the locators inside an `extract: {…}` map (they passed and failed at compile).
- **Fingerprint false drift on detail routes** (h1 = product title) — the `[n=1]` list-route limit
  reappeared: page-signals **algo 2** counts headings by level only; old captures report `stale`
  (recapture), not `drift`. Verified on Chrome: another product → match; an added button → drift.
- Anchored regex selectors end in `\b` when the name ends in a word character
  (`^TCK-2026-016` no longer also matches `TCK-2026-0161` — verified live).
- `selector.mjs` docs: `[name="X"]` is exact AND case-sensitive (verified: "save" ≠ Save; `"save"i` works).
- The profile is injected when the agent ARRIVES at a site by any browser tool (click, tab, recipe
  goto — URL taken from the result's "Page URL"), not only browser_navigate (verified in a real
  `claude -p` session: injected after a click). `www.` and non-`www.` twins share a profile. One
  node process per browser call now does injection + lease.
- README: the saving of `sel:` is not reading a snapshot to find the element (an action's own result
  is small with `--output-dir`); the "~18× per action" figure is gone. `TANDEM_CDP_PORT` precedence
  documented.
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
  shows prompt-level defenses barely help once memory is poisoned. ~~Verified that `bypassPermissions`
  does not auto-approve a hook's `ask`~~ — true only for `-p`; an interactive bypass session DOES
  (corrected in 0.9.0: allowed with a notice, or denied with `TANDEM_PROFILE_GATE=strict`). Bash coverage is heuristic (defense in depth).
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
