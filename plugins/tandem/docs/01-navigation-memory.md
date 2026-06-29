# Study 01 — Per-site navigation memory / recon (`tandem:map`)

**Project:** tandem
**Date:** 2026-06-22
**Status:** v1 + v2 (T015, T016) implemented and verified.
**Depends on:** tandem's SKILL.md (section "Real navigation — patterns, LIVING LIST").
**Base research:** deep-research 2026-06-22 (26 sources, 122 claims → 21 confirmed
with 3-vote adversarial verification). The `[verified]` citations below come from there;
anything unsettled is marked `[open]`.

> Note: the examples use a fictional site (`app.example.com`, a ticketing app) only
> to illustrate the format. The real profiles live outside the repo (see "Decision: LOCAL store").

---

## Problem

To operate a known site, its structure is re-derived every time: a full `browser_snapshot`
of the accessibility tree. That (a) burns context —snapshots of hundreds of KB— and
(b) uses **ephemeral** refs (`e72`, `e108`) that change between snapshots and between pages. There is no
persistent memory of "how you navigate THIS site".

`tandem:map` adds that memory: a **per-site profile** that describes its skeleton, its
durable locators, navigation recipes and gotchas — so you navigate *knowing*, not
re-deriving. Fewer tokens and more reliable.

## What it is NOT (layers, no duplication)

- The "Real navigation — patterns" section of SKILL.md is **CROSS-site** knowledge
  (how to handle infinite scroll, cookie banners in an iframe, etc., in general). **It stays.**
- `tandem:map` is **PER-site** knowledge (its routes, its search box). A different layer.
  The generic technique lives in the skill; what is host-specific lives in its profile.

---

## Decision: LOCAL store

The profiles live **outside git**, in tandem's fixed data dir
(`~/.claude/tandem/`, override `TANDEM_DATA_DIR`), alongside `chrome-profile/`. Reasons:

- Consistency with the existing architecture (lib.sh uses a fixed path on purpose: the
  `${CLAUDE_PLUGIN_DATA}` var is not available in the bash injection of slash commands).
- The profile of an authenticated site (internal routes, structure) is low-grade sensitive
  information: outside git and backups by default, just like the Chrome profile.

```
~/.claude/tandem/
├── chrome-profile/         (perfil dedicado de Chrome)
├── cdp-port, logs/ …
└── sites/                  (perfiles de navegación)
    ├── index.json          caché DERIVADA (regenerable con `map.sh index`), no fuente de verdad
    └── app.example.com.md  perfil legible por humano (FUENTE DE VERDAD)
```

---

## The artifact: `sites/<host>.md`

Readable, editable Markdown. YAML frontmatter for the structured parts; the body for recipes and
gotchas. Lean and abstract **on purpose** — never DOM/HTML dumps (see Pitfall #2).
Illustrative (fictional) example:

```markdown
---
site: app.example.com
created: 2026-06-22
updated: 2026-06-22
auth: { muro: "login form", lo_pasa: humano }
---
# app.example.com — perfil de navegación

## Rutas (esqueleto)
- /dashboard ............ inicio
- /tickets .............. lista de tickets (tabla, paginada, filtros por estado)
- /tickets?search=X ..... búsqueda (admite &ordering=-created_at)
- /tickets/{id} ......... detalle (id numérico de URL)
- /projects ............ proyectos (master-detail SPA; selección client-side, la URL NO cambia)

## Locators (multi-ancla: primario + corroborantes)     | verificado
- busqueda-tickets:
    primario:    textbox "Buscar tickets..."
    corrobora:   en la barra de filtros; botón "Columnas" al lado     | 2026-06-22
- fila-de-ticket:  role=row, name empieza por el nº de ticket          | 2026-06-22
- filtros-estado:  botones "Todos | Abierto | …", cada uno con badge de conteo | 2026-06-22

## Recetas (unidades nombradas, componibles)
- abrir-ticket-por-numero: escribir el nº en busqueda-tickets → click en la fila →
  la URL pasa a /tickets/{id}.

## Gotchas (reglas inducidas)
- [verificado 2026-06-22] El nº visible (TCK-123) ≠ el id de URL (numérico interno).
- [verificado 2026-06-22] El snapshot del detalle es GRANDE → vuélcalo a archivo, no al contexto.
- [hipótesis] La paginación es server-side (?ordering=, ?search= en URL) → recorrible por URL.
```

---

## Discipline (where this lives or dies) — derived from the research

1. **Locators = stable properties, multi-anchor.** Anchor on a stable `id` if it exists; if
   not, role+name from the accessibility tree; **never** position/index. Save the
   primary **+ 1-2 corroborating signals** (neighboring text, id) and, on the re-check, accept
   the element if a weighted match passes a threshold — don't bet on a single anchor.
   - `[verified]` fragility order: ID > stable role/name > CSS/XPath > position
     (Leotta 2014: absolute XPath 67% broken; ID <1%). The *order* is robust; the %s are
     dataset-specific.
   - `[verified]` multi-anchor weighs: Similo/HybridSimilo relocates 98.8% of broken
     locators by scoring several properties (stable ones weight 1.5, unstable 0.5).
     Source: Kluge & Stocco 2025, arxiv 2505.16424.

2. **Re-record-on-drift, NOT repair.** If a locator fails, I don't try to fix it: I
   treat it as a failure, re-derive live, rewrite the entry and mark it fresh. Rule stolen
   from Stagehand: *"a wrong cached click is worse than a slow click"*.
   Source: browserbase.com/blog/stagehand-caching `[verified]`.

3. **Date + tag per line.** `[verified YYYY-MM-DD]` = I lived it; `[hypothesis]` = inferred
   without testing. It's the human-curated equivalent of Stagehand's "snapshot fingerprint gate".

4. **Cheap re-check before trusting.** When picking a site back up: I read the profile but confirm
   1-2 key locators with a targeted snapshot. They fail → I fall back to a fresh snapshot **and**
   mark the profile stale.

5. **Lean and abstract.** Skeleton + locators + recipes. Never raw DOM.
   Source: Synapse, ICLR 2024 (*"a single page can eat the entire context"*) `[verified]`.

6. **ASSISTED recon.** Explore → draft → the human confirms/corrects → save.
   No auto-saving of inferred maps (curated memory, not a dump).

---

## Pieces (v1)

1. **Skill `tandem:map`** (`skills/map/SKILL.md`) — the brain: read / create (assisted
   recon) / update profiles, with the discipline above. Thin surface.
2. **Store**: plain markdown in `~/.claude/tandem/sites/<host>.md`.
3. **DERIVED index**: `map.sh index` computes the index from the frontmatter of the `.md` files and
   caches it in `sites/index.json` (regenerable, not source of truth). A conscious deviation
   from workflow-use's idea (`metadata.json` maintained separately): a hand-maintained index
   drifts out of sync with the files — another map that can lie. Deriving it removes that bug at
   the cost of a re-scan, cheap with few sites.
4. **Helper `scripts/map.sh {list|show <host>|path <host>|index}`**.
5. **Wiring in SKILL.md**: reflex "when starting on a site, look at `sites/<host>.md`; if it
   doesn't exist and the job isn't trivial, offer recon" + the split of layers (cross-site vs per-site).

---

## v2 — auto-injection by hook (T016, DONE 2026-06-22)

When navigating to a host with a profile, the hook injects it into the model's context. Implemented:
`scripts/hook-inject-profile.mjs` + a `PostToolUse` entry in `hooks/hooks.json`.

- **Event: `PostToolUse`, NOT `PreToolUse`.** `[closed path]` `PreToolUse` can read the
  url but **CANNOT inject context that the model reads** — it does not support
  `hookSpecificOutput.additionalContext` (only `permissionDecision`/`updatedInput`).
  Verified against the official Hooks Reference 2026-06-22 (issue anthropics/claude-code#15664).
  `PostToolUse` DOES support `additionalContext`; besides, it's the right moment (load the
  profile *after* navigating, not before).
- It only injects if a profile EXISTS for the host; otherwise silence (zero noise).
- ONCE per (session, host): marked in `.hook-state/<session_id>/<host>` so it isn't re-injected
  on every click within the site (context-bloat pitfall). Cleanup in `SessionEnd`.
- In node (already a plugin dependency) to parse/emit JSON without adding `jq`.

## v2 — drift by signal (T015, DONE 2026-06-22)

Staleness by EVIDENCE, not by date: it compares the structural skeleton of a route against the
saved one. Implemented: `scripts/fingerprint.mjs` + canonical evaluate (in `skills/map/SKILL.md`)
+ sidecar `sites/<host>.fingerprints.json`.

- **Fingerprint of the SKELETON, not of the page**: roles/landmarks + controls (button/textbox/
  heading/nav-link), NOT data rows. Why it matters to **normalize digits to `#`**: a count badge
  "Inbox 112" may turn into "115" between visits; without normalizing, that would be false drift.
  Counts/dates/ids → `#`.
- **Per-route** (route-key passed by the agent, aligned with the route names in the profile), not
  per-profile.
- **Set of signals, not a hash**: `check` returns `added[]`/`removed[]` → actionable diff (which
  locator changed), not a binary. rc 1 on drift.
- **Agent-driven**: the fingerprint is computed with a `browser_evaluate` (the hook has no browser).
- `[verified]` Gotcha: before capture/check confirm `location.pathname` == expected route; if
  the session expired and bounces to a login wall, do NOT capture (you'd save the login under someone else's route-key).
- Verified end-to-end 2026-06-22: helper mechanics (capture/match/drift/new) in a sandbox +
  real authenticated capture of two distinct routes, both capture→match. Sidecar clean of data
  (the `#` normalization and the row filter guarantee it).
- `[known limit, n=1 — 2026-06-29]` **False drift when a heading is CONTENT, not a section.**
  The design assumes h1/h2/h3 = skeleton (headers). On LIST-routes where each item carries its title
  in `h3` (catalogs, search results), pages from the SAME template bring different h3s →
  `check` reports drift even though the template is identical. Measured on books.toscrape (Fiction p1 vs
  p2: 20 `h3` added/removed, 7 stable signals equal → they'd match without the h3 text). The
  `#` normalization doesn't help: it's text, not digits. **Site-conditional** (doesn't affect
  dashboards/forms), which is why the single source isn't redesigned over a single case — logged to
  revisit if it reappears on a site with real stake. Mitigation today: on the list-route, skip the gate
  and use a direct signal (`.pager`, item count).

## v2 — frugal navigation via `sel:` (DONE 2026-06-22)

The profile stops merely DESCRIBING locators and starts making them EXECUTABLE: each locator can carry
a `sel:` = a Playwright selector that the agent passes as `target` to act WITHOUT `browser_snapshot`.

- **Why it matters (measured, not estimated):** the `target` of `browser_click`/`type`/`evaluate`
  accepts "ref OR unique selector" → `page.locator()` (CSS and Playwright engines: `role=`, `text=`,
  regex in `name=`). `[verified live 2026-06-22]` these resolve without a prior snapshot: `h1`,
  `role=heading[name="Web scraping"]`, `role=link[name="Web crawler"]`. The tree of a snapshot
  weighs **~18×** the entire profile: `wc -c` → Wikipedia snapshot 105,571 B (~26k tok, ÷4) vs a profile
  of a real site 5,581 B (~1.4k tok). The profile is injected 1×/session; the snapshot was repeated per action.
  Reproducible method: `wc -c` of the `.md` vs of the file saved by `browser_snapshot(filename:)`.
- **Gate by fingerprint, not by faith:** skipping the snapshot is only honest if `fingerprint.mjs
  check <host> <route>` returns `match`. `drift`/`sel:` failure → targeted snapshot + re-record. This
  reconciles the re-check reflex (formerly: "confirm with a snapshot"): the fingerprint replaces it,
  cheaper and it says WHAT changed.
- **Instance vs template:** instance locators (a textbox, a button) carry a direct `sel:`;
  class locators (rows, items) go as a TEMPLATE with a slot (`role=row[name=/^{id}/]`)
  because a common prefix matches N elements and `locator()` is strict (throws with >1). The recipe
  fills in the concrete id.
- **Syntax as code, not by hand:** `scripts/selector.mjs` (+ `tests/selector.test.mjs`) generates
  the `sel:` with the correct escapes (quotes, regex metacharacters, the `/` delimiter). Same
  lesson as `page-signals.mjs`: critical syntax lives in tested code, not in prose. It's an
  AUTHORING helper (recon); at runtime the MCP receives the already-written `sel:`.
- **No-goal maintained:** the `sel:` does NOT auto-rewrite (it's still assisted re-record). No positional
  CSS/XPath fallback: if there's no unique role+name, there's no `sel:`.
- `[verified 2026-06-22, dogfooding on a real site]` TASK-equivalent measurement: reading the detail of a
  record = snapshot 22,418 B (~5.6k tok) vs targeted extraction ~0.2 KB ≈ **110×**; the list 13,943 B
  vs an evaluate of ids. The task (open record + read) was done WITHOUT dumping a snapshot to the context. The
  18× profile↔snapshot is the floor; in the expensive step (LARGE detail) the saving is bigger.
- `[open]` **v2 of `selector.mjs`**: the dogfooding showed that the v1 helper only covers
  `role=…[name]`. Outside that mold: a "table" WITHOUT ARIA roles (tree all `generic`) with
  DUPLICATED elements due to responsive → the real `sel:` was `span.ticket-number >> text="{id}" >>
  visible=true` (CSS + `text=` engine + `visible=` filter), which the helper does NOT generate. v2: support
  `css`/`text=` engines and the `visible=` filter. Recon: verify LIVE that a table exposes
  `role=row`/`cell` before anchoring there — many SPAs don't.

## v3 — executable recipes / procedural memory (DONE 2026-06-22)

The profile's "recipes" go from PROSE (numbered steps in natural language) to EXECUTABLE and
parameterized. Compiler `scripts/recipe.mjs` (+ `tests/recipe.test.mjs`). The agent-memory research
2026 backs it (procedural memory + reflection, +10.6% without fine-tuning).

- **Hybrid, two modes.** `--step`: `{action,target,value}` steps that the AGENT executes with the
  tools (observable, safe default). `--fast`: a single Playwright function `async (page)=>{}` that runs
  in ONE tool call via `browser_run_code_unsafe` (ultra-frugal, zero snapshots). `recipe.mjs` COMPILES;
  the agent EXECUTES (the `browser_*` tools belong to the model, not to a script — that's why there is NO slash
  command `/tandem:run`: a Bash command can't invoke them).
- **Flat-YAML format, single source.** Parsed by hand (~the plugin has no deps; like the
  frontmatter of `map.sh`). It's "YAML-looking", not YAML (a nested `:` or an anchor would break it, on
  purpose). We do NOT duplicate prose+executable: that drifts out of sync (the `map.sh index` lesson).
- **`run_code_unsafe` trust boundary (RCE-equivalent).** Store structure (trusted)
  ≠ data/args (untrusted → ALWAYS `JSON.stringify`, inert JS literal). The template `sel:` is
  the only point where a value goes inside a selector string → per-engine escape (`escapeStringName`/
  `escapeRegexName` from `selector.mjs`) BEFORE the `JSON.stringify`. Final net: `assertCompiledSafe`
  inspects the SKELETON (emptied strings) against an allowlist; it rejects `require`/`import`/
  template strings/`page.<not allowed>`. Star test: `args={'id':'x"); fetchEvil(); //'}`
  stays inert. Mandatory dry-run before `--fast`.
- **PII in `extract`.** The danger of extracting is not the code, it's the DATA returned (IBAN/NIF). The
  PII return goes to an action, not to the context; the dry-run makes it visible. `recipe.mjs` doesn't guess
  PII; a `sensible:` tag on the locator can flag it (v2).
- **No-goals v1:** no `run:` composition (flat recipes); no `wait-for`/`select-option`/
  `press-key`; no self-healing of recipes (assisted re-record, like the rest of the plugin).

## No-goals of v1 (conscious paths, not oversights)
- **Automatic self-healing that rewrites the profile by itself on failure.** workflow-use's roadmap
  has it UNimplemented and its LLM fallback is self-described as
  *"currently really bad, not recommended for production"* `[verified]`. We don't promise
  more than re-record + human re-confirmation.
- **Rich/rigid per-site schema.** Lean wins. It scales by addition.

---

## Open (not validated by the research — don't invent)

- `[open]` **Bridge with pentest recon** (Katana JSONL, Burp site map, ZAP sitemap,
  gospider/hakrawler): no claim survived verification. Aligning our
  skeleton with a crawler's output is an open design decision, not a recommendation.
- `[open]` **There is no OSS project to adopt**: the search for an MCP/plugin for
  "per-site navigation memory" over Playwright/CDP came back empty. Build, don't copy.

---

## Key sources (verified in the research)

- AWM — github.com/zorazrw/agent-workflow-memory · arxiv 2409.07429 (induce-store-reinject).
- Voyager — arxiv 2305.16291 (composable skill library). ExpeL — arxiv 2308.10144 (NL insights).
- Synapse — arxiv 2306.07863 (state abstraction against context bloat).
- Stagehand — browserbase.com/blog/stagehand-caching (re-record-on-drift). The caching
  detail is v3 and the reliable source is the BLOG, not the docs (3 docs claims refuted 1-2).
- workflow-use — github.com/browser-use/workflow-use (separate index; self-healing = vaporware).
- Locators — Leotta 2014 (ISSREW) · Kluge & Stocco 2025 (arxiv 2505.16424, Similo).
