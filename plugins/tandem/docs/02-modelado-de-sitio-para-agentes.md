# Estudio 02 — Modelado de un sitio para agentes: del locator al modelo de tres capas

**Proyecto:** tandem
**Fecha:** 2026-06-29
**Estado:** investigación CERRADA; diseño de tres capas = **hipótesis, NO implementada**.
**Depende de:** `01-memoria-de-navegacion.md` (memoria de navegación por sitio).
**Investigación base:**
- (a) Búsqueda web de agentes 2025–2026, hecha en sesión, **fuentes recientes verificadas leyendo el texto original** (no resúmenes de buscador).
- (b) Deep-research vía Perplexity sobre el fondo clásico (IR, web semántica, web engineering, representación compacta). Conservada **íntegra** en `02-anexo-fondo-clasico-perplexity.md`.

> **Aviso de verificación (disciplina anti-alucinación).** Las fuentes RECIENTES y decisivas
> (WebChallenger, CowPilot, WebNavigator, ALLOY) se verificaron contra el texto original con
> cita literal. Los CLÁSICOS del fondo (vía Perplexity) se toman como **consenso de campo**
> sin re-verificar uno a uno: coinciden con conocimiento textbook establecido. Un claim que
> sonaba potente y resultó **humo** se registra como ruta cerrada (Knowledge Topology, §1).
> Regla: ningún claim recién aparecido toca el diseño sin pasar por su fuente.
> **Erratas detectadas al re-verificar puntos sueltos del anexo: ver §«Erratas verificadas del
> anexo» al final** (SimHash mal atribuido, quad count 2022/2023, universos Schema.org).

---

## Problema / pregunta de diseño

El recon de tandem (Estudio 01) tiene un **sesgo de autoría**: el agente explora la estructura
(rutas, locators) y **redacta** el perfil; el humano sólo **confirma/corrige**. El modelo del
humano —qué importa, qué es trampa, qué flujo tiene sentido— **no tiene canal propio de entrada**:
entra como correcciones sueltas (gotchas), nunca como aporte. El mapa sale como *índice de lugares*,
no como *territorio con topología + intención*.

Pregunta: **¿cómo capturar el modelo de un sitio (topología + semántica + intención) de forma
magra, con el humano como AUTOR y no sólo corrector?**

Distinción que ordena todo lo que sigue (no mezclar): **topología** (qué ruta conecta con cuál) es
estructura *observable* — la ve el agente. **Intención** (qué importa / qué es trampa / el flujo con
sentido) **no es observable** — vive en el humano. Son dos piezas con dueños distintos.

---

## Parte 1 — Estado del arte de agentes web (verificado en sesión)

| Trabajo | Qué aporta | Construcción | Persiste modelo humano |
|---|---|---|---|
| **WebChallenger / PageMem** ([2606.10423](https://arxiv.org/abs/2606.10423), 9 jun 2026) | Memoria de sitio reutilizable; SOTA open-weight | **Auto, determinista, cero humano** | **No** |
| **WebNavigator** ([2603.20366](https://arxiv.org/abs/2603.20366), mar 2026) | Interaction graph; nombra "Topological Blindness" | Auto (BFS), cero LLM/humano | No |
| **R2D2** ([ACL 2025](https://aclanthology.org/2025.acl-long.1464/)) | Mapa observado + A\* con heurística LLM | Auto (replay buffer) | No |
| **CowPilot** ([2501.16609](https://arxiv.org/abs/2501.16609), feb 2026) | Humano+agente, MISMO navegador (≈ tandem) | Humano **reactivo** | **No** (no persiste nada) |
| **ALLOY** ([2510.10049](https://arxiv.org/abs/2510.10049), oct 2025) | Modelo humano **por demostración**, nodos semánticos+NL | Demostración + refinamiento | Sí, pero como *workflow de tarea*, no mapa de sitio |
| **UICOMPASS** ([EMNLP 2025](https://aclanthology.org/2025.emnlp-main.1346.pdf)) | "UI Map" = activities + steps semánticos | — *(vía resumen, no literal)* | — |

Citas literales que sostienen lo decisivo:

- **WebChallenger** — `WebsiteMem` *"is constructed once per site and reused across all subsequent
  tasks"*, guardado *"per-site as JSON"*, frugal (*"only a handful of extra tokens per prompt"*).
  Construcción: *"fully deterministic: it requires no LLM guidance, task demonstrations, or external
  resources"*. → **Valida la arquitectura de tandem** (memoria por sitio, JSON, reutilizada, magra)
  y a la vez **es cero-humano**.
- **CowPilot** — el humano *"provide[s] contextual feedback by identifying and correcting prior
  mistakes"*; y *"no mechanism for persisting or reusing human input across different task sessions
  is described"*. → El análogo más cercano a tandem tiene **exactamente nuestro hueco**.
- **ALLOY** — *"each node represents a semantically meaningful sub-task rather than low-level browser
  operations"*, con *"a detailed natural language prompt"*. → Pista de **método** (demostración) y de
  **forma magra** (nodo = unidad semántica + frase de intención).

**Conclusión de la Parte 1:** todo el campo converge en **memoria-de-sitio auto-derivada**
(estructura + comportamiento + topología). El hueco —**intención humana persistida en el mapa del
sitio**— no lo cubre nadie, **porque el campo va hacia la autonomía total y no tiene humano en el
loop**. Tandem es el único sistema con humano dentro **y** memoria persistente: la única posición
desde la que ese hueco es llenable. `[verificado en sesión]`

**[Ruta cerrada] "Knowledge Topology"** ([2603.14805](https://arxiv.org/abs/2603.14805)): el resumen
de buscador lo presentaba como *"routing graph que responde qué viene después"* — definición
perfecta para nosotros. El texto original **no lo define**: es un bullet sin schema. El snippet
alucinó. Lección: verificar contra fuente, siempre.

---

## Parte 2 — Fondo clásico (vía Perplexity; consenso de campo, no re-verificado uno a uno)

Lo que el saber pre-LLM aporta a tandem. Detalle y referencias completas en
`02-anexo-fondo-clasico-perplexity.md`.

**Valida piezas que tandem ya tiene, con pedigrí teórico:**
- `fingerprint.mjs` (esqueleto estructural, normaliza dígitos a `#`) = **structural hashing / DOM
  tree-edit-distance** (Zhang & Shasha, JACM 1989). Clásico y vigente.
- `sel:` plantilla (`role=row[name=/^{id}/]` para filas) = **wrapper induction** (Kushmerick,
  IJCAI'97; DEPTA, IEEE TKDE 2006): inferir la plantilla de las páginas generadas por template.
- Operar sobre el snapshot (árbol de accesibilidad) y no el DOM crudo = consenso: el a11y tree
  (WAI-ARIA) es ~10–100× más compacto que el HTML; es la observación de facto en WebArena.

**Da el cómo mantener la topología MAGRA** (la obsesión del Estudio 01):
- Modelar la navegación como capa propia, separada de datos y presentación: **navigation model**
  de WebML (Ceri et al., 2000) y OOHDM (Schwabe & Rossi, 1995). El instinto "el mapa es lo primero"
  tiene 25 años de respaldo en web engineering.
- **Podar** el grafo de estados (State Flow Graph) por *event productivity*: descartar self-loops y
  state-independent events (tesis citada en el anexo, ref. 82). → topología sin engordar.
- Colapsar páginas isomórficas (mismo template → un nodo). → magro por construcción.

**Aporta material NUEVO al plugin — semántica declarada por el propio sitio:**
- **Schema.org / JSON-LD** embebido en `<script type="application/ld+json">`: el sitio declara sus
  entidades tipadas (Product, Article, Organization…) sin heurística, en <2KB. Adopción masiva
  (WebDataCommons: decenas de millones de sitios; el orden es sólido, la cifra exacta baila).
  Tandem **hoy no lo lee**. Es semántica de CONTENIDO gratis.

---

## Parte 3 — Síntesis: el modelo de tres capas  `[HIPÓTESIS de diseño]`

Cada capa tiene **un dueño distinto** y un grado de madurez distinto:

- **Capa A — topología + estructura.** *Dueño: la máquina (yo).* Grafo de clases-de-página +
  transiciones observadas al navegar. **Estado del arte ya resuelto** (WebChallenger/R2D2): adoptar,
  no reinventar. Magro vía poda (event productivity) + colapso por template (wrapper induction);
  fingerprint estructural ya existe.
- **Capa B — semántica declarada.** *Dueño: el sitio.* Extraer el JSON-LD/Schema.org de las páginas.
  Gratis, tipado, magro. **Nuevo en tandem.** Reduce lo que el humano tiene que aportar.
- **Capa C — intención humana.** *Dueño: el humano (the author).* Qué importa, qué es trampa, el flujo con
  sentido. **No está en ningún DOM ni en ningún `<script>`.** Se capta por demostración (à la ALLOY)
  + entrevista —porque el humano está en el loop— y se persiste magra: una frase de intención por
  ruta, con canal propio (hoy sólo existe difusa como gotchas).

Las tres, **fundidas en el map persistente**. A y B las pone la máquina y el sitio (estado del arte);
**C es el aporte único de tandem**, estructuralmente imposible para un agente autónomo.

**La simbiosis "para ambos", anclada:** no está en repartir tareas. Está en que dos de las tres
capas (A, B) ya son estado del arte que la máquina y el sitio resuelven, y el humano aporta la
tercera (C) que ningún agente autónomo puede aportar. Tandem no compite en autonomía con
WebChallenger —perdería—; **ocupa el hueco que la autonomía deja vacío por construcción**.

---

## Estado y rutas

- `[verificado en sesión]` El gap —intención humana persistida en memoria de sitio compartida— **no
  lo cubre el SOTA de jun 2026** (verificado contra WebChallenger, CowPilot, WebNavigator, ALLOY).
  Matiz honesto: es *ausencia hasta donde alcanza esta búsqueda*, no un absoluto.
- `[hipótesis]` El **formato magro de tres capas** — sin probar. **Siguiente paso:** recon real de
  `books.toscrape` reescrito con A+B+C, comprobar si el flujo emerge **sin engordar** (o muere ahí).
- `[ruta cerrada]` "Knowledge Topology" como marco — humo (no definido en su fuente).
- `[abierto]` Pata de **memoria/persistencia** (WebCoach con su *WebCondenser* traces→resumen; M²;
  mem0) — no profundizada; podría dar técnica de condensación, pero no es el corazón del hueco.
- `[abierto]` Capa B: decidir si el JSON-LD se guarda en el perfil o se lee on-demand al navegar.
- `[CERRADO: verificado en cuerpo del PDF, 2026-06-29]` Las tres atribuciones que sostienen el
  argumento central, **confirmadas con cita literal del cuerpo** (no del abstract):
  - **(a) WebsiteMem existe** — nombre exacto del componente de memoria de SITIO de WebChallenger
    (distinto de PageMem, que es por página). §2.2: *"A WebsiteMem ℳw contains all PageMems and
    elements encountered on a website w."*
  - **(b) "fully deterministic / no LLM guidance"** aplica a la construcción de la WebsiteMem, no
    sólo a PageMem. §2.3: *"Exploration is fully deterministic: it requires no LLM guidance, task
    demonstrations, or external resources."*
  - **(c) WebNavigator usa BFS** — concretamente *"Adaptive BFS"*. §3.1: *"a heuristic
    auto-exploration engine based on breadth-first search (BFS)"*.
  - **Matiz que refuerza el modelo de tres capas:** en WebChallenger el *mapa estructural* es
    determinista y sin LLM (Appendix A.2 precisa que el recorrido es *depth-first*, no BFS — eso es
    WebNavigator), pero el *enriquecimiento semántico* (resúmenes de sección) se rellena con LLM en
    inferencia y se **cachea** dentro de la WebsiteMem. Es decir, el propio SOTA ya separa
    estructura-barata-determinista (≈ capa A) de semántica-cara-con-LLM (≈ parte de B) — exactamente
    el corte que propone este estudio. `[observación verificada, no decisión de diseño]`

---

## Erratas verificadas del anexo

El anexo `02-anexo-fondo-clasico-perplexity.md` se conserva **íntegro** (es la copia fiel del
deep-research, sin retocar). Estas correcciones se registran aquí, no en él. Verificadas contra
**fuente primaria** el 2026-06-29 (no resúmenes de buscador).

- **[REFUTADA] "Manber y Charikar (2002) introdujeron el SimHash".** Confabulación doble: (1) Charikar
  2002 ("Similarity Estimation Techniques from Rounding Algorithms", STOC 2002) es **autor único** —
  Manber no figura ([DBLP](https://dblp.org/rec/conf/stoc/Charikar02.html) + PDF de las actas). (2) El
  término *"SimHash"* **no aparece** en ese paper (0 ocurrencias; describe LSH por hiperplanos
  aleatorios); el nombre lo asienta **Manku, Jain & Das Sarma (2007, WWW)**, que lo llaman *"Charikar's
  simhash"* ([PDF Google](https://research.google.com/pubs/archive/33026.pdf)). Udi Manber es real pero
  de otro trabajo independiente y 8 años anterior: *sif*, "Finding Similar Files in a Large File
  System", USENIX 1994 — sin coautoría con Charikar. **Corrección:** el algoritmo es de Charikar
  (2002); la etiqueta "simhash" es de Manku et al. (2007); Manber (1994) es una línea aparte.

- **[ERROR FACTUAL] "El release de octubre 2023 contiene 86 mil millones de quads RDF".** Son
  **97,7 mil millones** ([WebDataCommons 2023-12 stats](https://webdatacommons.org/structureddata/2023-12/stats/stats.html)).
  Los 86 mil millones son del release de **2022**: el informe cruzó el conteo de quads de 2022 con las
  estadísticas de 2023. El resto de cifras de esa frase son **correctas** (3,35 mil millones de
  páginas; JSON-LD 9,5M sitios, Microdata 7,4M, RDFa 0,5M).

- **[MATIZ, no error] Las dos cifras de Schema.org no miden el mismo universo.** "45M dominios / 450
  mil millones de objetos" **sí es cita oficial** (homepage de [schema.org](https://schema.org), a
  2024) — autodeclarada, redonda (ratio 10:1) y sin metodología publicada, pero no inventada por el
  informe. Mide el índice **completo de Google**. La cifra de WebDataCommons (14,6M dominios / 97,7B
  quads, [anuncio W3C 2024-02-06](https://lists.w3.org/Archives/Public/public-schemaorg/2024Feb/0001.html))
  mide **Common Crawl** (muestra parcial). El anexo las yuxtapone como comparables; son metodologías
  distintas (de ahí el ~3× de diferencia). Tratar 45M/450B como "cifra oficial sin metodología
  verificable", no como dato auditado.

- **[VERIFICADO OK] Las fuentes recientes existen, ninguna confabulada.** WebChallenger
  ([2606.10423](https://arxiv.org/abs/2606.10423)), WebNavigator ([2603.20366](https://arxiv.org/abs/2603.20366)),
  R2D2 (ACL 2025), CowPilot ([2501.16609](https://arxiv.org/abs/2501.16609)), ALLOY
  ([2510.10049](https://arxiv.org/abs/2510.10049)) resuelven a papers reales (API de arXiv / ACL
  Anthology). WAI-ARIA 1.3 existe como **W3C Working Draft del 04-jun-2026** (no Recommendation, como
  podría leerse del anexo). Caveat de atribuciones de detalle: ver la ruta `[abierto]` arriba.

---

## Fuentes

Recientes (verificadas en sesión): WebChallenger ([2606.10423](https://arxiv.org/abs/2606.10423)) ·
WebNavigator ([2603.20366](https://arxiv.org/abs/2603.20366)) · R2D2 ([ACL 2025](https://aclanthology.org/2025.acl-long.1464/)) ·
CowPilot ([2501.16609](https://arxiv.org/abs/2501.16609)) · ALLOY ([2510.10049](https://arxiv.org/abs/2510.10049)) ·
UICOMPASS ([EMNLP 2025](https://aclanthology.org/2025.emnlp-main.1346.pdf), vía resumen).

Clásicas (vía Perplexity, consenso de campo): ver `02-anexo-fondo-clasico-perplexity.md` — Zhang &
Shasha 1989 · Kushmerick 1997 · Zhai & Liu 2006 · Ceri et al. 2000 · Schwabe & Rossi 1995 ·
WAI-ARIA / WebArena · Schema.org / WebDataCommons.
