---
name: map
description: Memoria de navegación por sitio para el navegador compartido de tandem. Perfiles que describen el esqueleto de un sitio (rutas), sus locators durables, recetas de navegación y gotchas, para navegar SABIENDO en vez de re-derivar el DOM cada vez. Úsalo al empezar a operar un sitio (mira si ya hay perfil), al terminar un recon que valga la pena guardar, o cuando un locator guardado falle (re-record). Recon ASISTIDO: tú redactas, el humano confirma, se guarda.
---

# tandem:map — memoria de navegación por sitio

Persiste *cómo se navega un sitio concreto* en un perfil por host. Evita re-derivar la
estructura (snapshots enormes, refs efímeros) cada sesión. Complementa la sección
"Navegación real — patrones" del skill `tandem`: aquello es técnica CROSS-site (scroll
infinito, cookie banners…); esto es conocimiento DE-un-sitio (las rutas de ESE sitio).

Diseño completo y por qué: `tandem/docs/01-memoria-de-navegacion.md`.

## Store (motor: `scripts/map.sh`)
Perfiles en `~/.claude/tandem/sites/<host>.md` (FUERA de git; override `TANDEM_DATA_DIR`).
La FUENTE DE VERDAD son los `.md`; el índice se DERIVA de su frontmatter, no se mantiene aparte.

- `map.sh list` ............ tabla de perfiles (host · actualizado · fichero)
- `map.sh show <host>` ..... vuelca el perfil (acepta URL entera: normaliza a host)
- `map.sh path <host>` ..... ruta del fichero (exista o no) — para leer/escribir
- `map.sh index` ........... índice JSON derivado (a stdout + cachea `sites/index.json`)

Invócalo por su ruta dentro del plugin (`scripts/map.sh`); no hay bin en PATH para map.

## Cuándo actuar (reflejos)

1. **Al empezar a operar un sitio**: si ya hay perfil, suele llegarte SOLO — un hook
   `PostToolUse` sobre `browser_navigate` inyecta el perfil del host la primera vez que
   navegas a él en la sesión (`scripts/hook-inject-profile.mjs`). Si no llegó (o quieres
   releerlo): `map.sh show <host>`. Si no hay perfil y el trabajo no es trivial → ofrece al
   humano hacer recon y guardarlo.
2. **Antes de fiarte de los locators de una ruta** (re-check barato): valida con
   `fingerprint.mjs check <host> <ruta>` (señal estructural, JSON pequeño), NO con un
   `browser_snapshot` dirigido (pesa ~18× el perfil entero). `match` → fíate de los `sel:` de esa
   ruta SIN snapshot (ver "Flujo frugal"). `drift` → punto 4. Sin fingerprint aún → un snapshot
   dirigido puntual, y captura el fingerprint para la próxima.
3. **Tras un recon que valga la pena**: redacta el borrador del perfil, enséñaselo al humano,
   y solo con su OK escríbelo.
4. **Si un locator falla** (drift): NO intentes repararlo. Re-deriva en vivo, actualiza la
   línea del perfil con el ancla nueva y la fecha de hoy, y avisa al humano del cambio.
   Regla: *un click cacheado equivocado es peor que un click lento*.

## Cómo se hace recon (ASISTIDO — nunca auto-guardar)

1. Explora con las tools `browser_*` (snapshot dirigido, `browser_evaluate` para datos,
   navegar rutas). No vuelques DOM crudo al perfil: abstrae.
2. Redacta el borrador con la estructura de abajo. Marca cada línea:
   `[verificado AAAA-MM-DD]` (lo viviste ahora) o `[hipótesis]` (inferido, sin probar).
3. **Enséñaselo al humano. Él confirma/corrige.** Hasta entonces no se guarda.
4. Escribe en `$(map.sh path <host>)`. Pon `created`/`updated` en el frontmatter.

## Disciplina de los locators (lo que hace que esto no mienta)

- **Multi-ancla, propiedades estables.** Prefiere un `id` estable si existe; si no, rol+nombre
  del árbol de accesibilidad. **Nunca** posición/índice ni refs `eNN` (son efímeros).
- Guarda el **primario + 1-2 corroborantes** (texto vecino, atajo, contenedor). En el re-check,
  acepta el elemento si el conjunto casa, no solo el primario. (Idea robada de Similo:
  varias señales débiles ponderadas baten a un solo ancla fuerte.)
- **Magro y abstracto.** Esqueleto + locators + recetas. Si una página es enorme, el perfil
  guarda CÓMO llegar y QUÉ buscar, no el volcado.
- **`sel:` ejecutable (opt-in).** Además del primario legible, un locator puede llevar un `sel:`
  = selector Playwright que el agente pasa como `target` para accionar SIN snapshot. Genera la
  sintaxis con `scripts/selector.mjs` (NO a mano — el escape de comillas/regex se teclea mal):
  `selector.mjs <rol> <nombre> [--regex] [--anchor]`. Dos clases:
  - **instancia** (un elemento): `sel:` directo, p.ej. `role=button[name="Nuevo ticket"]`.
    Para nombres largos/frágiles usa `--regex` (substring) en vez del literal exacto.
  - **plantilla** (varios: filas, items de lista): `sel:` con un hueco que la receta rellena en
    uso, p.ej. `role=row[name=/^{id}/]`. Un prefijo común (`^TCK-`) casa N filas → la acción
    es estricta y lanza; por eso va parametrizado al id concreto.
  - Si un elemento no tiene rol/nombre único, NO le pongas `sel:` (forzar CSS posicional miente).
  - El `sel:` es SOLO el selector, sin comentarios inline (`recipe.mjs`/`selector.mjs` los
    incluirían en el valor). Las notas van en `primario:`/`corrobora:`.
  - **No todas las "tablas" exponen ARIA.** Muchas SPA renderizan `<table>` que el árbol aplana a
    `generic` (sin `role=row`/`cell`) y duplican la lista por responsive. Verifica EN VIVO antes de
    anclar por `role=row`; si no hay, ancla por clase estable + `text=` + `>> visible=true`. El
    helper `selector.mjs` (v1) solo cubre `role=…[name]` — estos casos se escriben a mano por ahora.

## Drift por señal (fingerprint, T015) — staleness por evidencia, no por fecha

En vez de fiarte de cuán viejo es el tag `[verificado]`, compara el ESQUELETO estructural
de la página contra el que guardaste. Si cambió → los locators de esa ruta son sospechosos,
toca re-check/re-record (la fecha no te dice eso: una página intacta hace 6 meses sigue válida;
una que cambió ayer está stale aunque el tag sea de ayer).

Motor: `scripts/fingerprint.mjs {capture|check} <host> <route-key>` (señales JSON por stdin).
Sidecar `sites/<host>.fingerprints.json` (máquina, separado del perfil legible). `check`
devuelve `{status: new|match|drift, added[], removed[]}` y rc 1 si hay drift; el diff te dice
EXACTAMENTE qué locator cambió.

**Evaluate canónico** — captura solo ESTRUCTURA (roles, landmarks, botones, inputs, headings,
nav-links), no datos de tabla, y normaliza dígitos a `#` para que counts/fechas/ids no cuenten
como drift. NO lo teclees a mano: la FUENTE ÚNICA es `scripts/page-signals.mjs` (versionada y
con tests). Obtén el JS exacto y pásalo a `browser_evaluate` literalmente:

```
node scripts/page-signals.mjs print     # emite el blob () => [...] auto-contenido
```

> Por qué un archivo y no el snippet aquí: cambiar la extracción invalida TODOS los fingerprints
> guardados (falso drift en todo). Con la fuente única, el algoritmo no puede derivar sin que sus
> tests lo cacen (`tests/page-signals.test.mjs`); el blob se serializa de esas mismas funciones.

Flujo: `browser_evaluate` con la salida de `page-signals.mjs print` → pipea el array a
`fingerprint.mjs capture|check <host> <route>`.
- **capture**: tras verificar los locators de una ruta en recon, guarda su fingerprint.
- **check**: al revisitar, compara. `drift` → re-record-on-drift (re-deriva, actualiza perfil) y
  recaptura el fingerprint. `match` → fíate del perfil. `new` → aún sin capturar.

**Gotcha [verificado 2026-06-22]**: ANTES de capture/check confirma que `location.pathname` es la
ruta esperada. Si la sesión caducó y rebotaste a `/login` (u otro muro), NO captures — guardarías
el esqueleto del login bajo la route-key equivocada. Es muro de auth → lo pasa el humano, luego repites.

## Flujo frugal (accionar por `sel:` sin re-snapshotear)

Con perfil cargado, NO snapshotees por defecto para actuar: el snapshot del árbol pesa ~18× el
perfil entero (medido: 105 KB vs 5,6 KB). El snapshot pasa de modo-por-defecto a FALLBACK honesto.

1. **Gate por fingerprint, no por fe.** Antes de fiarte de los `sel:` de una ruta,
   `fingerprint.mjs check <host> <ruta>`. `match` → los `sel:` valen, actúa por ellos. `drift`/`new`
   → re-deriva con un snapshot dirigido (y captura/recaptura el fingerprint).
2. **Acciona por `sel:`.** `browser_click`/`type`/`evaluate` con `target=<sel>`. Cero snapshot.
3. **SPA: espera antes de accionar.** En rutas de render diferido (visto en una SPA real: "primer
   snapshot vacío" antes de hidratar), `browser_wait_for` sobre el `sel` antes del click; si no, el elemento
   puede no existir aún y el ahorro se va en reintentos.
4. **Si el `sel:` falla** (no resuelve, o lanza por ambigüedad) → trátalo como drift: snapshot
   dirigido, re-deriva, actualiza el `sel:` (re-record asistido, reflejo 4), recaptura el
   fingerprint. Un `sel:` cacheado equivocado es peor que un snapshot lento.

Fallback a snapshot = sin perfil, drift, o leer datos nuevos no mapeados.

## Recetas ejecutables (procedural memory)

Una receta es una secuencia NOMBRADA y PARAMETRIZADA de pasos sobre los `sel:` del perfil. Formato
YAML-plano en `## Recetas`, compilado por `scripts/recipe.mjs`:
```
abrir-ticket-por-id(id):
  - type:     busqueda-tickets  <- {id}
  - click:    fila-de-ticket    <- {id}
  - wait-url: /tickets/
  - return:   url
```
- Cabecera `nombre(params):`. Cada paso = `accion: locator [<- {param}|"literal"]`. El `{param}`
  rellena la PLANTILLA del `sel:` (el hueco debe llamarse igual que el param). Acciones v1:
  `navigate`, `type`, `click`, `wait-url`, `return`/`extract`. NO teclees la sintaxis Playwright a
  mano: la compila `recipe.mjs`. Al guardar una receta en recon: `recipe.mjs validate <host>`.

### Ejecutarla — dos modos (`recipe.mjs` COMPILA, el agente EJECUTA):
- **`--step` (default, observable):** `recipe.mjs compile <host> <receta> <args> --step` → pasos
  `{action,target,value}` → ejecútalos con `browser_type`/`click`/`wait_for`. El humano ve cada paso.
  Precédelo con el gate `fingerprint check` (igual que para un `sel:` suelto).
- **`--fast` (frugal, 1 call):** `recipe.mjs compile … --fast` → una función Playwright. **Dry-run
  OBLIGATORIO:** enséñale el código al humano; con su OK, ejecútalo con `browser_run_code_unsafe`. Esa
  tool es RCE-equivalent → solo recetas del store co-curado, nunca texto del modelo o de la página.
- **PII:** una receta que `extract` un dato sensible (IBAN/NIF) → ese dato va a una ACCIÓN, no al
  contexto/log. El dry-run lo hace visible antes de correr.

## Estructura del perfil (`<host>.md`)
```
---
site: <host>
created: AAAA-MM-DD
updated: AAAA-MM-DD
auth: { muro: "<qué muro>", lo_pasa: humano|claude|ninguno }
---
# <host> — perfil de navegación

## Rutas (esqueleto)        — patrón de URL → para qué es
## Locators (multi-ancla)   — nombre: sel (opcional, ejecutable) + primario + corrobora + | verificado FECHA
## Recetas                  — ejecutables (YAML-plano): nombre(params) + pasos `accion: locator <- {param}`
## Gotchas                  — reglas inducidas, cada una [verificado FECHA] o [hipótesis]
```
Ejemplo de formato: ver `docs/01-memoria-de-navegacion.md`.

## No-goals (v1)
- Sin acción automática: el hook inyecta el perfil al CONTEXTO, pero navegar/accionar siempre lo
  decides tú (nunca auto-pilota por el perfil). La AUTORÍA (recon/escritura) también es asistida.
- Sin self-healing que reescriba el perfil solo: re-record + re-confirmación humana.
- Sin esquema rígido/rico: magro gana, escala por adición.
