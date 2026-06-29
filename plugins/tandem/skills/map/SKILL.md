---
name: map
description: Per-site navigation memory for tandem's shared browser. Profiles that describe a site's skeleton (routes), its durable locators, navigation recipes, and gotchas, so you navigate KNOWING instead of re-deriving the DOM each time. Use it when you start operating a site (check whether a profile already exists), when you finish a recon worth saving, or when a saved locator fails (re-record). ASSISTED recon: you draft, the human confirms, it's saved.
---

# tandem:map — per-site navigation memory

Persists *how a specific site is navigated* in a per-host profile. Avoids re-deriving the
structure (huge snapshots, ephemeral refs) every session. Complements the
"Real navigation — patterns" section of the `tandem` skill: that is CROSS-site technique (infinite
scroll, cookie banners…); this is knowledge OF-a-site (the routes of THAT site).

Full design and rationale: `tandem/docs/01-navigation-memory.md`.

## Store (engine: `scripts/map.sh`)
Profiles in `~/.claude/tandem/sites/<host>.md` (OUTSIDE git; override `TANDEM_DATA_DIR`).
The SOURCE OF TRUTH are the `.md` files; the index is DERIVED from their frontmatter, not kept separately.

- `map.sh list` ............ table of profiles (host · updated · file)
- `map.sh show <host>` ..... dumps the profile (accepts a full URL: normalizes to host)
- `map.sh path <host>` ..... the file path (whether it exists or not) — for reading/writing
- `map.sh index` ........... derived JSON index (to stdout + caches `sites/index.json`)

Invoke it by its path within the plugin (`scripts/map.sh`); there's no bin on PATH for map.

## When to act (reflexes)

1. **When you start operating a site**: if a profile already exists, it usually reaches you on its
   own — a `PostToolUse` hook on `browser_navigate` injects the host's profile the first time you
   navigate to it in the session (`scripts/hook-inject-profile.mjs`). If it didn't arrive (or you want
   to re-read it): `map.sh show <host>`. If there's no profile and the work isn't trivial → offer the
   human to do a recon and save it.
2. **Before trusting a route's locators** (cheap re-check): validate with
   `fingerprint.mjs check <host> <route>` (structural signal, small JSON), NOT with a
   targeted `browser_snapshot` (it weighs ~18× the whole profile). `match` → trust that route's `sel:`
   values WITHOUT a snapshot (see "Frugal flow"). `drift` → point 4. No fingerprint yet → a one-off
   targeted snapshot, and capture the fingerprint for next time.
3. **After a recon worth keeping**: draft the profile, show it to the human,
   and only with their OK write it.
4. **If a locator fails** (drift): do NOT try to repair it. Re-derive live, update the
   profile line with the new anchor and today's date, and tell the human about the change.
   Rule: *a wrong cached click is worse than a slow click*.

## How recon is done (ASSISTED — never auto-save)

1. Explore with the `browser_*` tools (targeted snapshot, `browser_evaluate` for data,
   navigating routes). Don't dump raw DOM into the profile: abstract it.
2. Draft using the structure below. Mark each line:
   `[verified YYYY-MM-DD]` (you lived it now) or `[hypothesis]` (inferred, untested).
3. **Show it to the human. They confirm/correct.** Until then it isn't saved.
4. Write to `$(map.sh path <host>)`. Set `created`/`updated` in the frontmatter.

## Locator discipline (what keeps this from lying)

- **Multi-anchor, stable properties.** Prefer a stable `id` if one exists; if not, role+name
  from the accessibility tree. **Never** position/index nor `eNN` refs (they're ephemeral).
- Save the **primary + 1-2 corroborants** (neighboring text, shortcut, container). On re-check,
  accept the element if the set matches, not just the primary. (Idea stolen from Similo:
  several weak weighted signals beat a single strong anchor.)
- **Lean and abstract.** Skeleton + locators + recipes. If a page is huge, the profile
  stores HOW to get there and WHAT to look for, not the dump.
- **Executable `sel:` (opt-in).** Besides the readable primary, a locator can carry a `sel:`
  = a Playwright selector the agent passes as `target` to act WITHOUT a snapshot. Generate the
  syntax with `scripts/selector.mjs` (NOT by hand — the quote/regex escaping is easy to mistype):
  `selector.mjs <role> <name> [--regex] [--anchor]`. Two classes:
  - **instance** (one element): direct `sel:`, e.g. `role=button[name="New ticket"]`.
    For long/fragile names use `--regex` (substring) instead of the exact literal.
  - **template** (several: rows, list items): `sel:` with a slot the recipe fills in
    use, e.g. `role=row[name=/^{id}/]`. A common prefix (`^TCK-`) matches N rows → the action
    is strict and throws; that's why it's parameterized to the concrete id.
  - If an element has no unique role/name, do NOT give it a `sel:` (forcing positional CSS lies).
  - The `sel:` is ONLY the selector, no inline comments (`recipe.mjs`/`selector.mjs` would
    include them in the value). Notes go in `primary:`/`corroborates:`.
  - **Not every "table" exposes ARIA.** Many SPAs render a `<table>` that the tree flattens to
    `generic` (no `role=row`/`cell`) and duplicate the list for responsive. Verify LIVE before
    anchoring by `role=row`; if there's none, anchor by stable class + `text=` + `>> visible=true`. The
    `selector.mjs` helper (v1) only covers `role=…[name]` — these cases are written by hand for now.

## Drift by signal (fingerprint, T015) — staleness by evidence, not by date

Instead of trusting how old the `[verified]` tag is, compare the structural SKELETON
of the page against the one you saved. If it changed → that route's locators are suspect,
time to re-check/re-record (the date doesn't tell you that: a page untouched for 6 months is still valid;
one that changed yesterday is stale even if the tag is from yesterday).

Engine: `scripts/fingerprint.mjs {capture|check} <host> <route-key>` (JSON signals via stdin).
Sidecar `sites/<host>.fingerprints.json` (machine, separate from the readable profile). `check`
returns `{status: new|match|drift, added[], removed[]}` and rc 1 if there's drift; the diff tells you
EXACTLY which locator changed.

**Canonical evaluate** — captures only STRUCTURE (roles, landmarks, buttons, inputs, headings,
nav-links), not table data, and normalizes digits to `#` so counts/dates/ids don't count
as drift. Do NOT type it by hand: the SINGLE SOURCE is `scripts/page-signals.mjs` (versioned and
with tests). Get the exact JS and pass it to `browser_evaluate` verbatim:

```
node scripts/page-signals.mjs print     # emits the self-contained () => [...] blob
```

> Why a file and not the snippet here: changing the extraction invalidates ALL the stored
> fingerprints (false drift everywhere). With the single source, the algorithm can't drift without its
> tests catching it (`tests/page-signals.test.mjs`); the blob is serialized from those same functions.

Flow: `browser_evaluate` with the output of `page-signals.mjs print` → pipe the array to
`fingerprint.mjs capture|check <host> <route>`.
- **capture**: after verifying a route's locators in recon, save its fingerprint.
- **check**: on revisit, compare. `drift` → re-record-on-drift (re-derive, update the profile) and
  recapture the fingerprint. `match` → trust the profile. `new` → not captured yet.

**Gotcha [verified 2026-06-22]**: BEFORE capture/check confirm that `location.pathname` is the
expected route. If the session expired and you bounced to `/login` (or another wall), do NOT capture —
you'd save the login skeleton under the wrong route-key. It's an auth wall → the human clears it, then you repeat.

## Frugal flow (act by `sel:` without re-snapshotting)

With a profile loaded, do NOT snapshot by default to act: the tree snapshot weighs ~18× the
profile entire (measured: 105 KB vs 5.6 KB). The snapshot goes from default mode to honest FALLBACK.

1. **Gate by fingerprint, not by faith.** Before trusting a route's `sel:` values,
   `fingerprint.mjs check <host> <route>`. `match` → the `sel:` values are good, act by them. `drift`/`new`
   → re-derive with a targeted snapshot (and capture/recapture the fingerprint).
2. **Act by `sel:`.** `browser_click`/`type`/`evaluate` with `target=<sel>`. Zero snapshot.
3. **SPA: wait before acting.** On deferred-render routes (seen in a real SPA: "first
   empty snapshot" before hydrating), `browser_wait_for` on the `sel` before the click; otherwise the element
   may not exist yet and the savings go into retries.
4. **If the `sel:` fails** (doesn't resolve, or throws on ambiguity) → treat it as drift: targeted
   snapshot, re-derive, update the `sel:` (assisted re-record, reflex 4), recapture the
   fingerprint. A wrong cached `sel:` is worse than a slow snapshot.

Fallback to snapshot = no profile, drift, or reading new unmapped data.

## Executable recipes (procedural memory)

A recipe is a NAMED and PARAMETERIZED sequence of steps over the profile's `sel:` values. Flat-YAML
format under `## Recipes`, compiled by `scripts/recipe.mjs`:
```
open-ticket-by-id(id):
  - type:     ticket-search   <- {id}
  - click:    ticket-row      <- {id}
  - wait-url: /tickets/
  - return:   url
```
- Header `name(params):`. Each step = `action: locator [<- {param}|"literal"]`. The `{param}`
  fills the `sel:` TEMPLATE (the slot must be named the same as the param). v1 actions:
  `navigate`, `type`, `click`, `wait-url`, `return`/`extract`. Do NOT type the Playwright syntax by
  hand: `recipe.mjs` compiles it. When saving a recipe in recon: `recipe.mjs validate <host>`.

### Running it — two modes (`recipe.mjs` COMPILES, the agent EXECUTES):
- **`--step` (default, observable):** `recipe.mjs compile <host> <recipe> <args> --step` → steps
  `{action,target,value}` → run them with `browser_type`/`click`/`wait_for`. The human sees each step.
  Precede it with the `fingerprint check` gate (same as for a standalone `sel:`).
- **`--fast` (frugal, 1 call):** `recipe.mjs compile … --fast` → a single Playwright function. **Mandatory
  dry-run:** show the code to the human; with their OK, run it with `browser_run_code_unsafe`. That
  tool is RCE-equivalent → only recipes from the co-curated store, never model or page text.
- **PII:** a recipe that `extract`s a sensitive datum (IBAN/national ID) → that datum goes to an ACTION,
  not to the context/log. The dry-run makes it visible before running.

## Profile structure (`<host>.md`)
```
---
site: <host>
created: YYYY-MM-DD
updated: YYYY-MM-DD
auth: { wall: "<which wall>", cleared_by: human|claude|none }
---
# <host> — navigation profile

## Routes (skeleton)      — URL pattern → what it's for
## Locators (multi-anchor) — name: sel (optional, executable) + primary + corroborates + | verified DATE
## Recipes                — executable (flat-YAML): name(params) + steps `action: locator <- {param}`
## Gotchas                — induced rules, each one [verified DATE] or [hypothesis]
```
Format example: see `docs/01-navigation-memory.md`.

## No-goals (v1)
- No automatic action: the hook injects the profile into the CONTEXT, but navigating/acting is always
  your decision (it never auto-pilots from the profile). AUTHORSHIP (recon/writing) is assisted too.
- No self-healing that rewrites the profile on its own: re-record + human re-confirmation.
- No rigid/rich schema: lean wins, scales by addition.
