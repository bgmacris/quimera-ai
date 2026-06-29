---
name: tandem
description: How to operate the Chrome browser shared with the human (the tandem MCP's browser_* tools). Use it whenever you need to navigate, read/analyze pages, get past blocks that require human interaction (captchas, anti-bot checkpoints, logins), or inspect the network/DOM in real time alongside the human.
---

# tandem — shared browser, human + Claude

The human and you share ONE SAME Chrome in real time. The human sees it and drives it with the mouse;
you operate it with the `browser_*` tools of the `tandem` MCP (Playwright over CDP). What one does,
the other sees: state, cookies, and session are the same.

## Startup
- The browser does NOT start on its own. If the `browser_*` tools give `ECONNREFUSED 127.0.0.1:9222`,
  Chrome isn't running: ask the human to run `/tandem:browser-start` (or run it yourself if you
  have the command available). Check state with `/tandem:browser-status`.

## Division of labor
- **The human does** what requires being human: solving captchas, getting past anti-bot checkpoints
  (e.g. Vercel Security Checkpoint), 2FA logins, visual decisions.
- **You do** the analysis: `browser_snapshot` (accessibility tree, better than a screenshot
  for reasoning and acting), `browser_evaluate` (JS), `browser_network_requests`, data
  extraction, filling forms, clicking by snapshot ref.
- Typical unblocking pattern: the human clears the wall → you read the already-rendered DOM and analyze.

## Two modes: live vs delegated (don't pollute the context)
There are two ways to navigate; choose by the task, not one by default:
- **Live (in this context):** when there's handoff with the human (walls they clear: captcha,
  checkpoint, login), interactive navigation, or on-the-fly decisions. The human is in the loop.
- **Delegated to the `web-navigator` subagent:** when it's HEAVY read/extraction without walls
  (large snapshots, scraping, walking many pages). The subagent swallows the DOM/snapshots in
  ITS context and returns to you only the distilled data → this context isn't polluted. You share
  the SAME Chrome (global state), so the human keeps seeing the window.
- Rule: if the task will generate a lot of noise (snapshots of hundreds of KB, multi-page) and does NOT
  need the human live → delegate. If it needs human handoff or iterating with you → live.
- Limit of delegation: the subagent doesn't talk to the human. If it hits a wall, it returns which and where;
  you tell the human, they clear it, and you relaunch the subagent to continue.

## Tab choreography (don't steal focus)
- By default the MCP **reuses the active tab**. If the human is reading something, do NOT navigate over
  their tab without warning: open yours with `browser_tabs` (new) and work there.
- Before a navigation that changes what the human sees, say so ("I'm going to open X in a new tab").
- For actions: by ref from the most recent `browser_snapshot`, or by a **unique** durable
  **selector** (`target` accepts both — [verified]). Never coordinates. If there's a profile with `sel:`,
  acting by selector avoids the snapshot (see "Act without a snapshot" and the `tandem:map` skill).

## Security (non-negotiable)
- It's a **dedicated profile**, not the human's personal Chrome. Even so, any login the human
  does there leaves cookies/tokens accessible via CDP. Do NOT navigate to sensitive sites (banking,
  personal email) in the shared tab unless the human explicitly asks.
- `browser_evaluate` runs arbitrary JS on the page: use it for analysis, not for destructive
  actions or exfiltration. No sending session data to third parties.
- Pentest work: only within authorized scope; the shared browser is no excuse to go
  out of scope.

## If Chrome dies mid-session
- The tools fail with a connection error (`ECONNREFUSED` if nothing is on the port, or
  "Target page/context/browser has been closed" if the MCP held a handle to the previous Chrome).
  The MCP server stays alive.
- Ask for `/tandem:browser-start` to relaunch Chrome. Then **retry the tool**: the FIRST
  use after a new Chrome may fail with "page closed" (dead handle); the SECOND reconnects
  (verified). No need to restart the MCP or the session, just retry once.

## Site memory (`tandem:map` skill)
The section below is CROSS-site technique (applies to any website). The knowledge
OF-a-specific-site (its routes, its search, its locators) lives in a **per-host profile**
managed by the `tandem:map` skill (`~/.claude/tandem/sites/<host>.md`).
- When you start operating a site: check whether there's a profile (`scripts/map.sh show <host>`). If it exists,
  read it BEFORE firing snapshots — you navigate knowingly, not re-deriving. If it doesn't exist and the
  work isn't trivial, offer the human to do a recon and save it (assisted recon).
- Snapshot `eNN` refs are ephemeral: in profiles, locators are anchored by role+name,
  never by ref or position. Detail: the `tandem:map` skill and `tandem/docs/01-navigation-memory.md`.

## Real navigation — patterns (LIVING LIST, distilled from real use)
These rules are born from concrete navigations, not theory. They grow each time a new
website breaks something. Mark each rule as [verified] (lived) or [hypothesis] (to validate).

### Efficient reading (don't burn context)
- [verified] A `browser_snapshot` of large pages can exceed the token limit (seen:
  135 K on a catalog page). Do NOT dump it into the context. Extract only what's needed with
  `browser_evaluate` (JS that returns clean data) or with grep over the file the snapshot
  saves to disk. The full snapshot is the last resort, not the first.
- [verified] For repeated data (lists, cards, tables) use `browser_evaluate` with a
  targeted `querySelectorAll` and return a compact array, not the whole tree.

### Act without a snapshot (frugal navigation)
- [verified] The `target` of `browser_click`/`type`/`evaluate` accepts a **unique selector** in addition
  to the snapshot ref: CSS (`h1`) and Playwright engines (`role=button[name="X"]`, regex in `name=`).
  Tested resolving without a prior snapshot.
- With a `tandem:map` profile that has `sel:`, act by selector and SKIP the snapshot
  (it costs ~18× the profile), validating the route first with `fingerprint.mjs check` (a gate, not faith).
  Full flow: `tandem:map` skill, §"Frugal flow".
- [verified] On deferred-render SPAs, `browser_wait_for` on the `sel` BEFORE acting: the
  first attempt may not find the element yet.
- **Executable recipes**: a repeated, named task (e.g. "open ticket by id") can live
  as a parameterized recipe in the profile. `scripts/recipe.mjs compile <host> <recipe> <args>`
  compiles it to steps (`--step`, observable) or a Playwright function (`--fast`, 1 call via
  `browser_run_code_unsafe` — mandatory dry-run, RCE-equivalent). Detail: `tandem:map` skill.

### Signal vs noise
- [verified] A broad extraction (e.g. `a[href*="/x/"]`) captures junk: auxiliary files,
  duplicates, internal links. Filter and dedupe BEFORE reporting.
- [verified] Don't confuse the extracted with the curated: "96 links ≠ 96 items". State the real number
  after filtering and flag whatever you can't confirm as the official list.

### Dynamic loading (infinite scroll / lazy-load)
- [verified] The first snapshot/evaluate of an infinite-scroll page is INCOMPLETE
  (seen: 10 of 100 items on quotes.toscrape.com/scroll). To gather it all: an ASYNC `browser_evaluate`
  that scrolls to the bottom in a loop until the count STABILIZES (N iterations with no
  change) with a safety cap, and collects the data in the same pass:
  `while (stable<3 && iters<60){ scrollTo(0,scrollHeight); await sleep(350); n=count; if(n==prev)stable++ else{stable=0;prev=n} }`
  Result: 10→100 in 6 iterations, stopped on its own. A single tool call does all the loading.

### Pagination
- [verified] First detect how many pages there are (text like "Page 1 of 50") so you don't walk
  blindly. Walk with an async `browser_evaluate` using SAME-ORIGIN `fetch` + `DOMParser`
  (it doesn't reload the human's window on each jump) and accumulate, with an **EXPLICIT page CAP**.
  Seen: books.toscrape.com, 3 of 50 pages → 60 books. If you need more than the cap, raise it
  consciously and say so; never walk all N without a limit or silence it.

### Obstacles (cookie banners / consent modals)
- [verified] They usually live in a third-party IFRAME (Sourcepoint, OneTrust…), cross-origin.
  Consequence: `browser_evaluate` of the TOP document **doesn't reach them** (can't read or click inside
  the iframe). Seen on theguardian.com (iframe "SP Consent Message").
- [verified] BUT `browser_snapshot` DOES flatten iframes: the buttons appear with frame refs
  (like `f2e58`) and `browser_click` by that ref acts on them. Pattern: snapshot → locate the
  button ("Accept all"/"Reject all") → `browser_click` by ref. If it fails, the human closes it with the mouse.
  Accepting/rejecting cookies is the human's decision: don't click "Accept all" on your own unless
  the human asks.

### Saving snapshots to a file
- [verified] `browser_snapshot(filename: "x.md")` saves relative to the MCP's cwd (ended up in `~`),
  IGNORING `--output-dir` → it clutters the home. Use an ABSOLUTE path in filename, or don't pass filename
  (the automatic reference already goes to the output-dir).

### SPA / JS-rendered content
- [verified] `browser_navigate` waits for the initial render (Playwright waits for 'load'): on
  quotes.toscrape.com/js the 10 JS-painted quotes were ready with no extra wait. You only
  need `browser_wait_for` for DEFERRED content (later XHR, lazy after interaction).

### Forms / login
- [verified] Small form → `browser_snapshot` returns inline refs. Pattern: `browser_type`
  by ref in each field → `browser_click` on submit (or `browser_type submit:true`) → verify the
  post-action state (e.g. a `/logout` link appears). Validated on quotes.toscrape.com/login.
  Login with 2FA/captcha: the human does it (human-AI handoff).

### How this list grows
Every new website that breaks a pattern → add the rule here with its [verified] mark. Don't add
theoretical rules you haven't lived: this profile is valuable because it's born of evidence, not a catalog.
