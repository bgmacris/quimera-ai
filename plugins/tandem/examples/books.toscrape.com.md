---
site: books.toscrape.com
created: 2026-06-26
updated: 2026-06-26
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
- /catalogue/category/books/{cat}/ ... listado por categoría (50 categorías)         | hipótesis

## Locators (multi-ancla; sitio HTML clásico, sin ARIA roles → sel CSS)
- item-catalogo:
    sel:       article.product_pod
    titulo:    article.product_pod h3 a   (texto + attr title + href al detalle)
    precio:    article.product_pod .price_color
    stock:     article.product_pod .instock.availability
    corrobora: 20 pods por página                                  | verificado 2026-06-26
- paginacion-siguiente:
    sel:       .pager .next a
    corrobora: .pager .current = "Page X of 50"                    | verificado 2026-06-26
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
