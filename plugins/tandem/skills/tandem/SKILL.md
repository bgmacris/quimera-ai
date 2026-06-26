---
name: tandem
description: Cómo operar el navegador Chrome compartido con el humano (tools browser_* del MCP tandem). Úsalo cuando haya que navegar, leer/analizar páginas, superar bloqueos que requieren interacción humana (captchas, checkpoints anti-bot, logins), o inspeccionar red/DOM en tiempo real junto al humano.
---

# tandem — navegador compartido humano + Claude

El humano y tú compartís UN MISMO Chrome en tiempo real. El humano lo ve y lo maneja con ratón;
tú lo operas con las tools `browser_*` del MCP `tandem` (Playwright sobre CDP). Lo que
hace uno, lo ve el otro: estado, cookies y sesión son los mismos.

## Arranque
- El navegador NO arranca solo. Si las tools `browser_*` dan `ECONNREFUSED 127.0.0.1:9222`,
  es que Chrome no está: pide al humano que ejecute `/tandem:browser-start` (o ejecútalo tú si
  tienes el command disponible). Comprueba estado con `/tandem:browser-status`.

## Reparto de trabajo
- **El humano hace** lo que requiere ser humano: resolver captchas, pasar checkpoints anti-bot
  (p.ej. Vercel Security Checkpoint), logins con 2FA, decisiones visuales.
- **Tú haces** el análisis: `browser_snapshot` (árbol de accesibilidad, mejor que screenshot
  para razonar y accionar), `browser_evaluate` (JS), `browser_network_requests`, extracción
  de datos, rellenar formularios, clicar por ref del snapshot.
- Patrón típico de desbloqueo: el humano supera el muro → tú lees el DOM ya renderizado y analizas.

## Dos modos: en vivo vs delegado (no contaminar el contexto)
Hay dos formas de navegar; elige según la tarea, no por defecto una:
- **En vivo (en este contexto):** cuando hay reparto con el humano (muros que pasa él: captcha,
  checkpoint, login), navegación interactiva o decisiones sobre la marcha. El humano está en el loop.
- **Delegado al subagente `web-navigator`:** cuando es lectura/extracción PESADA sin muros
  (snapshots grandes, scraping, recorrer varias páginas). El subagente se traga el DOM/snapshots
  en SU contexto y te devuelve solo el dato destilado → este contexto no se contamina. Compartís
  el MISMO Chrome (estado global), así que el humano sigue viendo la ventana.
- Regla: si la tarea va a generar mucho ruido (snapshots de cientos de KB, multipágina) y NO
  necesita al humano en vivo → delega. Si necesita reparto humano o iterar contigo → en vivo.
- Límite del delegado: el subagente no habla con el humano. Si topa con un muro, devuelve cuál y dónde;
  tú se lo dices al humano, él lo pasa, y relanzas el subagente para continuar.

## Coreografía de pestañas (no robar el foco)
- Por defecto el MCP **reusa la pestaña activa**. Si el humano está leyendo algo, NO navegues sobre
  su pestaña sin avisar: abre la tuya con `browser_tabs` (new) y trabaja ahí.
- Antes de una navegación que cambie lo que el humano ve, dilo ("voy a abrir X en una pestaña nueva").
- Para acciones: por ref del `browser_snapshot` más reciente, o por un **selector único** durable
  (`target` acepta ambos — [verificado]). Nunca coordenadas. Si hay perfil con `sel:`, accionar por
  selector evita el snapshot (ver "Accionar sin snapshot" y la skill `tandem:map`).

## Seguridad (innegociable)
- Es un **perfil dedicado**, no el Chrome personal del humano. Aun así, cualquier login que el humano
  haga ahí deja cookies/tokens accesibles vía CDP. NO navegues a sitios sensibles (banca,
  correo personal) en la pestaña compartida salvo que el humano lo pida explícitamente.
- `browser_evaluate` ejecuta JS arbitrario en la página: úsalo para análisis, no para acciones
  destructivas o exfiltración. Nada de mandar datos de la sesión a terceros.
- Trabajo de pentest: solo en alcance autorizado; el navegador compartido no es excusa para
  salir de alcance.

## Si Chrome muere a media sesión
- Las tools fallan con error de conexión (`ECONNREFUSED` si no hay nada en el puerto, o
  "Target page/context/browser has been closed" si el MCP tenía un handle al Chrome anterior).
  El server MCP sigue vivo.
- Pide `/tandem:browser-start` para rearrancar Chrome. Luego **reintenta la tool**: el PRIMER
  uso tras un Chrome nuevo puede fallar con "page closed" (handle muerto); el SEGUNDO reconecta
  (verificado). No hace falta reiniciar el MCP ni la sesión, solo reintentar una vez.

## Memoria de sitio (skill `tandem:map`)
Esta sección de abajo es técnica CROSS-site (vale en cualquier web). El conocimiento
DE-un-sitio concreto (sus rutas, su buscador, sus locators) vive en un **perfil por host**
gestionado por la skill `tandem:map` (`~/.claude/tandem/sites/<host>.md`).
- Al empezar a operar un sitio: mira si hay perfil (`scripts/map.sh show <host>`). Si existe,
  léelo ANTES de tirar snapshots — navegas sabiendo, no re-derivando. Si no existe y el
  trabajo no es trivial, ofrece al humano hacer recon y guardarlo (recon asistido).
- Refs `eNN` del snapshot son efímeros: en los perfiles se anclan locators por rol+nombre,
  nunca por ref ni posición. Detalle: la skill `tandem:map` y `tandem/docs/01-*`.

## Navegación real — patrones (LISTA VIVA, destilada de uso real)
Estas reglas nacen de navegaciones concretas, no de teoría. Crecen cada vez que una web
nueva rompe algo. Marca cada regla como [verificado] (vivido) o [hipótesis] (por validar).

### Lectura eficiente (no quemar contexto)
- [verificado] `browser_snapshot` de páginas grandes puede exceder el límite de tokens (visto:
  135 K en una página de catálogo). NO lo vuelques al contexto. Extrae solo lo necesario con
  `browser_evaluate` (JS que devuelve datos limpios) o con grep sobre el archivo que el snapshot
  guarda en disco. El snapshot completo es el último recurso, no el primero.
- [verificado] Para datos repetidos (listas, cards, tablas) usa `browser_evaluate` con un
  `querySelectorAll` dirigido y devuelve un array compacto, no el árbol entero.

### Accionar sin snapshot (navegación frugal)
- [verificado] El `target` de `browser_click`/`type`/`evaluate` acepta un **selector único** además
  del ref del snapshot: CSS (`h1`) y engines Playwright (`role=button[name="X"]`, regex en `name=`).
  Probado resolviendo sin snapshot previo.
- Con un perfil de `tandem:map` que tenga `sel:`, acciona por selector y SÁLTATE el snapshot
  (cuesta ~18× el perfil), validando antes la ruta con `fingerprint.mjs check` (gate, no fe).
  Flujo completo: skill `tandem:map` §"Flujo frugal".
- [verificado] En SPAs de render diferido, `browser_wait_for` sobre el `sel` ANTES de accionar: el
  primer intento puede no encontrar el elemento todavía.
- **Recetas ejecutables**: una tarea repetida y nombrada (p.ej. "abrir ticket por id") puede vivir
  como receta parametrizada en el perfil. `scripts/recipe.mjs compile <host> <receta> <args>` la
  compila a pasos (`--step`, observable) o a una función Playwright (`--fast`, 1 call vía
  `browser_run_code_unsafe` — dry-run obligatorio, RCE-equivalent). Detalle: skill `tandem:map`.

### Señal vs ruido
- [verificado] Una extracción amplia (p.ej. `a[href*="/x/"]`) captura basura: archivos auxiliares,
  duplicados, enlaces internos. Filtra y deduplica ANTES de reportar.
- [verificado] No confundas lo extraído con lo curado: "96 enlaces ≠ 96 ítems". Di el número real
  tras filtrar y marca lo que no puedas confirmar como lista oficial.

### Carga dinámica (scroll infinito / lazy-load)
- [verificado] El primer snapshot/evaluate de una página con scroll infinito está INCOMPLETO
  (visto: 10 de 100 ítems en quotes.toscrape.com/scroll). Para recogerlo todo: un `browser_evaluate`
  ASÍNCRONO que hace scroll al fondo en bucle hasta que el conteo se ESTABILIZA (N iteraciones sin
  cambio) con tope de seguridad, y recoge los datos en la misma pasada:
  `while (stable<3 && iters<60){ scrollTo(0,scrollHeight); await sleep(350); n=count; if(n==prev)stable++ else{stable=0;prev=n} }`
  Resultado: 10→100 en 6 iteraciones, paró solo. Un único tool call hace toda la carga.

### Paginación
- [verificado] Detecta primero cuántas páginas hay (texto tipo "Page 1 of 50") para no recorrer
  a ciegas. Recorre con un `browser_evaluate` async usando `fetch` MISMO-ORIGEN + `DOMParser`
  (no recarga la ventana del humano en cada salto) y acumula, con un **TOPE de páginas EXPLÍCITO**.
  Visto: books.toscrape.com, 3 de 50 páginas → 60 libros. Si necesitas más que el tope, súbelo
  conscientemente y dilo; nunca recorras las N sin límite ni lo silencies.

### Obstáculos (cookie banners / modales de consentimiento)
- [verificado] Suelen vivir en un IFRAME de un tercero (Sourcepoint, OneTrust…), cross-origin.
  Consecuencia: `browser_evaluate` del documento TOP **no los alcanza** (ni leer ni clicar dentro
  del iframe). Visto en theguardian.com (iframe "SP Consent Message").
- [verificado] PERO `browser_snapshot` SÍ aplana los iframes: los botones aparecen con refs de
  frame (tipo `f2e58`) y `browser_click` por ese ref los acciona. Patrón: snapshot → localizar el
  botón ("Accept all"/"Reject all") → `browser_click` por ref. Si falla, lo cierra el humano con el ratón.
  Aceptar/rechazar cookies es decisión del humano: no pulses "Accept all" por tu cuenta salvo que
  el humano lo pida.

### Guardar snapshots a archivo
- [verificado] `browser_snapshot(filename: "x.md")` guarda relativo al cwd del MCP (acabó en `~`),
  IGNORANDO `--output-dir` → ensucia el home. Usa ruta ABSOLUTA en filename, o no pases filename
  (la referencia automática ya va al output-dir).

### SPA / contenido renderizado por JS
- [verificado] `browser_navigate` espera al render inicial (Playwright espera 'load'): en
  quotes.toscrape.com/js las 10 quotes pintadas por JS estaban listas sin wait extra. Solo
  necesitas `browser_wait_for` para contenido DIFERIDO (XHR posterior, lazy tras interacción).

### Formularios / login
- [verificado] Form pequeño → `browser_snapshot` devuelve refs inline. Patrón: `browser_type`
  por ref en cada campo → `browser_click` en submit (o `browser_type submit:true`) → verificar el
  estado post-acción (p.ej. aparece enlace `/logout`). Validado en quotes.toscrape.com/login.
  Login con 2FA/captcha: lo hace el humano (reparto humano-IA).

### Cómo crece esta lista
Cada web nueva que rompa un patrón → añade aquí la regla con su marca [verificado]. No metas reglas
teóricas sin haberlas vivido: este perfil vale porque nace de evidencia, no de catálogo.
