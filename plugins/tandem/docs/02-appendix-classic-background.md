# Modeling, Indexing, and Structural Composition of Websites for Machines

> *Translated from the original Spanish deep-research (Perplexity). Factual erratas found when re-verifying against primary sources are tracked in [`02-site-modeling-for-agents.md`](02-site-modeling-for-agents.md).*

*Deep academic research · Axes: classic IR, Semantic Web, Web Engineering, Compact representation, Synthesis for agents · Coverage 1990–2026*

***

## Executive Summary

Understanding how a machine "reads" and navigates a website requires integrating at least five layers of knowledge: (1) the crawling and discovery algorithms that guide exploration of the hypermedia graph; (2) the indexing structures that enable efficient document retrieval; (3) the web graph as a mathematical object with well-studied topological properties; (4) the formalisms for modeling hypertexts and web applications that capture navigation and semantics in a structured way; and (5) the compact-representation techniques that compress that model into a minimally navigable form. Much of the most solid knowledge on these topics is *pre-LLM* —decades of research in Information Retrieval, Web Engineering, and Semantic Web— and it remains the substrate on which modern systems build.

***

## 1. WEB INDEXING AND INFORMATION RETRIEVAL

### 1.1 Crawling: Discovery and Frontier

Web crawling is fundamentally an instance of graph search over an enormous, dynamic hypermedia graph. The canonical reference of the field is the monograph by **Olston and Najork (2010)** in *Foundations and Trends in Information Retrieval*, which systematizes decades of practice. Its classic architecture consists of a *URL frontier* (queue of URLs to visit), a *fetcher*, a link *parser*, and deduplication and *politeness* modules.[^1][^2]

**Traversal policies.** The most studied policy is *Breadth-First Search* (BFS). **Cho, Garcia-Molina, and Page (1998, WWW '98)** showed that BFS discovers high-importance pages (measured by PageRank) faster than alternative strategies, because heavily linked pages are found earlier as multiple predecessors reference them. **Najork and Wiener (2001)** confirmed this result on a much larger corpus. The formal intuition is that a node's *in-degree* in the web graph correlates with its relevance, and BFS reaches high-degree nodes first.[^3][^4][^5]

**Politeness and respect for the server.** Since the first industrial crawlers (the original 1994 WebCrawler), the need to respect a minimum wait rate between requests to the same server was established. **Koster (1994)** formalized the *Robots Exclusion Protocol* (REP) through the `robots.txt` file, which lets webmasters declare which paths may or may not be explored by robots. RFC 9309 (IETF, 2022) elevated this de facto protocol to a formal standard, adding a precise definition of the language, error handling, and caching semantics. The standard was informally proposed in July 1994 and remained an unofficial convention for 28 years before its formalization.[^6][^7][^8][^9][^10][^11]

**XML Sitemaps.** In June 2005 Google introduced the *Sitemaps 0.84* protocol, which lets webmasters explicitly declare their site's URLs along with metadata for change frequency, relative priority, and last-modified date. In November 2006, MSN and Yahoo joined the consortium, raising the specification to *Sitemaps 0.90* as an industry standard at `sitemaps.org`. The XML schema (whose XSD was fixed on 2008-03-26) limits each file to 50,000 URLs and 50 MB. It is **established consensus** that the combination of `robots.txt` + `sitemaps.xml` constitutes the minimal courtesy interface for any crawler.[^12][^13][^14][^15]

**URL canonicalization and deduplication.** The same representation may be accessible under multiple URLs (session parameters, capitalization, trailing slashes, HTTP/HTTPS versions). Canonicalization normalizes these variants to a canonical URL. Deduplication at the *content* level is a separate and harder problem.

**Near-duplicate detection.** **Broder et al. (1997, SEQUENCES '97 / cited in AltaVista)** developed the mathematical foundations of document *resemblance* and *containment* through *shingling* (sets of overlapping word k-grams) and the *min-wise independent permutations* estimator (MinHash) to approximate the Jaccard similarity between two documents at web scale. The estimator is probabilistic but computable in time sublinear in the document size.[^16][^17]

**Manber and Charikar (2002)** introduced *SimHash*, a variant of *Locality Sensitive Hashing* (LSH) that maps each document to a fingerprint of *b* bits such that similar documents differ in few bits (small Hamming distance). Google adopted SimHash with 64-bit fingerprints for deduplication in its crawl of 8 billion pages, as documented by **Manku et al. (2007, WWW '07)**. **Henzinger (2006, SIGIR '06)** evaluated, at large scale (1.6 billion pages), Broder's shingling and Charikar's SimHash algorithms, concluding that SimHash achieves higher inter-site precision (0.50 vs. 0.38), and that a combined algorithm reaches precision 0.79 with 79% of the recall of the individual algorithms. These techniques are **classic and fully current**: SimHash remains the dominant deduplication algorithm in commercial search engines as of 2026.[^18][^19][^20][^21][^22]

### 1.2 Document Representation for Indexing

The data structure underlying all efficient information retrieval since the 1970s is the **inverted index**: for each term in the vocabulary, an ordered list of *postings* (docIDs) where the term appears is maintained. **Manning, Raghavan, and Schütze (2008)** —*Introduction to Information Retrieval*, Cambridge University Press— constitute the consensus textbook reference for this area. The explicit term-document index (a 0/1 or weighted matrix) is conceptually equivalent but computationally infeasible: given a vocabulary of ~1 million terms and ~1 million documents, the matrix has 10^12 entries, of which ~99.8% are zero. The inverted index stores only the non-zero positions, reducing the space to something proportional to the total number of term occurrences.[^23][^24][^25]

**Term weighting: TF-IDF and BM25.** The TF-IDF scheme (Term Frequency × Inverse Document Frequency) has been the foundation of ranking since the 1970s. The probabilistic model of **Robertson et al.** culminated in Okapi BM25, whose definitive form —including the TF-saturation corrections and document-length normalization— appears in **Robertson and Walker (1994)** and is described exhaustively in the TREC-series technical report. BM25 is **classic and fully current**: it remains the default baseline in all IR systems and is part of engines such as Elasticsearch, Solr, and Lucene.[^26][^27]

**Dense embeddings vs. sparse index.** The *Dense Passage Retrieval* (DPR) paradigm, introduced by **Karpukhin et al. (2020, ACL 2020)** of Facebook Research, showed that dense representations learned through a fine-tuned *dual-encoder* (based on BERT) outperform BM25 by 9–19 absolute points in top-20 passage recall on open-domain QA benchmarks. However, dense embeddings have weaknesses in *exact term matching* and in out-of-domain generalization, and they require costlier *approximate nearest neighbor* (ANN) infrastructure.[^28]

**Hybrid retrieval.** The dominant practical convergence in 2024–2026 is the hybrid model: **SPLADE** (Formal, Piwowarski, Clinchant, SIGIR 2021) introduces a *neurally sparse* retriever that learns term weights and vocabulary expansion, producing representations compatible with inverted indexes but with learned semantics. Production systems typically combine BM25 + dense embeddings via *Reciprocal Rank Fusion* (RRF) or a cross-encoder reranker, achieving improvements of 30–40% over BM25 alone on production benchmarks.[^29][^30][^31][^32][^33]

**Current state of the art:** Sparse indexes (BM25, SPLADE) are **classic and current** for exact matching and queries with technical terminology. Dense embeddings are the **recent frontier** for semantic search. The pure sparse model as the sole representation of documents is **classic and partially superseded** for semantic-retrieval applications, though not for web-scale indexing.

### 1.3 The Web as a Graph: Topology and Link Analysis

**PageRank.** **Brin and Page (1998, WWW '98)** formalized PageRank as the stationary distribution of a random walk over the web graph, with a teleportation factor \(\alpha\) (typically 0.85) that provides robustness against dangling nodes and sink structures. PageRank can be interpreted as the probability that a random user following links is on a given page. The variant with teleportation makes page ranking robust against small changes in topology, in contrast to HITS.[^34][^35]

**HITS (Hubs & Authorities).** **Kleinberg (1999, JACM 46:5)** introduced HITS, which defines two mutually reinforcing scores: *authority* (a page is an authority if it is pointed to by relevant hubs) and *hub* (a page is a hub if it points to relevant authorities). The iterations converge to the dominant eigenvectors of \(A^T A\) (authorities) and \(AA^T\) (hubs), where \(A\) is the adjacency matrix of the graph. HITS is more sensitive to the base set of pages considered and less robust to link farms than PageRank, as noted by **Ng et al. (2001)**.[^36][^37][^34]

**Bow-tie topology.** **Broder et al. (2000, Computer Networks 33)** analyzed two AltaVista crawls (~200 million pages, 1.5 billion links) and described the macroscopic structure of the web as a *bow-tie*: a giant central Strongly Connected Component (SCC) (≈28% of pages), an IN component of pages that point toward the SCC without receiving links back, an OUT component of pages reachable from the SCC but with no links back, and *tendrils* hanging off IN or OUT. This structure has practical consequences: 25% of pages (OUT) cannot reach the core by following forward links, which implies that a BFS crawler from random seeds may never discover important parts of the graph.[^38][^39][^40][^41]

**Revisiting the topology.** **Meusel et al. (2015, WWW '15)** re-examined the structure using Common Crawl and found that the SCC had grown to 51.8% of the graph (vs. 27.7% in Broder et al.) and the average degree had risen from 7.5 to 36.8, reflecting the densification of the web over 15 years. The bow-tie topology is a **classic and current consensus** as a macroscopic characterization, although the concrete component values vary with the crawl methodology.[^42][^38]

***

## 2. PAGE AND SITE COMPOSITION AND STRUCTURE

### 2.1 DOM: The Document Tree

The **Document Object Model** (DOM) is the internal representation the browser builds from the parsed HTML, modeling the document as a tree of nodes in which each element, attribute, and text is a node with a well-defined type, name, and parent-child relationships. The DOM Level 1 specification was published by the W3C in 1998, and has since evolved into the WHATWG Living Standard. The DOM is the universal programming interface for accessing and modifying the structure of a web page; every scraper, JavaScript crawler (Playwright, Puppeteer), and web agent operates on it.

**Semantic HTML and sectioning elements.** With HTML5 (W3C, draft 2008, recommendation 2014), a set of sectioning elements was introduced that express the document's *structural semantics* in a machine-readable way: `<nav>`, `<article>`, `<section>`, `<aside>`, `<header>`, `<footer>`, `<main>`. These elements let crawlers, screen readers, and agents identify which part of the DOM contains the main navigation, the editorial content, the header/footer boilerplate, etc., without heuristic analysis of CSS classes. The W3C specification states that each of these elements generates an implicit *landmark* in the accessibility tree.[^43][^44][^45][^46]

### 2.2 Accessibility Tree and ARIA

The **accessibility tree** is a representation parallel to the DOM that exposes the document's semantics to assistive technologies (screen readers) and, crucially for machine modeling, to automation tools and agents. Each node of the accessibility tree has: *role* (its semantic function), *name* (descriptive label), *state* (expanded, selected, etc.), and *properties* (ARIA relationships). The **WAI-ARIA 1.1** specification (W3C, 2017; currently WAI-ARIA 1.3, W3C 2026) defines the formal vocabulary of roles and properties.[^47][^48]

**ARIA (Accessible Rich Internet Applications)** was designed so that complex JavaScript widgets (trees, grids, menus, progress bars) can expose their semantics through the accessibility tree when native HTML elements are not sufficient. The "First Rule of ARIA" states that if a native HTML element with the required semantics exists, it must be used instead of ARIA; ARIA is a fallback for widgets without a native equivalent. WebAIM surveys show that pages with misused ARIA have 41% more detected errors than those that do not use it.[^49][^50]

**Relevance for agents.** WebArena (Liu et al., 2023), the de facto benchmark for LLM web agents, models the agent's observation as a triple: screenshot, raw HTML, and **accessibility tree**. The most efficient representation for agents turns out to be the accessibility tree, not the full HTML, because it eliminates the visual boilerplate and preserves only the interactive and semantic nodes with their roles and names.[^51][^52]

### 2.3 Semantic Web: Embedded Structured Data

The question "what makes a page machine-readable?" has a formal answer in the **Semantic Web** stack, an agenda launched by **Berners-Lee et al. (2001, Scientific American)** and technically articulated in the document *Linked Data Design Issues* (Berners-Lee, W3C, 2006). The four rules of Linked Data are: use URIs as names for things; use HTTP URIs; serve RDF when the URI is resolved; include links to other URIs.[^53]

The main serialization formats for structured data embedded in HTML are:

- **Microdata** (HTML5 Working Group, 2009): extends HTML with the `itemscope`, `itemtype`, `itemprop` attributes. It was the first format supported by Schema.org.[^54]
- **RDFa** (W3C Recommendation, 2008; RDFa Lite 1.1, 2012): serialization of RDF triples within HTML, using the `vocab`, `typeof`, `property` attributes. It is more aligned with the Linked Data community.[^55][^54]
- **JSON-LD** (W3C Recommendation, 2014): serialization of RDF graphs as JSON embedded in a `<script type="application/ld+json">` tag, proposed by the W3C JSON-LD Community Group. Google officially recommends it for its clean separation from presentation HTML.[^56][^57]

**Schema.org** is the reference vocabulary for all these formats, founded in 2011 by Google, Microsoft, Yahoo, and Yandex. As of 2024, more than **45 million domains** mark up their pages with more than **450 billion** Schema.org objects. WebDataCommons (Brinkmann et al., 2024) annually extracts the structured-data corpus from Common Crawl; the October 2023 release contains **86 billion RDF quads** from 3.35 billion HTML pages, with JSON-LD present on 9.5 million sites, Microdata on 7.4 million, and RDFa on 0.5 million.[^58][^59][^60][^61]

**OpenGraph** (Facebook, 2010) and **Twitter Cards** (Twitter, 2012) are simpler vocabularies, based on meta tags, aimed at controlling page previews on social networks. They are not RDF-compatible but are widely adopted.

**State of the art:** The full Semantic Web (OWL, SPARQL, reasoning) is **classic and not massively adopted**. Schema.org with JSON-LD is **classic-recent and fully current**, with adoption on >50% of web pages. Embedded structured data is the most direct practical route for a machine to extract entities and relationships from a page without heuristic analysis.[^60]

***

## 3. FORMAL MODELING OF WEB APPLICATIONS

### 3.1 The Dexter Hypertext Model

The **Dexter Hypertext Reference Model**, developed at the *Workshops on Hypertext Standardization* organized by Walker and Leggett (first workshop: Dexter Inn, New Hampshire, October 1988), formalized in **Halasz and Schwartz (1990, NIST Hypertext Standardization Workshop; definitive version 1994, CACM 37)**, is the first serious attempt to capture the fundamental abstractions of hypertext systems.[^62][^63][^64][^65]

Dexter defines three layers: the **storage layer** (network of nodes and links with global UIDs), the **run-time layer** (user interaction), and the **within-component layer** (internal structure of a node). The model is general enough to describe links between links and composite components (composite components that recursively contain other components). The *anchoring* mechanism separates the identifier of an access point (anchor ID, stable) from its position in the content (anchor value, variable). Dexter is **classic and foundational**: all subsequent hypertext terminology —nodes, anchors, links, traversal— derives from this model.

### 3.2 OOHDM

The **Object-Oriented Hypermedia Design Model (OOHDM)**, developed by **Schwabe and Rossi (1995, CACM 38:8; Hypertext '96; refined in 1998)** at PUC-Rio, proposes designing hypermedia applications in four stages: conceptual design (OO domain model), navigational design (navigational views as navigational classes and navigational contexts), abstract interface design (technology-independent interface objects), and implementation. The key innovation is that *navigational nodes are views (in the database sense) over the domain objects*, and the *navigational space is specified separately from the domain model*, allowing multiple views of the same content for different user profiles. OOHDM is **classic and foundational** for web-engineering methodologies; its conceptual/navigational/presentation separation influenced all subsequent methods.[^66][^67][^68]

### 3.3 WebML

**WebML (Web Modeling Language)**, introduced by **Ceri, Fraternali, and Bongio (2000, Computer Networks 33:1-6)** of the Politecnico di Milano, provides a graphical and textual (XML) notation for specifying complex websites under five orthogonal models:[^69][^70][^71]

1. **Structural model**: data content (entities, relationships, similar to E/R).
2. **Composition model**: pages as containers of content units (*WebML units*).
3. **Navigation model**: link topology between pages and units.
4. **Presentation model**: layout and rendering requirements.
5. **Personalization model**: one-to-one content delivery.

WebML specifications are independent of the client language and the server platform. A formal semantics of WebML was later defined through **Statecharts** to capture navigation behavior and page *data fills*. WebML is **classic**: its CASE tool (ToriiSoft) never reached massive adoption, but the model-driven approach was a precursor of the MDA frameworks.[^70]

### 3.4 UWE

**UWE (UML-based Web Engineering)**, developed by **Koch and Kraus (2002, 2003; full description in Koch et al., 2008)** at LMU Munich, defines a conservatively extensible metamodel of the UML metamodel, adding four web-specific models: requirements model, content model, navigation model, and presentation model. UWE uses standard UML *stereotypes* to represent web concepts, which allows the use of commercial UML tools (such as ArgoUWE). It is **classic and academically relevant**; its main contribution was integrating web methods with the UML/MDA ecosystem.[^72][^73][^74][^75]

### 3.5 Hera

**Hera**, presented by **Frasincar, Houben, and Barna (WWW 2002; extended in 2003)**, is a methodology based on RDF and XSLT that separates the semantic conceptual description of the data (in RDF/OWL), the hypermedia navigation aspects, and the presentation rendering. Hera is notable because it was the first web-engineering methodology to use Semantic Web technologies (RDF, XML, XSLT) as its implementation basis, formally connecting web-application modeling with the Semantic Web agenda.[^76][^77]

### 3.6 Statecharts for Hypermedia Navigation

The **Statecharts** formalism of **Harel (1987, Science of Computer Programming 8:3)** —an extension of finite-state machines with hierarchy, concurrency, and broadcast communication— has been applied directly to modeling web navigation. **Laufer et al. (1997, ACM Hypertext '97)** proposed **HMBS (Hypertext Model Based on Statecharts)**, which uses the structure and execution semantics of statecharts to specify both the structural organization and the browsing semantics of a hyperdocument. A navigation statechart models pages as states, clicks as events, and the back-button behavior as history memory, capturing tab concurrency as orthogonal states.[^78][^79][^80][^81]

This line —application to crawling and testing of web applications— was developed extensively in *model-based testing* research: web-application models are represented as **State Flow Graphs (SFGs)**, where the states are DOM snapshots and the transitions are user events, and the similarity between states is measured with *tree edit distance* over the DOM.[^82]

### 3.7 Information Architecture

**Rosenfeld and Morville** (1998, O'Reilly, *Information Architecture for the World Wide Web*) systematized the discipline of IA for the web, defining the four fundamental systems of a site: **organization** (hierarchical, faceted, matrix taxonomies), **navigation** (browsing and orientation mechanisms), **search** (local indexing), and **labeling** (choice of terms). IA centers design on the user's mental model, not on the underlying technology. Their contributions are **classic and current**: the terminology of hierarchies, taxonomies, and faceted navigation remains the basis of IA design in any site or application.[^83]

***

## 4. COMPACT REPRESENTATION OF STRUCTURE

### 4.1 State Abstraction and Structural Fingerprinting

Managing the state space of a web application requires abstracting states that, while functionally equivalent, differ in irrelevant details (timestamps, counters, ads). The classic approaches to state abstraction apply heuristics over the DOM:

1. **DOM tree edit distance**: The tree edit distance between two DOMs \(t_1\) and \(t_2\) is defined as the minimum number of atomic operations (insert, delete, re-label a node) that transforms \(t_1\) into \(t_2\). **Zhang and Shasha (1989, JACM)** demonstrated an \(O(n^2)\) algorithm for ordered labeled trees. The normalized diversity \(DD(s_i, s_j) = TED(t_i, t_j) / \max(|t_i|, |t_j|)\) is used to discriminate states in web-application crawlers [^82].

2. **Structural hashing**: a hash of the DOM skeleton (ignoring textual content and variable-valued attributes) produces a structural fingerprint. Two pages with the same fingerprint are candidates to be the same template instantiated with different data. This technique is central to **wrapper induction** (see §4.2) and to crawling systems for modern JavaScript applications.

3. **Content SimHash**: the same 64-bit SimHash used for near-duplicate detection at the content level also serves as a fingerprint to detect that a URL generates a page substantially identical to one already crawled.[^84][^85][^18]

### 4.2 Wrapper Induction and Extraction of Repeated Structures

**Wrapper induction**, introduced by **Kushmerick, Weld, and Doorenbos (IJCAI 1997)** as the first formal technique for machine learning of extraction wrappers, defines *wrapper classes* that can be learned inductively from labeled examples. The `hlrt` class (head-left, right-tail), formally defined in the paper, can be learned efficiently and covers 48% of the web resources in the original sample; the more expressive classes in the paper cover, in total, 70% of the surveyed sites.[^86][^87][^88][^89]

The fundamental idea of wrapper induction is that template-generated HTML pages exhibit **repeated structure**: the items of a catalog, the results of a search, the entries of a blog share the same local DOM tree modulo the content. Inferring that template (the *wrapper*) is equivalent to inferring the page's generation model. **Kushmerick (2000, Artificial Intelligence)** extended the 1997 work with the WIEN system, adding PAC complexity analysis.[^86]

**DEPTA (2006)** by **Zhai and Liu (IEEE TKDE 2006)** extended wrapper induction to extraction based on *partial trees*, handling data sources with multiple non-contiguous data regions within the same DOM tree. Extracting repeated structures from the DOM is **classic and fully current**: it is the basis of tools such as Scrapy, Playwright-based scrapers, and modern extractors such as Playwright + LLM.[^90]

### 4.3 Compression of the Site Model

Compressing a site's topology into a minimally navigable graph requires three operations:

1. **Collapsing isomorphic pages**: pages that are instances of the same template (same structural DOM fingerprint but different content) are collapsed into a single node in the site model, with an edge representing "navigate to an instance of the product list".

2. **Elimination of trivial absorbing states**: DOM states that are self-loops (the DOM does not change after the event) or state-independent events are elided from the SFG according to the *event productivity* criterion.[^82]

3. **Representation as a URL graph with semantics**: the site's navigation topology is represented as a directed graph where the nodes are page classes (not individual pages) and the edges are transition types (link navigation, form submission, AJAX call). This is the representation used by crawler-based site model inference tools for *model-based testing*.

***

## 5. APPLIED SYNTHESIS: MINIMAL AND NAVIGABLE REPRESENTATIONS

### 5.1 The Known Minimal Ways to Represent a Site

After thirty years of research, there is convergence on which layers a minimal, navigable representation of a site for a machine agent should have:

**Layer 1 — URL Graph (pure topology).** A directed graph of URLs or URL-patterns, where the arcs are links or navigational actions. It is the most compact model: topology only, no semantics. Sufficient for crawling and PageRank analysis. Its limitation is that it does not distinguish the type or purpose of the nodes.

**Layer 2 — Structural DOM sketch per node.** For each page class (template), a structural DOM skeleton (with ARIA roles, HTML5 semantic elements, XPath of data anchors) that lets the agent know which actions are possible from that class. This representation, which **WebChallenger (2026)** calls **PageMem**, is built deterministically from the DOM and exposes each page as a hierarchy of semantic sections with short summaries.[^91][^92][^93]

**Layer 3 — Schema.org / JSON-LD as declarative semantics.** The structured data embedded in pages provides entity semantics (Product, Article, Organization, Event, etc.) without heuristic analysis. An agent that extracts the JSON-LD graphs from the pages obtains an explicit, strongly typed semantic representation of the content.

**Layer 4 — Site-level memory (map of pages and behaviors).** WebChallenger empirically demonstrates that an agent that performs a single lightweight exploration of the site to build a **reusable map of pages and element behaviors** reaches 56.3% on WebArena, 48.7% on VisualWebArena, and 70.9% on WorkArena using open-weight models without fine-tuning, approaching higher-cost proprietary systems. The explicit site-navigation memory structure is the state of the art as of June 2026.[^92][^91]

### 5.2 Classic Techniques: Current vs. Superseded

**Classic and fully current:**
- Robots.txt (RFC 9309) + XML Sitemaps as a courteous crawling protocol: there is no alternative.
- BFS as a crawl policy for discovering high-importance pages.
- Inverted index + BM25 as the IR baseline.
- SimHash (64 bits) for near-duplicate detection at web scale.
- PageRank for ranking pages in the graph.
- Wrapper induction / DOM template inference for structured extraction.
- Schema.org / JSON-LD for entity semantics.
- Accessibility tree (WAI-ARIA) as a semantic representation of the DOM for agents.

**Classic and partially superseded:**
- HITS: superseded by PageRank in robustness (more sensitive to link farms, less stable); still used in specialized graph analyses.
- Microdata and RDFa: not technically superseded, but JSON-LD is today the format preferred by Google and most tools.
- WebML, OOHDM, UWE: formal design tools and processes not adopted industrially, but the *concepts* (conceptual/navigational/presentation separation) remain relevant.
- Pure TF-IDF: superseded by BM25 and by hybrid dense+sparse retrieval.

**Recent and at the active frontier:**
- Dense embeddings (DPR, ColBERT) + ANN for semantic retrieval.
- Hybrid retrieval (BM25 + embeddings + reranker) as the dominant architecture in RAG.
- PageMem / structured site-memory for LLM web agents.
- Accessibility tree as input representation for agents (2023–2026).

***

## 6. TABLE OF REUSABLE TECHNIQUES

| Technique | What it solves | Cost / Weight | Maturity |
|---|---|---|---|
| **robots.txt (RFC 9309)** | Crawler access policy; politeness | Negligible: text file <10KB | IETF standard (2022); universal adoption |
| **sitemaps.xml** | Explicit URL discovery; relative priority | XML, max 50K URLs / 50MB per file | Industry standard (sitemaps.org, 2006) |
| **BFS frontier** | Crawling policy that prioritizes high-degree pages | O(V+E) memory in the frontier | Consensus (Cho et al. 1998; Olston & Najork 2010) |
| **SimHash (64 bits)** | Near-duplicate detection of documents at web scale | 8 bytes per document; O(n) generation | Production (Google, 2007); current as of 2026 |
| **MinHash / Shingles** | Jaccard similarity estimation between documents | Configurable (k signatures); higher recall | Classic (Broder 1997); basis of modern LSH |
| **Inverted index + BM25** | Efficient per-term retrieval; probabilistic ranking | Configurable; Elasticsearch/Lucene | Universal baseline; classic and current |
| **SPLADE (learned sparse)** | Semantic vocabulary expansion + inverted index | Inference overhead vs. BM25; compatible index | Frontier (Formal et al. SIGIR 2021) |
| **Dense embeddings (DPR/ColBERT)** | Zero-shot semantic retrieval; cross-lingual | ANN index (~100ms/query); >VRAM | Frontier (Karpukhin et al. 2020) |
| **PageRank** | Ranking pages by importance in the link graph | O(kE) for k power-method iterations | Classic (Brin & Page 1998); current in crawlers |
| **DOM Accessibility Tree (WAI-ARIA)** | Semantic representation of the DOM for agents | Subset of the DOM; ~10–100x more compact than raw HTML | W3C standard (WAI-ARIA 1.3, 2026); used in WebArena |
| **Schema.org / JSON-LD** | Declarative entities and relationships in the page | Script tag <2KB; minimal overhead | Industry standard; 50%+ of websites (2023) |
| **Wrapper induction (WIEN/DEPTA)** | Automatic inference of DOM templates; structured extraction | Requires 5–20 training examples | Classic (Kushmerick 1997); basis of modern scrapers |
| **Tree edit distance over DOM** | Structural comparison of web states; state deduplication | O(n²) in number of DOM nodes | Classic (Zhang & Shasha 1989); current in testing |
| **Structural DOM hashing (PageMem)** | Compact representation of page template for agents | Deterministic from the DOM; reusable | Recent frontier (WebChallenger 2026) |
| **Statecharts / SFG web** | Formal modeling of navigation as a state machine | Proportional to the site's state space | Classic (Harel 1987; HMBS 1997); current in testing |
| **Bow-tie topology analysis** | Site crawlability diagnosis; component analysis | Requires full crawl; O(V+E) | Classic (Broder et al. 2000); analysis tool |
| **Site-level memory map** | Persistent map of pages and behaviors for LLM agents | A single exploratory traversal of the site | Active frontier (WebChallenger, 2026) |

***

## Primary References by Axis

**Crawling:** Cho et al. (1998, WWW '98) · Najork & Wiener (2001) · Koster (1994, Robots.txt) · RFC 9309 (IETF, 2022) · Olston & Najork (2010, *Foundations and Trends in IR* 4:3)

**Near-duplicate:** Broder et al. (1997, SEQUENCES) · Charikar (2002, STOC, *Similarity Estimation Techniques from Rounding Algorithms*) · Manku et al. (2007, WWW '07) · Henzinger (2006, SIGIR '06)

**Web Graph:** Brin & Page (1998, WWW '98) · Kleinberg (1999, *JACM* 46:5) · Broder et al. (2000, *Computer Networks* 33) · Meusel et al. (2015, WWW '15)

**IR/Indexing:** Manning, Raghavan & Schütze (2008, *Introduction to Information Retrieval*, Cambridge UP) · Robertson & Walker (1994, TREC-3) · Karpukhin et al. (2020, ACL) · Formal, Piwowarski & Clinchant (2021, SIGIR)

**Modeling:** Halasz & Schwartz (1990/1994, NIST/CACM) · Schwabe & Rossi (1995, CACM 38:8) · Ceri, Fraternali & Bongio (2000, *Computer Networks* 33:1-6) · Koch & Kraus (2002/2003/2008, LMU Munich) · Frasincar et al. (2002/2003, WWW) · Harel (1987, *Science of Computer Programming* 8:3) · Laufer et al. (1997, ACM Hypertext '97)

**Semantic Web:** Berners-Lee (2006, W3C Design Issues) · W3C JSON-LD 1.1 (2020) · Schema.org · WebDataCommons (Brinkmann et al., 2024) · WAI-ARIA 1.3 (W3C, 2026)

**Extraction:** Kushmerick, Weld & Doorenbos (1997, IJCAI) · Kushmerick (2000, *Artificial Intelligence*) · Zhai & Liu (2006, IEEE TKDE)

**Modern agents:** Liu et al. (2023, WebArena) · WebChallenger (2026, arXiv:2606.10423)

---

## References

1. [Web Crawling | Foundations and Trends in Information Retrieval](https://dl.acm.org/doi/abs/10.1561/1500000017) - This survey outlines the fundamental challenges and describes the state-of-the-art models and soluti...

2. [Cite](https://scholar.google.com/scholar_lookup?title=Web+crawling&author=Olston%2C+C.&author=Najork%2C+M.&publication_year=2010&journal=Found.+Trends+Inf.+Retr.&volume=4&pages=175%E2%80%93246&doi=10.1561%2F1500000017)

3. [Efficient Crawling Through URL Ordering](http://ilpubs.stanford.edu:8090/347/) - In this paper we study in what order a crawler should visit the URLs it has seen, in order to obtain...

4. [[PDF] Breadth-First Search Crawling Yields High-Quality Pages](https://marc.najork.org/papers/www2001.pdf) - This paper extends the results of Cho et al. regarding the effectiveness of crawling in breadth-firs...

5. [[PDF] Efficient Crawling Through URL Ordering](http://ilpubs.stanford.edu:8090/347/1/1998-51.pdf)

6. [rfc9309.txt - » RFC Editor](https://www.rfc-editor.org/rfc/rfc9309.txt)

7. [Robots Exclusion Protocol](https://dl.acm.org/doi/10.17487/RFC9309)

8. [Robots.txt - Web Design Museum](https://www.webdesignmuseum.org/web-design-history/robots-txt-1994) - Martijn Koster presented the robots.txt standard (Robots exclusion standard or Robots exclusion prot...

9. [A Standard for Robot Exclusion](https://webdoc.gwdg.de/ebook/aw/1999/webcrawler/mak/projects/robots/norobots-rfc.html) - References [1] Koster, M., "A Standard for Robot Exclusion", http://info ... " RFC 1590, USC/ISI, Ma...

10. [RFC 9309: Robots.txt Is Now an Official IETF Internet Standard ...](https://www.searchengineworld.com/rfc9309-robots-txt-quietly-became-an-official-internet-standard) - 1994 Origin. Martijn Koster proposes the Robots Exclusion Protocol after early crawlers hammer serve...

11. [Paper | Illyes: The case for the Robots Exclusion Protocol](https://datatracker.ietf.org/doc/slides-aicontrolws-the-case-for-the-robots-exclusion-protocol/) - In 1994, Martijn Koster (a webmaster himself) came up with the idea of robots.txt after automatic cl...

12. [Sitemaps-Protokoll – Wikipedia](https://de.wikipedia.org/wiki/Sitemap.xml)

13. [Sitemaps - Wikipedia](https://en.wikipedia.org/wiki/Sitemaps)

14. [[XML] https://www.sitemaps.org/schemas/sitemap/sitemap.xsd](https://www.sitemaps.org/schemas/sitemap/sitemap.xsd)

15. [Google Sitemaps](https://www.xml.com/pub/a/2005/10/26/google-site-maps.html)

16. [On the Resemblance and Containment of Documents](https://paperswelove.org/papers/on-the-resemblance-and-containment-of-documents-973f823a/) - We develop the mathematical foundations for the analysis of the resemblance and containment of docum...

17. [On the resemblance and containment of documents](https://www.cs.princeton.edu/courses/archive/spr05/cos598E/bib/broder97resemblance.pdf)

18. [[PDF] Detecting Near-Duplicates for Web Crawling - Google Research](https://research.google.com/pubs/archive/33026.pdf) - Luckily,. Charikar's simhash technique with 64-bit fingerprints seems to work well in practice for a...

19. [[PDF] Similarity Estimation Techniques from Rounding Algorithms](https://www.cs.princeton.edu/courses/archive/spr04/cos598B/bib/CharikarEstim.pdf) - ABSTRACT. A locality sensitive hashing scheme is a distribution on a family F of hash functions oper...

20. [Finding near-duplicate web pages: A large-scale evaluation of ...](https://research-explorer.ista.ac.at/record/11929) - Henzinger M. 2006. Finding near-duplicate web pages: A large-scale evaluation of algorithms. 29th An...

21. [[PDF] Finding Near-Duplicate Web Pages: A Large-Scale Evaluation of ...](https://www3.cs.stonybrook.edu/~cse692/papers/henzinger_sigir06.pdf) - Let S(d) be the set of shingles of page d. Alg. B makes the assumption that the percentage of unique...

22. [Finding near-duplicate web pages: a large-scale evaluation of algorithms](https://dl.acm.org/doi/10.1145/1148170.1148222) - Broder et al. 's [3] shingling algorithm and Charikar's [4] random projection based approach are con...

23. [Lec 1 IR | PDF | Search Engine Indexing | Information Retrieval](https://www.scribd.com/document/676426029/lec1IR) - This document provides an introduction to information retrieval and describes some key concepts. It ...

24. [Introduction to Information Retrieval - Stanford NLP Group](https://nlp.stanford.edu/IR-book/information-retrieval-book.html) - Manning, Prabhakar Raghavan and Hinrich Schütze, Introduction to Information Retrieval, Cambridge Un...

25. [Christopher D. Manning, Prabhakar Raghavan, and Hinrich Schütze: Introduction to information retrieval: Cambridge University Press, Cambridge, England, 2008, 482 pp, ISBN: 978-0-521-86571-5](https://dl.acm.org/doi/10.1007/s10791-009-9115-y)

26. [Sparse vs Dense Retrieval for RAG: BM25, Embeddings, and Hybrid ...](https://mljourney.com/sparse-vs-dense-retrieval-for-rag-bm25-embeddings-and-hybrid-search/) - A practical comparison of sparse retrieval (BM25), dense retrieval (embeddings), and hybrid search f...

27. [A probabilistic model of information retrieval](https://www.staff.city.ac.uk/~sbrp622/blockbuster.html)

28. [Dense Passage Retrieval for Open-Domain Question Answering](https://arxiv.org/abs/2004.04906) - Open-domain question answering relies on efficient passage retrieval to select candidate contexts, w...

29. [How to Combine Dense and Sparse Embeddings for Better Search ...](https://particula.tech/blog/hybrid-embeddings-dense-sparse-search) - Dense embeddings miss exact keywords. Sparse embeddings miss semantic meaning. Hybrid search combine...

30. [Sparse Meets Dense: A Hybrid Approach to Enhance Scientific Document Retrieval](https://ar5iv.labs.arxiv.org/html/2401.04055) - Traditional information retrieval is based on sparse bag-of-words vector representations of document...

31. [[PDF] Hybrid Sparse–Dense Retrieval: A Study of Methods, Challenges ...](https://jicds.journals.ekb.eg/article_474752_0d28b0f07f856acd972fe01040e443a0.pdf) - Traditional sparse retrieval models, such as BM25 and learned sparse retrievers like SPLADE++, rely ...

32. [Sparse Lexical and Expansion Model for First Stage Ranking](https://dl.acm.org/doi/10.1145/3404835.3463098) - In this work, we present a new first-stage ranker based on explicit sparsity regularization and a lo...

33. [Sparse Lexical and Expansion Model for First Stage Ranking](https://www.semanticscholar.org/paper/SPLADE:-Sparse-Lexical-and-Expansion-Model-for-Formal-Piwowarski/1e8a6de5561f557ff9abf43d538d8d5e9347efa0) - SPLADE: Sparse Lexical and Expansion Model for First Stage Ranking · Thibault Formal, Benjamin Piwow...

34. [References and further reading](https://nlp.stanford.edu/IR-book/html/htmledition/references-and-further-reading-21.html) - References and further reading

35. [Deeper Inside PageRank](https://www.stat.uchicago.edu/~lekheng/meetings/mathofranking/ref/langville.pdf)

36. [PowerPoint Presentation](https://www.cs.cornell.edu/courses/cs5306/2016sp/notes/Lecture18.pdf)

37. [mc059900604p](https://www.cs.cmu.edu/~christos/courses/826-resources/PAPERS+BOOK/kleinberg99authoritative.pdf)

38. [The Graph Structure in the Web](https://jshun.csail.mit.edu/6886-s18/lectures/lecture3-2.pdf)

39. [The world wide web is like a bow tie | by Nathan Smith - Medium](https://medium.com/neo4j/the-world-wide-web-is-like-a-bow-tie-discovering-graph-structure-with-neo4j-5d1b684cd4ee) - Explore concepts from a classic paper on the structure of the web using Neo4j’s strongly connected c...

40. [[PDF] Web Structure - SCC: OUT: Tendrils](https://sites.harding.edu/fmccown/classes/comp4750-f19/hw/Web-structure-homework.pdf)

41. [[PDF] Graph structure in the Web - SNAP: Stanford](https://snap.stanford.edu/class/cs224w-readings/broder00bowtie.pdf) - We report on experiments on local and global properties of the Web graph using two AltaVista crawls ...

42. [[PDF] Graph Structure in the Web — Revisited - Uni Mannheim](https://www.uni-mannheim.de/media/Einrichtungen/dws/Files_Research/Web-based_Systems/pub/Meusel-etal-GraphStructureOfTheWeb.pdf)

43. [4.4 Sections — HTML5 - W3C](https://www.w3.org/TR/2010/WD-html5-20101019/sections.html)

44. [Html/Training/Sections - W3C Wiki](https://www.w3.org/wiki/Html/Training/Sections)

45. [Using HTML5 section elements - WCAG WG - W3C](https://www.w3.org/WAI/GL/wiki/Using_HTML5_section_elements)

46. [section>](https://web.dev/learn/html/headings-and-sections) - How to correctly use sectioning elements to give meaning to your content.

47. [ARIA in HTML - W3C](https://www.w3.org/TR/html-aria/) - This specification defines the authoring rules (author conformance requirements) for the use of Acce...

48. [Accessible Rich Internet Applications (WAI-ARIA) 1.3 - W3C](https://www.w3.org/TR/wai-aria-1.3/) - WAI-ARIA is a technical specification that provides a framework to improve the accessibility and int...

49. [ARIA - Accessibility - MDN Web Docs - Mozilla](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA) - ARIA supplements HTML so that interactions and widgets commonly used in applications can be passed t...

50. [Using ARIA - W3C](https://www.w3.org/TR/2017/WD-aria-in-html-20170417/)

51. [WebArena: A Realistic Web Environment for Building Autonomous ...](https://arxiv.org/html/2307.13854v4)

52. [CS6200 Information Retrieval](https://www.khoury.northeastern.edu/home/vip/teach/IRcourse/2_indexing_ngrams/lecture_notes/indexing/Indexing.pdf)

53. [Linked Data - Design Issues - W3C](https://www.w3.org/DesignIssues/LinkedData.html) - This article discusses solutions to these problems, details of implementation, and factors affecting...

54. [Choosing a Serialisation](https://www.w3.org/community/schemabibex/wiki/Choosing_a_Serialisation)

55. [Dual implementation of structured data with JSON-LD and ...](https://wet-boew.github.io/wet-boew-documentation/decision/8.html) - Define a best practice on how to combine structured data with JSON-LD and RDFa in a single web page.

56. [Schema.org and JSON-LD](https://blog.schema.org/2013/06/03/schema-org-and-json-ld/) - W3C's work on JSON-LD provides mechanisms for interpreting structured data in JSON that promotes int...

57. [JSON-LD vs Microdata vs RDFa: Which to Use | AuthorityStack.ai](https://authoritystack.ai/blog/json-ld-vs-microdata-vs-rdfa) - Google officially recommends JSON-LD, and here's the specific reason most SaaS teams and agencies sh...

58. [Schema.org - Schema.org](https://schema.org) - Schema.org vocabulary can be used with many different encodings, including RDFa, Microdata and JSON-...

59. [Schema.org - Wikipedia](https://en.wikipedia.org/wiki/Schema.org)

60. [[ANN] WebDataCommons releases 97.7 billion quads Microdata, Embedded JSON-LD, RDFa, and Microformat data originating from 14.6 million websites from Alexander Brinkmann on 2024-02-06 (public-schemaorg@w3.org from February 2024)](https://lists.w3.org/Archives/Public/public-schemaorg/2024Feb/0001.html)

61. [Microdata, RDFa, JSON-LD, and Microformat Data Sets](https://webdatacommons.org/structureddata/)

62. [2.2.2 The Dexter Hypertext Reference Model](https://mprove.de/visionreality/text/2.2.2_dexter.html) - Vision and Reality of Hypertext and Graphical User Interfaces, mprove 2002

63. [Design issues for a Dexter-based hypermedia system](https://cs.au.dk/~kgronbak/homepage/pubs/CACM_issues.pdf)

64. [Dexter Hypertext Reference Model](https://cyberartsweb.org/cpace/ht/christanto/dexter_model.htm)

65. [The Dexter Hypertext](https://media.inhatc.ac.kr/papers/hypermedia/Dexter90.pdf)

66. [[PDF] The Object-Oriented Hypermedia Design Model (OOHDM)](https://www.semanticscholar.org/paper/The-Object-Oriented-Hypermedia-Design-Model-(OOHDM)-Schwabe-Rossi/ddab7c0b4196e8b2a63b5ebe91bf5afc9919cbb4) - The Object-Oriented Hypermedia Design Model (OOHDM) · D. Schwabe, G. Rossi · Published 1995 · Comput...

67. [[PDF] The Object Oriented Hypermedia Design Method - - turingMachine](https://www.turingmachine.org/courses/2003/hypermediaF03/lectures/oohdm.pdf)

68. [Systematic](https://dl.acm.org/doi/pdf/10.1145/234828.234840)

69. [a modeling language for designing Web sites - ScienceDirect.com](https://www.sciencedirect.com/science/article/abs/pii/S1389128600000402) - In this paper we present Web Modeling Language (WebML), a notation for specifying complex Web sites ...

70. [a modeling language for designing Web sites | Semantic Scholar](https://www.semanticscholar.org/paper/Web-Modeling-Language-(WebML):-a-modeling-language-Ceri-Fraternali/efcc1ff0a6f62a1c36f42ec7eb30e0da82dd7484) - The WebML language and its accompanying design method are fully implemented in a pre-competitive Web...

71. [‪Piero Fraternali‬ - ‪Google Académico‬](https://scholar.google.com.py/citations?user=IhFm8bIAAAAJ&hl=es) - Web Modeling Language (WebML): a modeling language for designing Web sites. S Ceri, P Fraternali, A ...

72. [[PDF] Chapter 7 UML-BASED WEB ENGINEERING](https://www.pst.ifi.lmu.de/People/former-members/koch/publications/2008/koch-et-al-uwe-springer-ch7.pdf) - The UWE metamodel is defined as a conservative extension of the UML metamodel (Koch and Kraus, 2003)...

73. [[PDF] Model-Driven Web Engineering: UWE Approach](https://uwe.pst.ifi.lmu.de/publications/MDWE-UWE_URJC_280508.pdf)

74. [UWE.PDF](https://www.pst.ifi.lmu.de/People/former-members/koch/publications/2001/koch-et-al-uwe-casestudy-iwwost01.pdf)

75. [[PDF] A Metamodel for UWE](https://www.pst.ifi.lmu.de/People/former-members/koch/publications/2003/kraus-koch-uwe-metamodel-tr0301.pdf)

76. [Specification Framework for Engineering Adaptive Web Applications](https://personal.eur.nl/frasincar/papers/WWW2002/HTML/www2002.html)

77. [[PDF] Engineering Semantic Web Information Systems in Hera](https://personal.eur.nl/frasincar/papers/WWW2003b/www2003b.pdf)

78. [A Navigation-Oriented](https://dl.acm.org/doi/pdf/10.1145/267437.267449)

79. [A VISUAL FORMALISM FOR COMPLEX-SYSTEMS](https://weizmann.esploro.exlibrisgroup.com/esploro/outputs/journalArticle/STATECHARTS---A-VISUAL-FORMALISM-FOR/993262112803596) - STATECHARTS - A VISUAL FORMALISM FOR COMPLEX-SYSTEMS - The Weizmann Institute of Science - Journal a...

80. [Statecharts: A visual formalism for complex systems](https://www.academia.edu/2838085/Statecharts_A_visual_formalism_for_complex_systems) - Abstract We present a broad extension of the conventional formalism of state machines and state diag...

81. [Statecharts: A visual formalism for complex systems | Science of Computer Programming](https://dl.acm.org/doi/10.1016/0167-6423(87)90035-9)

82. [(a) DOM tree t1 (b) DOM tree t2 (c) DOM tree t3Figure 2.5: DOM tree comparison.content [80]. These approaches ignore the tree structure of DOM trees. To ac-count for the actual structural differences, we adopt the tree edit distance betweentwo ordered labeled trees, which was proposed [168] and implemented [149] asthe minimum cost of a sequence of edit operations that transforms one tree intoanother. The operations include deleting a node and connecting its children to theparent, inserting a node between a node and the children of that node, and rela-belling a node.We define state DOM diversity as the normalized DOM tree edit distance. Let tiand t j be the corresponding DOM trees of two states si and s j. The DOM diversityof si and s j, denoted by DD(si,s j), is defined as:DD(si,s j) =T ED(ti, t j)max(|ti|, |t j|) (2.3)where T ED(ti, t j) is the tree edit distance between ti and t j, and max(|ti|, |t j|) is themaximum number of nodes in ti and t j.Example 3 Figure 2.5 depicts three DOM trees with |t1|=7, |t2|=10, and |t3|=13.t2 can be produced from t1 by (1) relabelling in t1 to , and (2)inserting three nodes under . Thus T ED(t1, t2) = 4 and their DOM di-versity equals 410 =0.4. Similarly T ED(t1, t3) = 7 and thus their DOM diversityequals 713 =0.53. This shows t3 is more DOM diverse than t2 with respect to t1.T ED(t2, t3) = 3 and their DOM diversity equals 313 =0.23 223Overall State Score. The state score is a combination of code coverage impact,path diversity, and DOM diversity. Our state expansion fitness function is a linearcombination of the three metrics as follows:Score(si,s j) = wCI ·CI(si,s j)+wPD ·PD(si,s j)+wDD ·DD(si,s j) (2.4)where, wCI , wPD, and wDD are user-defined weights (between 0 and 1) for codecoverage impact, path diversity, and DOM diversity, respectively.2.3.4 Event Execution StrategyThe goal of our event execution strategy is to reduce the size of events sequences(edges) in the SFG, while preserving the coverage. Reducing the size of events isimportant since it reduces the size of generated test cases, which in turn minimizesthe time overhead of test rerun [94].Intuitively, we try to minimize the execution of events that are not likely toproduce new states. We categorize web application user interface events into fourgroups based on their impact on the application state transitional behaviour: (1)An event that does not change the DOM state is called a self-loop, e.g., eventsthat replace the DOM tree with an exact replica, e.g., refresh with no changes, orclear data in a form; (2) A state-independent event is an event that always causesthe same resulting state, e.g., events that always result in the Index page; (3) Astate-dependent event is an event that after its first execution, always causes thesame state, when triggered from the same state. (4) A Nondeterministic event is anevent that may results in a new state, regardless of where it is triggered from. Suchevents can result in different states when triggered from the same state. In Figure2.1, for instance, e0 is a self-loop event, e5 is a state-independent event, and e4 isa state-dependent event.A crawler that distinguishes between these different events can avoid self-loops, minimize state-independent and nondeterministic event executions, and em-phasize state-dependent events to explore uncovered states. To that end, we defineevent productivity (EP) as follows.Let RSi(e) denote the resulting state of the i-th execution of the event e, andn be the total number of executions of e (including the last execution). The event24productivity ratio of e, denoted by EP(e), is defined as:EP(e) =1 ; if n = 0∑ni=1 MinDD(RSi(e))n ; otherwise(2.5)where MinDD(RSi(e)) = mins∈SFG{DD(RSi(e),s)}, i.e., the minimum diversity ofRSi(e) and all existing states in the SFG. Note that 0 ≤ EP(e) ≤ 1 and its valuecan change after each execution of e, while exploring.The above definition captures three properties. Firstly, it gives the highest ratioto the unexecuted events (in case n = 0) since the resulting state is more likelyto be a new state compared to already executed events. Naturally, this also helpsin covering more of the JavaScript code, since the event-listeners typically triggerthe execution of one or more JavaScript function(s). Secondly, it penalizes eventsthat result in an already discovered state, such as self-loops and state-independentevents, with MinDD(RSi(e))=0. Thirdly, the productivity ratio is proportional tothe structural diversity of the resulting state with respect to previously discoveredstates. This gives a higher productivity ratio to events that have resulted in morediverse structures, guiding the exploration towards more DOM diverse states.Remark 1. We do not consider path-diversity (PD) in the calculation of EP.This is because when the execution of an event results in a new state, the resultingstate shares much of its navigational path with the source state that leads to PDclose to 0, which discourages new state discovery. On the other hand, if the re-sulting state is an already discovered state in the SFG, its shortest ev](https://open.library.ubc.ca/media/download/full-text/24/1.0340953/0.txt)

83. [Navigation Design in Information Architecture](https://informationarchitectureauthority.com/navigation-design) - Navigation design is the structural discipline within information architecture concerned with how us...

84. [SimHash Calculator | MetricGate](https://metricgate.com/docs/simhash/) - Compute SimHash fingerprints for documents and detect near-duplicates by Hamming distance using Char...

85. [SimHash - Wikipedia](https://en.wikipedia.org/wiki/SimHash)

86. [Wrapper induction: Efficiency and expressiveness - ScienceDirect.com](https://www.sciencedirect.com/science/article/pii/S0004370299001009) - In this article, we describe six wrapper classes, and use a combination of empirical and analytical ...

87. [[PDF] Wrapper Induction for Information Extraction - Semantic Scholar](https://www.semanticscholar.org/paper/Wrapper-Induction-for-Information-Extraction-Kushmerick-Weld/f9e7402ad740b73cc0bb64178f86df3478c3aaf5) - Wrapper Induction for Information Extraction · N. Kushmerick, Daniel S. Weld, Robert B. Doorenbos · ...

88. [Wrapper Induction for Information Extraction.](https://dblp.org/rec/conf/ijcai/KushmerickWD97.html) - Bibliographic details on Wrapper Induction for Information Extraction.

89. [IJCAI-97](https://homes.cs.washington.edu/~weld/papers/kushmerick-ijcai97.pdf)

90. [[PDF] Structured Data Extraction from the Web Based on Partial Tree ...](https://www.cs.uic.edu/~liub/WebDataExtraction/IEEE-TKDE-DEPTA-2006.pdf)

91. [WebChallenger: A Reliable and Efficient Generalist Web Agent](https://huggingface.co/papers/2606.10423) - Join the discussion on this paper page

92. [WebChallenger: A Reliable and Efficient Generalist Web Agent](https://arxiv.org/html/2606.10423)

93. [WebChallenger: A Reliable and Efficient Generalist Web Agent | Hugging Face Daily Papers on Prismix](https://prismix.dev/news/9eb7941229a9) - Abstract WebChallenger presents a web agent framework that improves autonomous navigation through st...

