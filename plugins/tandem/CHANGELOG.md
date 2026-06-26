# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/); versionado semántico.

## [Unreleased] — 2026-06-26

### Added
- `scripts/cdp-cookies.mjs` + `bin/tandem-cookies` + `commands/cookies.md`: exporta todas las
  cookies del Chrome de tandem via CDP directo (`Network.getAllCookies`), incluyendo HttpOnly y
  Secure (inaccesibles desde JS de página). Formatos: `list` (tabla), `json`, `curl`, `headers`,
  `netscape`. Filtro por `--domain`. Sin dependencias externas (WebSocket + fetch nativos Node 22+).
- `scripts/cdp-intercept.mjs` + `bin/tandem-intercept` + `commands/intercept.md`: sniffer HTTP
  que captura request+response bodies del tab activo via CDP (`Network.enable` + `getResponseBody`
  + `getRequestPostData`). Subcomandos `start/show/clear/count`. Filtros por URL, método, status,
  mime. Cap de 32KB por body. Persistencia NDJSON en `~/.claude/tandem/intercept.ndjson`.
- `scripts/cdp-pdf.mjs` + `bin/tandem-pdf` + `commands/pdf.md`: captura la página actual como
  PDF (`Page.printToPDF`, requiere `--headless`) con fallback automático a screenshot PNG full-page
  via `Page.captureScreenshot` + `Page.getLayoutMetrics` + `Emulation.setDeviceMetricsOverride`
  (funciona siempre en modo headful de tandem). Output prefijado `pdf:` o `png:` para que el
  agente sepa el formato generado.

### Security
- `norm()` en `page-signals.mjs`: añadido filtro ASCII imprimible (`\x20-\x7E`) y cap de 120
  caracteres por señal. Cierra el vector de stored prompt injection via DOM → perfil → contexto.
- `hook-inject-profile.mjs`: sanitiza `session_id` del JSON de entrada antes de usarlo como
  componente de path (`rmSync`). Cierra path traversal via `session_id` con `..`.
- `fingerprint.mjs`: atomic write (`writeFileSync` a `.tmp` + `renameSync`) para evitar pérdida
  silenciosa de fingerprints por write interrumpido.

## [0.5.0] — 2026-06-22

Recetas ejecutables: *procedural memory* sobre los `sel:`.

### Added
- Recetas del perfil PARAMETRIZADAS y ejecutables (formato YAML-plano en `## Recetas`), sustituyen
  la prosa numerada. `scripts/recipe.mjs` (+ `tests/recipe.test.mjs`) las parsea, valida y compila.
- Dos modos de ejecución (híbrido): `--step` (pasos que el agente ejecuta con las tools, observable,
  default seguro) y `--fast` (función Playwright en 1 tool call vía `browser_run_code_unsafe`).
  `recipe.mjs` compila; el agente ejecuta. Enganchado a `smoke.sh` §8 → 49 asserts.
- Acciones v1: `navigate`, `type`, `click`, `wait-url`, `return`/`extract`.

### Security
- `browser_run_code_unsafe` es RCE-equivalent. Defensa en capas: solo recetas del store co-curado;
  los datos (args) entran por `JSON.stringify` (inertes); el `sel:` plantilla se escapa por-engine
  (reusa `selector.mjs`); `assertCompiledSafe` valida el esqueleto contra una allowlist; dry-run
  obligatorio antes de `--fast`. Test de inyección verifica que un payload hostil queda inerte.

## [0.4.0] — 2026-06-22

Navegación token-frugal: el perfil hace los locators **ejecutables**.

### Added
- Campo `sel:` (opcional) por locator en `sites/<host>.md`: selector Playwright que el agente pasa
  como `target` para accionar **sin `browser_snapshot`**. Instancia (directo) vs plantilla (hueco
  que la receta rellena, para locators de clase como filas).
- `scripts/selector.mjs` + `tests/selector.test.mjs`: genera el `sel:` con los escapes correctos
  (comillas, metacaracteres regex, `/` delimitador) para que la sintaxis no se teclee a mano.
  Enganchado a `smoke.sh` §7 → 47 asserts.
- Flujo frugal en `skills/map` y `skills/tandem`, **atado a `fingerprint.mjs check`** como gate
  (saltarse el snapshot solo si la ruta da `match`; `wait_for` en SPAs de render diferido).

### Changed
- `skills/map`: el reflejo de re-check ya no dice "confirma con `browser_snapshot` dirigido" sino
  "valida con `fingerprint check`" — más barato y dice qué locator cambió. Reconcilia la
  contradicción con el flujo frugal.

### Medición (verificada, método reproducible)
- Un `browser_snapshot` del árbol pesa **~18×** el perfil entero: `wc -c` → snapshot Wikipedia
  105.571 B (~26k tok, ÷4) vs un perfil de sitio real 5.581 B (~1,4k tok). El perfil se inyecta 1×/sesión;
  el snapshot se repetía por acción. Medición tarea-equivalente (necesita login) queda para v2.

## [0.3.0] — 2026-06-22

Hardening pre-release: auditoría de código + cierre de hallazgos + tests.

### Changed
- `mcp-launch.sh`: la versión del Playwright MCP pasa a estar **pineada** (`@playwright/mcp@0.0.76`)
  en vez de `@latest`, que dejaba cada arranque a merced de una versión distinta (rotura
  silenciosa + superficie supply-chain). Override con `TANDEM_MCP_VERSION`.
- `map.sh index`: el JSON se serializa con node en vez de concatenar strings, así un frontmatter
  con comillas o backslash ya no rompe `index.json`.

### Added
- `scripts/page-signals.mjs`: **fuente única** del fingerprint de página (antes el evaluate
  canónico vivía como snippet en la skill). `norm` + `collectSignals` definidos una sola vez;
  `page-signals.mjs print` emite el blob auto-contenido para `browser_evaluate`, serializado de
  esas mismas funciones (no puede divergir del código testeado).
- `tests/smoke.sh`: prueba de humo del motor de `tandem:map` sin arrancar Chrome (parseo, bit
  `+x`, `map.sh`, `fingerprint` con drift E2E, hook de inyección) — 45 asserts.
- `tests/page-signals.test.mjs`: 19 asserts sobre `norm`/`collectSignals` con DOM mock dirigido,
  dedup y consistencia blob↔función.

### Fixed
- `fingerprint.mjs`: el host de `argv` entraba crudo en la ruta del store → **path traversal** al
  capturar/leer. Ahora normaliza igual que `map.sh` y exige un hostname plausible.
- `fingerprint.mjs`: faltaba el bit ejecutable (`+x`); la skill lo invoca por ruta directa, así
  que en producción fallaba con `rc=126`. Lo cazó el smoke test.
- `lib.sh`: contador de reintentos sin usar (`i`→`_`).

### Tooling
- `shellcheck -x -S style` limpio en todo el shell. README §Desarrollo documenta cómo correr
  los checks (ninguno arranca Chrome; el ciclo real de Chrome se prueba a mano).

## [0.2.0] — 2026-06-22

- Preparación para publicación y **soporte Linux** (autodetección de Chromium vía PATH; estado
  del puerto con `lsof` o, en su defecto, `ss`). macOS soportado y probado; Linux sin CI aún.
