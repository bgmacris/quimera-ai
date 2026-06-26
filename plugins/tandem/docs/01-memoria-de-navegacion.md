# Estudio 01 — Memoria de navegación / recon por sitio (`tandem:map`)

**Proyecto:** tandem
**Fecha:** 2026-06-22
**Estado:** v1 + v2 (T015, T016) implementados y verificados.
**Depende de:** SKILL.md de tandem (sección "Navegación real — patrones, LISTA VIVA").
**Investigación base:** deep-research 2026-06-22 (26 fuentes, 122 claims → 21 confirmados
con verificación adversarial 3-votos). Las citas `[verificado]` de abajo salen de ahí;
lo no cerrado está marcado `[abierto]`.

> Nota: los ejemplos usan un sitio ficticio (`app.example.com`, una app de tickets) solo
> para ilustrar el formato. Los perfiles reales viven fuera del repo (ver "Decisión: store LOCAL").

---

## Problema

Para operar un sitio conocido se re-deriva su estructura cada vez: un `browser_snapshot`
completo del árbol de accesibilidad. Eso (a) quema contexto —snapshots de cientos de KB— y
(b) usa refs **efímeros** (`e72`, `e108`) que cambian entre snapshots y entre páginas. No hay
memoria persistente de "cómo se navega ESTE sitio".

`tandem:map` añade esa memoria: un **perfil por sitio** que describe su esqueleto, sus
locators durables, recetas de navegación y gotchas — para navegar *sabiendo*, no
re-derivando. Menos tokens y más fiable.

## Qué NO es (capas, no duplicar)

- La sección "Navegación real — patrones" del SKILL.md es conocimiento **CROSS-site**
  (cómo manejar scroll infinito, cookie banners en iframe, etc., en general). **Se queda.**
- `tandem:map` es conocimiento **DE-un-sitio** (sus rutas, su buscador). Capa distinta.
  La técnica genérica vive en el skill; lo específico del host vive en su perfil.

---

## Decisión: store LOCAL

Los perfiles viven **fuera de git**, en el data dir fijo de tandem
(`~/.claude/tandem/`, override `TANDEM_DATA_DIR`), junto al `chrome-profile/`. Razones:

- Coherencia con la arquitectura ya existente (lib.sh usa ruta fija a propósito: la var
  `${CLAUDE_PLUGIN_DATA}` no está disponible en la inyección bash de los slash commands).
- Un perfil de un sitio autenticado (rutas internas, estructura) es información sensible
  de bajo grado: fuera de git y backups por defecto, igual que el perfil de Chrome.

```
~/.claude/tandem/
├── chrome-profile/         (perfil dedicado de Chrome)
├── cdp-port, logs/ …
└── sites/                  (perfiles de navegación)
    ├── index.json          caché DERIVADA (regenerable con `map.sh index`), no fuente de verdad
    └── app.example.com.md  perfil legible por humano (FUENTE DE VERDAD)
```

---

## El artefacto: `sites/<host>.md`

Markdown legible y editable. Frontmatter YAML para lo estructurado; cuerpo para recetas y
gotchas. Magro y abstracto **a propósito** — nunca volcados de DOM/HTML (ver Pitfall #2).
Ejemplo ilustrativo (ficticio):

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

## Disciplina (donde esto vive o muere) — derivada de la investigación

1. **Locators = propiedades estables, multi-ancla.** Anclar en `id` estable si existe; si
   no, rol+nombre del árbol de accesibilidad; **nunca** posición/índice. Guardar el
   primario **+ 1-2 señales corroborantes** (texto vecino, id) y, en el re-check, aceptar
   el elemento si un match ponderado supera umbral — no apostar a un solo ancla.
   - `[verificado]` orden de fragilidad: ID > rol/nombre estable > CSS/XPath > posición
     (Leotta 2014: XPath absoluto 67% roto; ID <1%). El *orden* es robusto; los % son
     específicos del dataset.
   - `[verificado]` multi-ancla pondera: Similo/HybridSimilo relocaliza 98.8% de locators
     rotos puntuando varias propiedades (estables peso 1.5, inestables 0.5).
     Fuente: Kluge & Stocco 2025, arxiv 2505.16424.

2. **Re-record-on-drift, NO reparar.** Si un locator falla, no intento arreglarlo: lo
   trato como fallo, re-derivo en vivo, reescribo la entrada y marco fresca. Regla robada
   de Stagehand: *"un click cacheado equivocado es peor que un click lento"*.
   Fuente: browserbase.com/blog/stagehand-caching `[verificado]`.

3. **Fecha + tag por línea.** `[verificado AAAA-MM-DD]` = lo viví; `[hipótesis]` = inferido
   sin probar. Es el equivalente humano-curado del "snapshot fingerprint gate" de Stagehand.

4. **Re-check barato antes de fiarme.** Al retomar un sitio: leo el perfil pero confirmo
   1-2 locators clave con un snapshot dirigido. Fallan → caigo a snapshot fresco **y**
   marco el perfil stale.

5. **Magro y abstracto.** Esqueleto + locators + recetas. Nunca DOM crudo.
   Fuente: Synapse, ICLR 2024 (*"una sola página puede comerse todo el contexto"*) `[verificado]`.

6. **Recon ASISTIDO.** Explorar → redactar borrador → el humano confirma/corrige → se guarda.
   Nada de auto-guardar mapas inferidos (memoria curada, no volcado).

---

## Piezas (v1)

1. **Skill `tandem:map`** (`skills/map/SKILL.md`) — el cerebro: leer / crear (recon
   asistido) / actualizar perfiles, con la disciplina de arriba. Superficie delgada.
2. **Store**: markdown plano en `~/.claude/tandem/sites/<host>.md`.
3. **Índice DERIVADO**: `map.sh index` computa el índice del frontmatter de los `.md` y lo
   cachea en `sites/index.json` (regenerable, no fuente de verdad). Desviación consciente
   de la idea de workflow-use (`metadata.json` mantenido aparte): un índice mantenido a mano
   se desincroniza de los ficheros — otro mapa que puede mentir. Derivarlo elimina ese bug a
   cambio de re-escanear, barato con pocos sitios.
4. **Helper `scripts/map.sh {list|show <host>|path <host>|index}`**.
5. **Wiring en SKILL.md**: reflejo "al empezar con un sitio, mira `sites/<host>.md`; si no
   existe y el trabajo no es trivial, ofrece recon" + el reparto de capas (cross-site vs de-sitio).

---

## v2 — auto-inyección por hook (T016, HECHO 2026-06-22)

Al navegar a un host con perfil, el hook lo inyecta en el contexto del modelo. Implementado:
`scripts/hook-inject-profile.mjs` + entrada `PostToolUse` en `hooks/hooks.json`.

- **Evento: `PostToolUse`, NO `PreToolUse`.** `[ruta cerrada]` `PreToolUse` puede leer la
  url pero **NO puede inyectar contexto que el modelo lea** — no soporta
  `hookSpecificOutput.additionalContext` (solo `permissionDecision`/`updatedInput`).
  Verificado contra la Hooks Reference oficial 2026-06-22 (issue anthropics/claude-code#15664).
  `PostToolUse` SÍ soporta `additionalContext`; además es el momento correcto (cargar el
  perfil *tras* navegar, no antes).
- Solo inyecta si EXISTE perfil para el host; si no, silencio (cero ruido).
- UNA VEZ por (sesión, host): marca en `.hook-state/<session_id>/<host>` para no re-inyectar
  en cada click dentro del sitio (pitfall de context bloat). Cleanup en `SessionEnd`.
- En node (ya es dependencia del plugin) para parsear/emitir JSON sin añadir `jq`.

## v2 — drift por señal (T015, HECHO 2026-06-22)

Staleness por EVIDENCIA, no por fecha: compara el esqueleto estructural de una ruta contra el
guardado. Implementado: `scripts/fingerprint.mjs` + evaluate canónico (en `skills/map/SKILL.md`)
+ sidecar `sites/<host>.fingerprints.json`.

- **Fingerprint del ESQUELETO, no de la página**: roles/landmarks + controles (botón/textbox/
  heading/nav-link), NO filas de datos. Por qué importa **normalizar dígitos a `#`**: un badge
  de conteo "Inbox 112" puede pasar a "115" entre visitas; sin normalizar, eso sería falso drift.
  Counts/fechas/ids → `#`.
- **Por-ruta** (route-key que pasa el agente, alineada con los nombres de ruta del perfil), no
  por-perfil.
- **Set de señales, no hash**: `check` devuelve `added[]`/`removed[]` → diff accionable (qué
  locator cambió), no un binario. rc 1 si drift.
- **Agent-driven**: el fingerprint se calcula con un `browser_evaluate` (el hook no tiene navegador).
- `[verificado]` Gotcha: antes de capture/check confirmar `location.pathname` == ruta esperada; si
  la sesión caducó y rebota a un muro de login, NO capturar (guardarías el login bajo route-key ajena).
- Verificado end-to-end 2026-06-22: mecánica del helper (capture/match/drift/new) en sandbox +
  captura real autenticada de dos rutas distintas, ambas capture→match. Sidecar limpio de datos
  (la normalización a `#` y el filtro de filas lo garantizan).

## v2 — navegación frugal por `sel:` (HECHO 2026-06-22)

El perfil deja de solo DESCRIBIR locators y pasa a hacerlos EJECUTABLES: cada locator puede llevar
un `sel:` = selector Playwright que el agente pasa como `target` para accionar SIN `browser_snapshot`.

- **Por qué importa (medido, no estimado):** el `target` de `browser_click`/`type`/`evaluate`
  acepta "ref O selector único" → `page.locator()` (CSS y engines Playwright: `role=`, `text=`,
  regex en `name=`). `[verificado en vivo 2026-06-22]` resuelven sin snapshot previo: `h1`,
  `role=heading[name="Web scraping"]`, `role=link[name="Web crawler"]`. El árbol de un snapshot
  pesa **~18×** el perfil entero: `wc -c` → snapshot Wikipedia 105.571 B (~26k tok, ÷4) vs un perfil
  de sitio real 5.581 B (~1.4k tok). El perfil se inyecta 1×/sesión; el snapshot se repetía por acción.
  Método reproducible: `wc -c` del `.md` vs del archivo que guarda `browser_snapshot(filename:)`.
- **Gate por fingerprint, no por fe:** saltarse el snapshot solo es honesto si `fingerprint.mjs
  check <host> <ruta>` da `match`. `drift`/fallo del `sel:` → snapshot dirigido + re-record. Esto
  reconcilia el reflejo de re-check (antes: "confirma con snapshot"): el fingerprint lo sustituye,
  más barato y dice QUÉ cambió.
- **Instancia vs plantilla:** los locators de instancia (un textbox, un botón) llevan `sel:`
  directo; los de clase (filas, items) van como PLANTILLA con hueco (`role=row[name=/^{id}/]`)
  porque un prefijo común casa N elementos y `locator()` es estricto (lanza con >1). La receta
  rellena el id concreto.
- **Sintaxis como código, no a mano:** `scripts/selector.mjs` (+ `tests/selector.test.mjs`) genera
  el `sel:` con los escapes correctos (comillas, metacaracteres regex, el `/` delimitador). Misma
  lección que `page-signals.mjs`: la sintaxis crítica vive en código testeado, no en prosa. Es
  helper de AUTORÍA (recon); en runtime el MCP recibe el `sel:` ya escrito.
- **No-goal mantenido:** el `sel:` NO se auto-reescribe (sigue siendo re-record asistido). Sin CSS
  posicional/XPath de fallback: si no hay rol+nombre único, no hay `sel:`.
- `[verificado 2026-06-22, dogfooding en un sitio real]` Medición TAREA-equivalente: leer el detalle de un
  registro = snapshot 22.418 B (~5,6k tok) vs extracción dirigida ~0,2 KB ≈ **110×**; la lista 13.943 B
  vs evaluate de ids. La tarea (abrir registro + leer) se hizo SIN volcar snapshot al contexto. El
  18× perfil↔snapshot es el piso; en el paso caro (detalle GRANDE) el ahorro es mayor.
- `[abierto]` **v2 de `selector.mjs`**: el dogfooding mostró que el helper v1 solo cubre
  `role=…[name]`. Fuera de ese molde: una "tabla" SIN roles ARIA (árbol todo `generic`) con
  elementos DUPLICADOS por responsive → el `sel:` real fue `span.ticket-number >> text="{id}" >>
  visible=true` (CSS + engine `text=` + filtro `visible=`), que el helper NO genera. v2: soportar
  engines `css`/`text=` y el filtro `visible=`. Recon: verifica EN VIVO que una tabla expone
  `role=row`/`cell` antes de anclar ahí — muchas SPA no lo hacen.

## v3 — recetas ejecutables / procedural memory (HECHO 2026-06-22)

Las "recetas" del perfil pasan de PROSA (pasos numerados en lenguaje natural) a EJECUTABLES y
parametrizadas. Compilador `scripts/recipe.mjs` (+ `tests/recipe.test.mjs`). El research de
agent-memory 2026 lo respalda (procedural memory + reflexión, +10,6% sin fine-tuning).

- **Híbrido, dos modos.** `--step`: pasos `{action,target,value}` que el AGENTE ejecuta con las
  tools (observable, default seguro). `--fast`: una función Playwright `async (page)=>{}` que corre
  en UN tool call vía `browser_run_code_unsafe` (ultra-frugal, cero snapshots). `recipe.mjs` COMPILA;
  el agente EJECUTA (las tools `browser_*` son del modelo, no de un script — por eso NO hay slash
  command `/tandem:run`: un command Bash no puede invocarlas).
- **Formato YAML-plano, fuente única.** Parseado a mano (~el plugin no tiene deps; como el
  frontmatter de `map.sh`). Es "YAML-mirando", no YAML (un `:` anidado o un ancla lo romperían, a
  propósito). NO duplicamos prosa+ejecutable: eso se desincroniza (la lección de `map.sh index`).
- **Frontera de confianza de `run_code_unsafe` (RCE-equivalent).** Estructura del store (confiable)
  ≠ datos/args (no confiables → SIEMPRE `JSON.stringify`, literal JS inerte). El `sel:` plantilla es
  el único punto donde un valor va en un string de selector → escape por-engine (`escapeStringName`/
  `escapeRegexName` de `selector.mjs`) ANTES del `JSON.stringify`. Red final: `assertCompiledSafe`
  inspecciona el ESQUELETO (strings vaciados) contra una allowlist; rechaza `require`/`import`/
  template strings/`page.<no permitido>`. Test estrella: `args={'id':'x"); fetchEvil(); //'}`
  queda inerte. Dry-run obligatorio antes de `--fast`.
- **PII en `extract`.** El peligro de extraer no es el código, es el DATO devuelto (IBAN/NIF). El
  return de PII va a una acción, no al contexto; el dry-run lo hace visible. `recipe.mjs` no adivina
  PII; un tag `sensible:` en el locator puede señalarlo (v2).
- **No-goals v1:** sin composición `run:` (recetas planas); sin `wait-for`/`select-option`/
  `press-key`; sin self-healing de recetas (re-record asistido, como el resto del plugin).

## No-goals de v1 (rutas conscientes, no olvidos)
- **Self-healing automático que reescriba el perfil solo al fallar.** El roadmap de
  workflow-use lo tiene SIN implementar y su fallback LLM está auto-descrito como
  *"currently really bad, not recommended for production"* `[verificado]`. No prometemos
  más que re-record + re-confirmación humana.
- **Esquema por-sitio rico/rígido.** Magro gana. Escala por adición.

---

## Abierto (no validado por la investigación — no inventar)

- `[abierto]` **Puente con recon de pentest** (Katana JSONL, site map de Burp, sitemap de
  ZAP, gospider/hakrawler): ningún claim sobrevivió la verificación. Alinear nuestro
  esqueleto con la salida de un crawler es decisión de diseño abierta, no recomendación.
- `[abierto]` **No hay proyecto OSS para adoptar**: la búsqueda de un MCP/plugin de
  "memoria de navegación por sitio" sobre Playwright/CDP volvió vacía. Construir, no copiar.

---

## Fuentes clave (verificadas en la investigación)

- AWM — github.com/zorazrw/agent-workflow-memory · arxiv 2409.07429 (induce-store-reinject).
- Voyager — arxiv 2305.16291 (skill library componible). ExpeL — arxiv 2308.10144 (insights NL).
- Synapse — arxiv 2306.07863 (state abstraction contra context bloat).
- Stagehand — browserbase.com/blog/stagehand-caching (re-record-on-drift). El detalle de
  caché es v3 y la fuente fiable es el BLOG, no los docs (3 claims de docs refutados 1-2).
- workflow-use — github.com/browser-use/workflow-use (índice separado; self-healing = vaporware).
- Locators — Leotta 2014 (ISSREW) · Kluge & Stocco 2025 (arxiv 2505.16424, Similo).
