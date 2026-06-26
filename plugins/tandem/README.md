# tandem

Un navegador Chrome **compartido en tiempo real** entre tú y Claude Code, que **aprende cómo se
navega cada sitio**. Una sola ventana: tú la conduces con el ratón (y pasas captchas, checkpoints
anti-bot, logins con 2FA); Claude opera por CDP vía el [Playwright MCP](https://github.com/microsoft/playwright-mcp)
(lee el DOM renderizado, ejecuta JS, saca snapshots, inspecciona red). Y con `tandem:map`, Claude
recuerda el esqueleto, los locators y las recetas de cada sitio para navegar *sabiendo* en vez de
re-derivar el DOM cada vez.

> **Encuadre honesto.** El navegador compartido es cableado de piezas existentes (Chrome + CDP +
> Playwright MCP) listo para humano-en-el-loop. Y no es terreno virgen: en 2026 ya hay memoria de
> sitio cross-sesión (p.ej. WebCoach), *semantic locators* por rol+nombre como práctica estándar, y
> handoff humano para captcha/login (AuthRelay, Cloudflare Browser Run, BrowserAct). La diferencia de
> tandem no es inventar una pieza nueva: es **dónde vive el conjunto** — local, sobre el **mismo
> Chrome real que tú ves y tocas**, nativo de terminal/Claude Code, con una memoria de sitio
> **co-curada y legible** (`sites/<host>.md` en markdown que editas y commiteas, no un store opaco ni
> un SaaS en la nube). Sobre eso, `tandem:map` añade lo que sí cuesta encontrar combinado: drift por
> señal estructural + **locators ejecutables** (`sel:`) para accionar **sin re-snapshotear** (~18×
> menos por acción, medido), con un gate de fingerprint para que saltarse el snapshot sea honesto.

## Qué lo distingue: `tandem:map`

Operar un sitio conocido normalmente cuesta un `browser_snapshot` enorme cada vez, con refs
efímeros que cambian entre páginas. `tandem:map` persiste un **perfil por sitio**
(`~/.claude/tandem/sites/<host>.md`, fuera de git) con:

- **Esqueleto de rutas** y **locators durables** anclados por rol+nombre del árbol de
  accesibilidad (no por refs frágiles ni posición), multi-ancla.
- **Recetas** de navegación y **gotchas**, cada línea con fecha y tag `[verificado]`/`[hipótesis]`.
- **Auto-inyección**: al navegar a un host con perfil, un hook `PostToolUse` mete el perfil en el
  contexto de Claude — una vez por sesión, silencio si no hay perfil.
- **Drift por señal, no por fecha**: un fingerprint del *esqueleto* (no de los datos) detecta cuándo
  la estructura de una página cambió, para revalidar solo lo que toca.
- **Locators ejecutables (`sel:`)**: el perfil no solo *describe* los locators, los hace
  *accionables*. El agente clica/escribe por selector durable (`role=button[name="…"]`) **sin
  re-snapshotear** — un snapshot del árbol pesa ~18× el perfil entero. Saltárselo solo cuando el
  fingerprint de la ruta da `match` (gate, no fe).
- **Recetas ejecutables** (*procedural memory*): tareas repetidas y nombradas (`abrir-ticket-por-id
  TCK-2026-123`) viven como recetas **parametrizadas** que se compilan a pasos observables
  (`--step`) o a una función Playwright de 1 tool call (`--fast`). Co-curadas y legibles.

El diseño y la investigación que lo respaldan: [`docs/01-memoria-de-navegacion.md`](docs/01-memoria-de-navegacion.md).

## Arquitectura

```
Chrome (headed, perfil dedicado, --remote-debugging-port en 127.0.0.1)
   ▲ ratón (humano)               ▲ CDP (Claude)
   └── ventana visible            └── npx @playwright/mcp --cdp-endpoint → tools browser_*
```

- **`scripts/chrome-daemon.sh`** `{start|stop|restart|status}` — ciclo de vida de Chrome,
  idempotente, basado en healthcheck CDP (la verdad del estado es el CDP, no el PID).
- **`scripts/mcp-launch.sh`** — command del `.mcp.json`; solo lanza el Playwright MCP (lazy, no
  arranca Chrome, así el `initialize` nunca se bloquea).
- **`scripts/map.sh`**, **`scripts/fingerprint.mjs`**, **`scripts/page-signals.mjs`**,
  **`scripts/selector.mjs`**, **`scripts/recipe.mjs`**, **`scripts/hook-inject-profile.mjs`** —
  motor de `tandem:map` (store de perfiles, fingerprint de página, drift, selectores ejecutables,
  recetas, auto-inyección). `page-signals.mjs print` emite el evaluate canónico; `selector.mjs`
  genera los `sel:`; `recipe.mjs compile` compila las recetas a Playwright (`--fast`) o pasos (`--step`).
- **`skills/`** — `tandem` (cómo operar el navegador compartido) y `map` (memoria de sitio).
- **`agents/web-navigator.md`** — subagente para extracción pesada sin contaminar el contexto principal.

## Instalación

Vía el marketplace **quimera** de Claude Code:

```
/plugin marketplace add bgmacris/quimera
/plugin install tandem@quimera
```

Requiere Google Chrome (o Chromium) y Node 18+ (`npx` lanza el Playwright MCP).

## Uso

1. `/tandem:browser-start` — abre la ventana compartida.
2. Pide a Claude que navegue/analice. Si un muro requiere humano, lo pasas tú con el ratón y Claude
   sigue desde el DOM ya renderizado.
3. La primera vez que navegas a un sitio, si hay perfil de `tandem:map`, se carga solo. Para crear
   uno: pídele a Claude un recon (explora → te propone un borrador → confirmas → se guarda).
4. `/tandem:browser-status` · `/tandem:browser-stop`.

## Configuración (variables de entorno)

| Variable | Por defecto | Para qué |
|---|---|---|
| `TANDEM_CHROME_BIN` | autodetección (macOS/Linux) | ruta al binario de Chrome/Chromium |
| `TANDEM_CDP_PORT`   | `9222` | puerto del CDP en loopback |
| `TANDEM_DATA_DIR`   | `~/.claude/tandem` | perfil de Chrome, logs y perfiles de sitio |

## Seguridad

- Perfil **dedicado** en `${TANDEM_DATA_DIR}/chrome-profile` — nunca el Chrome personal.
- CDP en **loopback** (`127.0.0.1`), sin auth: cualquier proceso local controla el navegador
  mientras viva → vida corta, cierre con `/tandem:browser-stop` y en `SessionEnd`.
- El perfil acumula cookies/tokens de logins: trátalo como secreto, fuera de git y backups.
- Los perfiles de `tandem:map` guardan **estructura** (rutas, locators), nunca datos sensibles, y
  viven fuera de git por defecto.
- `browser_evaluate`/`browser_run_code_unsafe` ejecutan JS arbitrario en la página: para análisis,
  no para acciones destructivas ni exfiltración.

## Desarrollo

Antes de publicar o tras tocar el shell/JS, dos checks (ninguno arranca Chrome):

```
tests/smoke.sh                                   # motor de tandem:map + guardias de regresión
shellcheck -x -S style scripts/*.sh bin/* tests/*.sh   # lint del shell (brew install shellcheck)
```

`smoke.sh` aísla el estado en un `TANDEM_DATA_DIR` temporal y verifica: parseo de todos los
scripts, bit `+x` de los invocables, `map.sh` (incluido `index` con JSON válido aunque el
frontmatter lleve comillas), `fingerprint` (capture/check/drift y **rechazo de host con
traversal**), y el hook de inyección (silencio sin perfil · una-vez-por-sesión · cleanup).
El arranque/parada real de Chrome necesita display y se prueba a mano: `/tandem:browser-start`
→ `/tandem:browser-status` → `/tandem:browser-stop`.

## Requisitos y alcance

- **macOS**: soportado y probado.
- **Linux**: autodetección de Chromium implementada (usa `lsof` o `ss`); **no probado en CI** aún.
- **Windows**: no soportado (el ciclo de vida es bash/POSIX).
- Google Chrome o Chromium · Node 18+ · Claude Code v2.1.120+.
