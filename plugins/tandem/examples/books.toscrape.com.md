---
site: books.toscrape.com
created: 2026-06-26
updated: 2026-06-29
auth: { muro: "ninguno", lo_pasa: ninguno }
---
# books.toscrape.com — perfil de navegación

> **Perfil de EJEMPLO.** Recon real de [books.toscrape.com](https://books.toscrape.com/)
> (sandbox público de scraping), incluido como muestra de cómo se ve un perfil `tandem:map`.
> Los perfiles de uso real **no** viven en el repo: se guardan en `~/.claude/tandem/sites/<host>.md`
> (data dir, fuera de git) porque pueden revelar rutas/estructura de sitios privados. Este es
> público y sin datos sensibles, por eso se versiona como documentación.

## Rutas (esqueleto)
- /index.html ........................ catálogo, 20 libros/página, 50 páginas        | verificado 2026-06-26
- /catalogue/page-{n}.html ........... paginación del catálogo (n=1..50)             | verificado 2026-06-26
- /catalogue/{slug}_{id}/index.html .. detalle de un libro (href relativo en el pod) | verificado 2026-06-26
- /catalogue/category/books/{cat}/index.html ... listado por categoría (50 cats; suman 1000, partición exacta) | verificado 2026-06-29
- /catalogue/category/books/{cat}/page-{n}.html  paginación interna de categoría grande (Fiction: 4 págs)      | verificado 2026-06-29

## Locators (multi-ancla; sitio HTML clásico, sin ARIA roles → sel CSS)
- item-catalogo:
    sel:       article.product_pod
    titulo:    article.product_pod h3 a   (texto + attr title + href al detalle)
    precio:    article.product_pod .price_color
    stock:     article.product_pod .instock.availability
    corrobora: 20 pods por página                                  | verificado 2026-06-26
- nav-categorias:
    sel:       .side_categories ul li a
    corrobora: 51 enlaces = 50 hijas + raíz "Books" (TRAMPA → gotcha) | verificado 2026-06-29
- paginacion-siguiente:
    sel:       .pager .next a
    corrobora: .pager .current = "Page X of N" (N=50 catálogo, 4 en Fiction) | verificado 2026-06-29
- detalle-titulo:      sel: .product_main h1                       | verificado 2026-06-26
- detalle-precio:      sel: .product_main .price_color             | verificado 2026-06-26
- detalle-stock:       sel: .product_main .availability  (texto "In stock (N available)") | verificado 2026-06-26
- detalle-tabla:       sel: table.table-striped  (UPC, precios, tax, nº reviews) | verificado 2026-06-26
- detalle-descripcion: sel: #product_description ~ p              | verificado 2026-06-26

## Recetas
extraer-pagina-catalogo(url-pagina):
  - navigate: <- {url-pagina}
  - extract:  item-catalogo

## Gotchas
- [verificado 2026-06-26] El RATING no es texto: va en la CLASE -> `.star-rating Three|Four|...`. Leer className, no textContent.
- [verificado 2026-06-26] Los href del pod son RELATIVOS (`catalogue/...`); resolver contra la URL base.
- [verificado 2026-06-26] Sitio HTML clásico SIN roles ARIA -> los sel son CSS, no `role=`. (selector.mjs v1 no aplica aquí.)
- [verificado 2026-06-26] 50 páginas en el catálogo -> recorrer con TOPE explícito, nunca a ciegas.
- [verificado 2026-06-29] Extracción POR CATEGORÍAS: `.side_categories` lista 51 enlaces = 50 hijas + raíz "Books". El raíz (`books_1`) y el catálogo general dan los MISMOS 1000 libros; las 50 hijas suman 1000 (partición exacta). Recorrer SOLO las 50 hijas; mezclar el raíz o el general DUPLICA.
- [verificado 2026-06-29] Las categorías grandes PAGINAN como el catálogo (Fiction: 65 results, 4 págs); las pequeñas no (Travel: 11, sin `.pager`). Recorrer cada categoría siguiendo `paginacion-siguiente` con TOPE; no asumir 1 página.
- [verificado 2026-06-29] FINGERPRINT no fiable en rutas-lista aquí: los `h3` son TÍTULOS de libro (contenido), no cabeceras → `fingerprint check` da FALSO drift entre páginas de la misma plantilla (Fiction p1 vs p2: 20 h3 added/removed, 7 señales estables iguales). En estas rutas NO te fíes del gate; usa señal directa (`.pager` / 20 pods). Límite del mecanismo, no del sitio: ver `docs/01` §T015.
