# Study 02 — Modeling a site for agents: from the locator to the three-layer model

**Project:** tandem
**Date:** 2026-06-29
**Status:** research CLOSED; three-layer design = **hypothesis, NOT implemented**.
**Depends on:** `01-navigation-memory.md` (per-site navigation memory).
**Base research:**
- (a) Web search of 2025–2026 agents, done in session, **recent sources verified by reading the original text** (not search-engine summaries).
- (b) Deep-research via Perplexity on the classic background (IR, semantic web, web engineering, compact representation). Kept **in full** in `02-appendix-classic-background.md`.

> **Verification notice (anti-hallucination discipline).** The RECENT and decisive sources
> (WebChallenger, CowPilot, WebNavigator, ALLOY) were verified against the original text with
> literal quotes. The CLASSIC background sources (via Perplexity) are taken as **field consensus**
> without re-verifying one by one: they match established textbook knowledge. A claim that
> sounded powerful and turned out to be **smoke** is recorded as a closed path (Knowledge Topology, §1).
> Rule: no newly surfaced claim touches the design without passing through its source.
> **Erratas detected while re-verifying loose points of the appendix: see §«Verified erratas from the
> appendix» at the end** (SimHash misattributed, quad count 2022/2023, Schema.org universes).

---

## Problem / design question

Tandem's recon (Study 01) has an **authorship bias**: the agent explores the structure
(routes, locators) and **writes** the profile; the human only **confirms/corrects**. The human's model
—what matters, what is a trap, what flow makes sense— **has no input channel of its own**:
it enters as loose corrections (gotchas), never as a contribution. The map comes out as an *index of places*,
not as *territory with topology + intent*.

Question: **how do we capture the model of a site (topology + semantics + intent) in a
frugal way, with the human as AUTHOR and not just corrector?**

The distinction that orders everything that follows (do not mix them): **topology** (which route connects to which) is
*observable* structure — the agent sees it. **Intent** (what matters / what is a trap / the flow that
makes sense) **is not observable** — it lives in the human. They are two pieces with different owners.

---

## Part 1 — State of the art in web agents (verified in session)

| Work | What it contributes | Construction | Persists human model |
|---|---|---|---|
| **WebChallenger / PageMem** ([2606.10423](https://arxiv.org/abs/2606.10423), 9 jun 2026) | Reusable site memory; SOTA open-weight | **Automatic, deterministic, zero human** | **No** |
| **WebNavigator** ([2603.20366](https://arxiv.org/abs/2603.20366), mar 2026) | Interaction graph; names "Topological Blindness" | Automatic (BFS), zero LLM/human | No |
| **R2D2** ([ACL 2025](https://aclanthology.org/2025.acl-long.1464/)) | Observed map + A\* with LLM heuristic | Automatic (replay buffer) | No |
| **CowPilot** ([2501.16609](https://arxiv.org/abs/2501.16609), feb 2026) | Human+agent, SAME browser (≈ tandem) | Human **reactive** | **No** (persists nothing) |
| **ALLOY** ([2510.10049](https://arxiv.org/abs/2510.10049), oct 2025) | Human model **by demonstration**, semantic nodes + NL | Demonstration + refinement | Yes, but as a *task workflow*, not a site map |
| **UICOMPASS** ([EMNLP 2025](https://aclanthology.org/2025.emnlp-main.1346.pdf)) | "UI Map" = activities + semantic steps | — *(via summary, not literal)* | — |

Literal quotes that back what is decisive:

- **WebChallenger** — `WebsiteMem` *"is constructed once per site and reused across all subsequent
  tasks"*, stored *"per-site as JSON"*, frugal (*"only a handful of extra tokens per prompt"*).
  Construction: *"fully deterministic: it requires no LLM guidance, task demonstrations, or external
  resources"*. → **Validates tandem's architecture** (per-site memory, JSON, reused, frugal)
  and at the same time **is zero-human**.
- **CowPilot** — the human *"provide[s] contextual feedback by identifying and correcting prior
  mistakes"*; and *"no mechanism for persisting or reusing human input across different task sessions
  is described"*. → The closest analog to tandem has **exactly our gap**.
- **ALLOY** — *"each node represents a semantically meaningful sub-task rather than low-level browser
  operations"*, with *"a detailed natural language prompt"*. → A hint of **method** (demonstration) and of
  **frugal form** (node = semantic unit + intent phrase).

**Conclusion of Part 1:** the whole field converges on **auto-derived site memory**
(structure + behavior + topology). The gap —**human intent persisted in the site map**— is
covered by no one, **because the field is heading toward total autonomy and has no human in the
loop**. Tandem is the only system with a human inside **and** persistent memory: the only position
from which that gap is fillable. `[verified in session]`

**[closed path] "Knowledge Topology"** ([2603.14805](https://arxiv.org/abs/2603.14805)): the search-engine
summary presented it as a *"routing graph that answers what comes next"* — a definition
perfect for us. The original text **does not define it**: it is a bullet with no schema. The snippet
hallucinated. Lesson: verify against the source, always.

---

## Part 2 — Classic background (via Perplexity; field consensus, not re-verified one by one)

What pre-LLM knowledge contributes to tandem. Detail and full references in
`02-appendix-classic-background.md`.

**Validates pieces tandem already has, with theoretical pedigree:**
- `fingerprint.mjs` (structural skeleton, normalizes digits to `#`) = **structural hashing / DOM
  tree-edit-distance** (Zhang & Shasha, JACM 1989). Classic and still current.
- `sel:` template (`role=row[name=/^{id}/]` for rows) = **wrapper induction** (Kushmerick,
  IJCAI'97; DEPTA, IEEE TKDE 2006): inferring the template from template-generated pages.
- Operating on the snapshot (accessibility tree) and not the raw DOM = consensus: the a11y tree
  (WAI-ARIA) is ~10–100× more compact than the HTML; it is the de facto observation in WebArena.

**Gives the how-to keep the topology FRUGAL** (the obsession of Study 01):
- Modeling navigation as its own layer, separate from data and presentation: the **navigation model**
  of WebML (Ceri et al., 2000) and OOHDM (Schwabe & Rossi, 1995). The instinct "the map comes first"
  has 25 years of backing in web engineering.
- **Prune** the state graph (State Flow Graph) by *event productivity*: discard self-loops and
  state-independent events (thesis cited in the appendix, ref. 82). → topology without bloat.
- Collapse isomorphic pages (same template → one node). → frugal by construction.

**Contributes NEW material to the plugin — semantics declared by the site itself:**
- **Schema.org / JSON-LD** embedded in `<script type="application/ld+json">`: the site declares its
  typed entities (Product, Article, Organization…) without heuristics, in <2KB. Massive adoption
  (WebDataCommons: tens of millions of sites; the order of magnitude is solid, the exact figure wobbles).
  Tandem **does not read it today**. It is CONTENT semantics for free.

---

## Part 3 — Synthesis: the three-layer model  `[design HYPOTHESIS]`

Each layer has **a different owner** and a different degree of maturity:

- **Layer A — topology + structure.** *Owner: the machine (me).* Graph of page-classes +
  transitions observed while navigating. **State of the art already solved** (WebChallenger/R2D2): adopt,
  don't reinvent. Frugal via pruning (event productivity) + collapsing by template (wrapper induction);
  structural fingerprint already exists.
- **Layer B — declared semantics.** *Owner: the site.* Extract the JSON-LD/Schema.org from the pages.
  Free, typed, frugal. **New in tandem.** Reduces what the human has to contribute.
- **Layer C — human intent.** *Owner: the human.* What matters, what is a trap, the flow that
  makes sense. **It is in no DOM and in no `<script>`.** It is captured by demonstration (à la ALLOY)
  + interview —because the human is in the loop— and is persisted frugally: one intent phrase per
  route, with its own channel (today it only exists diffusely as gotchas).

The three, **fused into the persistent map**. A and B are supplied by the machine and the site (state of the art);
**C is tandem's unique contribution**, structurally impossible for an autonomous agent.

**The "for both" symbiosis, anchored:** it is not about splitting tasks. It is that two of the three
layers (A, B) are already state of the art that the machine and the site solve, and the human contributes the
third (C) that no autonomous agent can contribute. Tandem does not compete on autonomy with
WebChallenger —it would lose—; **it occupies the gap that autonomy leaves empty by construction**.

---

## Status and routes

- `[verified in session]` The gap —human intent persisted in shared site memory— **is not
  covered by the SOTA of jun 2026** (verified against WebChallenger, CowPilot, WebNavigator, ALLOY).
  Honest nuance: it is *absence as far as this search reaches*, not an absolute.
- `[partially tested, 2026-06-29]` The **frugal three-layer format**. Real recon of
  `books.toscrape` DONE (anchor task: extraction by categories, live through tandem's browser).
  Result:
  - **Layer A**: validated and frugal — the profile absorbed a whole task (categories, internal
    pagination, partition 50 children = 1000, root/general duplication trap) in ~6 lines, each one
    a verified fact. It did not bloat.
  - **Layer B**: **null** — the site declares no semantics (zero JSON-LD/microdata/RDFa/OG, verified).
    Confirms that B is **conditional, not universal**: a gift when it exists, absent in classic HTML
    (tandem's typical terrain).
  - **Layer C**: **not capturable here** — it is a sandbox with no real intent ("pure practice").
    Inventing it would be the authorship bias the study denounces, now from lack of stake.
  - **Honest conclusion:** in a sandbox, A+B+C **reduces to A**. The three-layer hypothesis
    is validated only on a site **with declared semantics (B)** and a **task with real stake (C)** →
    real terrain, not a toy. **Real next step:** repeat the experiment on a production site.
  - **Collateral finding** (independent of A/B/C): the `fingerprint` gate gives **false drift on
    list-routes** where `h3`=item title. Recorded in `docs/01` §T015 `[n=1]`.
- `[closed path]` "Knowledge Topology" as a framework — smoke (not defined in its source).
- `[open]` The **memory/persistence** leg (WebCoach with its *WebCondenser* traces→summary; M²;
  mem0) — not pursued in depth; could yield a condensation technique, but it is not the heart of the gap.
- `[open]` Layer B: decide whether the JSON-LD is stored in the profile or read on-demand while navigating.
- `[CLOSED: verified in the body of the PDF, 2026-06-29]` The three attributions that support the
  central argument, **confirmed with literal quotes from the body** (not the abstract):
  - **(a) WebsiteMem exists** — exact name of WebChallenger's SITE memory component
    (distinct from PageMem, which is per page). §2.2: *"A WebsiteMem ℳw contains all PageMems and
    elements encountered on a website w."*
  - **(b) "fully deterministic / no LLM guidance"** applies to the construction of the WebsiteMem, not
    just PageMem. §2.3: *"Exploration is fully deterministic: it requires no LLM guidance, task
    demonstrations, or external resources."*
  - **(c) WebNavigator uses BFS** — specifically *"Adaptive BFS"*. §3.1: *"a heuristic
    auto-exploration engine based on breadth-first search (BFS)"*.
  - **Nuance that reinforces the three-layer model:** in WebChallenger the *structural map* is
    deterministic and LLM-free (Appendix A.2 specifies that the traversal is *depth-first*, not BFS — that is
    WebNavigator), but the *semantic enrichment* (section summaries) is filled in with an LLM at
    inference and is **cached** inside the WebsiteMem. That is, the SOTA itself already separates
    cheap-deterministic-structure (≈ layer A) from expensive-LLM-semantics (≈ part of B) — exactly
    the cut this study proposes. `[verified observation, not a design decision]`

---

## Verified erratas from the appendix

The appendix `02-appendix-classic-background.md` is kept **in full** (it is the faithful copy of the
deep-research, untouched). These corrections are recorded here, not in it. Verified against
**primary source** on 2026-06-29 (not search-engine summaries).

- **[REFUTED] "Manber and Charikar (2002) introduced SimHash".** Double confabulation: (1) Charikar
  2002 ("Similarity Estimation Techniques from Rounding Algorithms", STOC 2002) is **sole author** —
  Manber does not appear ([DBLP](https://dblp.org/rec/conf/stoc/Charikar02.html) + PDF of the proceedings). (2) The
  term *"SimHash"* **does not appear** in that paper (0 occurrences; it describes LSH by random
  hyperplanes); the name is established by **Manku, Jain & Das Sarma (2007, WWW)**, who call it *"Charikar's
  simhash"* ([Google PDF](https://research.google.com/pubs/archive/33026.pdf)). Udi Manber is real but
  from another independent work 8 years earlier: *sif*, "Finding Similar Files in a Large File
  System", USENIX 1994 — no co-authorship with Charikar. **Correction:** the algorithm is Charikar's
  (2002); the label "simhash" is Manku et al.'s (2007); Manber (1994) is a separate line.

- **[FACTUAL ERROR] "The October 2023 release contains 86 billion RDF quads".** They are
  **97.7 billion** ([WebDataCommons 2023-12 stats](https://webdatacommons.org/structureddata/2023-12/stats/stats.html)).
  The 86 billion are from the **2022** release: the report crossed the 2022 quad count with the 2023
  statistics. The rest of the figures in that sentence are **correct** (3.35 billion
  pages; JSON-LD 9.5M sites, Microdata 7.4M, RDFa 0.5M).

- **[NUANCE, not an error] The two Schema.org figures do not measure the same universe.** "45M domains / 450
  billion objects" **is indeed an official quote** ([schema.org](https://schema.org) homepage, as of
  2024) — self-declared, round (10:1 ratio) and with no published methodology, but not invented by the
  report. It measures Google's **complete** index. The WebDataCommons figure (14.6M domains / 97.7B
  quads, [W3C announcement 2024-02-06](https://lists.w3.org/Archives/Public/public-schemaorg/2024Feb/0001.html))
  measures **Common Crawl** (partial sample). The appendix juxtaposes them as comparable; they are
  different methodologies (hence the ~3× difference). Treat 45M/450B as "official figure with no
  verifiable methodology", not as audited data.

- **[VERIFIED OK] The recent sources exist, none confabulated.** WebChallenger
  ([2606.10423](https://arxiv.org/abs/2606.10423)), WebNavigator ([2603.20366](https://arxiv.org/abs/2603.20366)),
  R2D2 (ACL 2025), CowPilot ([2501.16609](https://arxiv.org/abs/2501.16609)), ALLOY
  ([2510.10049](https://arxiv.org/abs/2510.10049)) resolve to real papers (arXiv / ACL
  Anthology API). WAI-ARIA 1.3 exists as a **W3C Working Draft of 2026-06-04** (not a Recommendation, as
  could be read from the appendix). Caveat on detail attributions: see the `[open]` route above.

---

## Sources

Recent (verified in session): WebChallenger ([2606.10423](https://arxiv.org/abs/2606.10423)) ·
WebNavigator ([2603.20366](https://arxiv.org/abs/2603.20366)) · R2D2 ([ACL 2025](https://aclanthology.org/2025.acl-long.1464/)) ·
CowPilot ([2501.16609](https://arxiv.org/abs/2501.16609)) · ALLOY ([2510.10049](https://arxiv.org/abs/2510.10049)) ·
UICOMPASS ([EMNLP 2025](https://aclanthology.org/2025.emnlp-main.1346.pdf), via summary).

Classic (via Perplexity, field consensus): see `02-appendix-classic-background.md` — Zhang &
Shasha 1989 · Kushmerick 1997 · Zhai & Liu 2006 · Ceri et al. 2000 · Schwabe & Rossi 1995 ·
WAI-ARIA / WebArena · Schema.org / WebDataCommons.
