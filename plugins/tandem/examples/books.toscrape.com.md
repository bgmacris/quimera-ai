---
site: books.toscrape.com
created: 2026-06-26
updated: 2026-06-29
auth: { wall: "none", bypassed_by: none }
---
# books.toscrape.com — navigation profile

> **EXAMPLE profile.** Real recon of [books.toscrape.com](https://books.toscrape.com/)
> (public scraping sandbox), included as a sample of what a `tandem:map` profile looks like.
> Real-use profiles do **not** live in the repo: they are stored in `~/.claude/tandem/sites/<host>.md`
> (data dir, outside git) because they may reveal routes/structure of private sites. This one is
> public and contains no sensitive data, so it is versioned as documentation.

## Routes (skeleton)
- /index.html ........................ catalogue, 20 books/page, 50 pages             | verified 2026-06-26
- /catalogue/page-{n}.html ........... catalogue pagination (n=1..50)                 | verified 2026-06-26
- /catalogue/{slug}_{id}/index.html .. book detail (relative href in the pod)         | verified 2026-06-26
- /catalogue/category/books/{cat}/index.html ... category listing (50 cats; total 1000, exact partition) | verified 2026-06-29
- /catalogue/category/books/{cat}/page-{n}.html  pagination for large categories (Fiction: 4 pages)      | verified 2026-06-29

## Locators (multi-anchor; classic HTML site, no ARIA roles → CSS sel)
- item-catalogue:
    sel:       article.product_pod
    title:     article.product_pod h3 a   (text + attr title + href to detail)
    price:     article.product_pod .price_color
    stock:     article.product_pod .instock.availability
    verify:    20 pods per page                                    | verified 2026-06-26
- nav-categories:
    sel:       .side_categories ul li a
    verify:    51 links = 50 children + root "Books" (TRAP → gotcha) | verified 2026-06-29
- pagination-next:
    sel:       .pager .next a
    verify:    .pager .current = "Page X of N" (N=50 catalogue, 4 in Fiction) | verified 2026-06-29
- detail-title:       sel: .product_main h1                        | verified 2026-06-26
- detail-price:       sel: .product_main .price_color              | verified 2026-06-26
- detail-stock:       sel: .product_main .availability  (text "In stock (N available)") | verified 2026-06-26
- detail-table:       sel: table.table-striped  (UPC, prices, tax, nº reviews) | verified 2026-06-26
- detail-description: sel: #product_description ~ p                | verified 2026-06-26

## Recipes
extract-catalogue-page(page-url):
  - navigate: <- {page-url}
  - extract:  item-catalogue

## Gotchas
- [verified 2026-06-26] RATING is not text: it is in the CLASS → `.star-rating Three|Four|...`. Read className, not textContent.
- [verified 2026-06-26] hrefs in the pod are RELATIVE (`catalogue/...`); resolve against the base URL.
- [verified 2026-06-26] Classic HTML site WITH NO ARIA roles → selectors are CSS, not `role=`. (selector.mjs v1 does not apply here.)
- [verified 2026-06-26] 50 pages in the catalogue → iterate with an explicit LIMIT, never blindly.
- [verified 2026-06-29] BY-CATEGORY extraction: `.side_categories` lists 51 links = 50 children + root "Books". The root (`books_1`) and the general catalogue give the SAME 1000 books; the 50 children sum to 1000 (exact partition). Iterate ONLY the 50 children; mixing root or general DUPLICATES.
- [verified 2026-06-29] Large categories PAGINATE like the catalogue (Fiction: 65 results, 4 pages); small ones do not (Travel: 11, no `.pager`). Iterate each category following `pagination-next` with a LIMIT; do not assume 1 page.
- [verified 2026-06-29] FINGERPRINT unreliable on list routes here: `h3` elements are book TITLES (content), not headings → `fingerprint check` gives FALSE drift between pages of the same template (Fiction p1 vs p2: 20 h3 added/removed, 7 stable signals identical). On these routes do NOT rely on the gate; use direct signal (`.pager` / 20 pods). Mechanism limit, not a site issue: see `docs/01` §T015.
