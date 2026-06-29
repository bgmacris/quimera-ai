# Modelado, Indexación y Composición Estructural de Sitios Web para Máquinas

*Investigación académica profunda · Ejes: IR clásico, Web semántica, Web Engineering, Representación compacta, Síntesis para agentes · Cobertura 1990–2026*

***

## Resumen Ejecutivo

Entender cómo una máquina "lee" y navega un sitio web requiere integrar al menos cinco capas de conocimiento: (1) los algoritmos de crawling y descubrimiento que guían la exploración del grafo hipermedia; (2) las estructuras de indexación que permiten recuperar documentos eficientemente; (3) el grafo de la web como objeto matemático con propiedades topológicas bien estudiadas; (4) los formalismos de modelado de hipertextos y aplicaciones web que capturan navegación y semántica de forma estructurada; y (5) las técnicas de representación compacta que comprimen ese modelo a una forma mínimamente navegable. Gran parte del saber más sólido sobre estos temas es *pre-LLM* —décadas de investigación en Information Retrieval, Web Engineering y Semantic Web— y sigue siendo el substrato sobre el que los sistemas modernos construyen.

***

## 1. INDEXACIÓN Y RECUPERACIÓN DE INFORMACIÓN EN LA WEB

### 1.1 Crawling: Descubrimiento y Frontera

El crawling de la web es fundamentalmente una instancia de búsqueda en grafo sobre un grafo hipermedia enorme y dinámico. La referencia canónica del campo es la monografía de **Olston y Najork (2010)** en *Foundations and Trends in Information Retrieval*, que sistematiza décadas de práctica. Su arquitectura clásica consiste en una *URL frontier* (cola de URLs por visitar), un *fetcher*, un *parser* de enlaces, y módulos de deduplicación y *politeness*.[^1][^2]

**Políticas de traversal.** La política más estudiada es la *Breadth-First Search* (BFS). **Cho, Garcia-Molina y Page (1998, WWW '98)** demostraron que BFS descubre páginas de alta importancia (medida por PageRank) más rápido que estrategias alternativas, gracias a que las páginas muy enlazadas se encuentran antes porque múltiples predecesores las referencian. **Najork y Wiener (2001)** confirmaron este resultado sobre un corpus mucho más grande. La intuición formal es que el *grado de entrada* de un nodo en el grafo web correlaciona con su relevancia, y BFS alcanza primero los nodos de alto grado.[^3][^4][^5]

**Politeness y respeto al servidor.** Desde los primeros crawlers industriales (el WebCrawler original de 1994), se estableció la necesidad de respetar una tasa mínima de espera entre peticiones al mismo servidor. **Koster (1994)** formalizó el *Robots Exclusion Protocol* (REP) mediante el fichero `robots.txt`, que permite a los webmasters declarar qué rutas pueden o no ser exploradas por robots. RFC 9309 (IETF, 2022) elevó este protocolo de facto a estándar formal, añadiendo definición precisa del lenguaje, manejo de errores y semántica de caché. El estándar fue propuesto informalmente en julio de 1994 y permaneció como convención no oficial durante 28 años antes de su formalización.[^6][^7][^8][^9][^10][^11]

**Sitemaps XML.** Google introdujo en junio de 2005 el protocolo *Sitemaps 0.84*, que permite a los webmasters declarar explícitamente las URLs de su sitio junto con metadatos de cambio de frecuencia, prioridad relativa y fecha de última modificación. En noviembre de 2006, MSN y Yahoo se unieron al consorcio, elevando la especificación a *Sitemaps 0.90* como estándar de industria en `sitemaps.org`. El esquema XML (cuyo XSD fue fijado el 26-03-2008) limita cada fichero a 50.000 URLs y 50 MB. Es **consenso establecido** que la combinación `robots.txt` + `sitemaps.xml` constituye la interfaz de cortesía mínima para cualquier crawler.[^12][^13][^14][^15]

**Canonicalización de URLs y deduplicación.** Una misma representación puede ser accesible bajo múltiples URLs (parámetros de sesión, mayúsculas, trailing slashes, versiones HTTP/HTTPS). La canonicalización normaliza estas variantes a una URL canónica. La deduplicación a nivel de *contenido* es un problema separado y más difícil.

**Near-duplicate detection.** **Broder et al. (1997, SEQUENCES '97 / citado en AltaVista)** desarrollaron los fundamentos matemáticos del *resemblance* y la *containment* de documentos mediante *shingling* (conjuntos de k-gramas de palabras solapados) y el estimador *min-wise independent permutations* (MinHash) para aproximar la similitud de Jaccard entre dos documentos a escala web. El estimador es probabilístico pero computable en tiempo sublineal en el tamaño del documento.[^16][^17]

**Manber y Charikar (2002)** introdujeron el *SimHash*, una variante de *Locality Sensitive Hashing* (LSH) que mapea cada documento a un fingerprint de *b* bits tal que documentos similares difieren en pocos bits (distancia de Hamming pequeña). Google adoptó SimHash con fingerprints de 64 bits para deduplicación en su crawl de 8 mil millones de páginas, como documenta **Manku et al. (2007, WWW '07)**. **Henzinger (2006, SIGIR '06)** evaluó a gran escala (1.600 millones de páginas) los algoritmos de shingling de Broder y SimHash de Charikar, concluyendo que SimHash logra mayor precisión inter-sitio (0.50 vs. 0.38), y que un algoritmo combinado alcanza precisión 0.79 con el 79% del recall de los algoritmos individuales. Estas técnicas son **clásicas y plenamente vigentes**: SimHash sigue siendo el algoritmo de deduplicación dominante en motores de búsqueda comerciales a 2026.[^18][^19][^20][^21][^22]

### 1.2 Representación Documental para Indexación

La estructura de datos que subyace a toda recuperación de información eficiente desde los años 1970 es el **índice invertido**: para cada término del vocabulario, se mantiene una lista ordenada de *postings* (docIDs) donde el término aparece. **Manning, Raghavan y Schütze (2008)** —*Introduction to Information Retrieval*, Cambridge University Press— constituyen la referencia textbook de consenso para esta área. El índice de términos-documento explícito (una matriz 0/1 o con pesos) es conceptualmente equivalente pero computacionalmente inviable: dado un vocabulario de ~1 millón de términos y ~1 millón de documentos, la matriz tiene 10^12 entradas, de las cuales ~99.8% son cero. El índice invertido almacena únicamente las posiciones no nulas, reduciendo el espacio a algo proporcional al número total de ocurrencias de términos.[^23][^24][^25]

**Pesado de términos: TF-IDF y BM25.** El esquema TF-IDF (Term Frequency × Inverse Document Frequency) es el fundamento del ranking desde los años 1970. El modelo probabilístico de **Robertson et al.** culminó en Okapi BM25, cuya forma definitiva —incluyendo las correcciones de saturación de TF y normalización por longitud de documento— aparece en **Robertson y Walker (1994)** y es descrita exhaustivamente en el informe técnico de la serie TREC. BM25 es **clásico y plenamente vigente**: sigue siendo el baseline por defecto en todos los sistemas de IR y forma parte de motores como Elasticsearch, Solr y Lucene.[^26][^27]

**Embeddings densos vs. índice disperso.** El paradigma *Dense Passage Retrieval* (DPR), introducido por **Karpukhin et al. (2020, ACL 2020)** de Facebook Research, demostró que representaciones densas aprendidas mediante un *dual-encoder* fine-tuneado (basado en BERT) superan a BM25 en 9–19 puntos absolutos en top-20 passage recall en benchmarks de QA de dominio abierto. Sin embargo, los embeddings densos tienen debilidades en *exact term matching* y en generalización out-of-domain, y requieren infraestructura de *approximate nearest neighbor* (ANN) más costosa.[^28]

**Recuperación híbrida.** La convergencia práctica dominante en 2024–2026 es el modelo híbrido: **SPLADE** (Formal, Piwowarski, Clinchant, SIGIR 2021) introduce un retriever *neurally sparse* que aprende pesos de términos y expansión de vocabulario, produciendo representaciones compatibles con índices invertidos pero con semántica aprendida. Los sistemas de producción típicamente combinan BM25 + embeddings densos via *Reciprocal Rank Fusion* (RRF) o reranker cross-encoder, logrando mejoras del 30–40% sobre BM25 solo en benchmarks de producción.[^29][^30][^31][^32][^33]

**Estado del arte actual:** Los índices dispersos (BM25, SPLADE) son **clásicos y vigentes** para exact matching y consultas con terminología técnica. Los embeddings densos son la **frontera reciente** para búsqueda semántica. El modelo disperso puro como representación única de documentos es **clásico y parcialmente superado** para aplicaciones de recuperación semántica, aunque no para indexación web a escala.

### 1.3 La Web como Grafo: Topología y Link Analysis

**PageRank.** **Brin y Page (1998, WWW '98)** formalizaron PageRank como la distribución estacionaria de un paseo aleatorio sobre el grafo web, con un factor de teleportación \(\alpha\) (típicamente 0.85) que da robustez frente a dangling nodes y estructuras sink. PageRank puede interpretarse como la probabilidad de que un usuario aleatorio que sigue enlaces esté en una página dada. La variante con teleportation hace al ranking de páginas robusta frente a pequeños cambios en la topología, en contraste con HITS.[^34][^35]

**HITS (Hubs & Authorities).** **Kleinberg (1999, JACM 46:5)** introdujo HITS, que define dos scores mutuamente reforzantes: *authority* (una página es autoridad si es apuntada por hubs relevantes) y *hub* (una página es hub si apunta a autoridades relevantes). Las iteraciones convergen a los eigenvectores dominantes de \(A^T A\) (authorities) y \(AA^T\) (hubs), donde \(A\) es la matriz de adyacencia del grafo. HITS es más sensible al conjunto base de páginas consideradas y menos robusto a link farms que PageRank, como señalan **Ng et al. (2001)**.[^36][^37][^34]

**Topología bow-tie.** **Broder et al. (2000, Computer Networks 33)** analizaron dos crawls de AltaVista (~200 millones de páginas, 1.500 millones de links) y describieron la estructura macroscópica de la web como una *corbata de pajarito* (bow-tie): una Strongly Connected Component (SCC) central gigante (≈28% de páginas), un componente IN de páginas que apuntan hacia la SCC sin recibir links de vuelta, un componente OUT de páginas alcanzables desde la SCC pero sin links de regreso, y *tendrils* que cuelgan de IN u OUT. Esta estructura tiene consecuencias prácticas: el 25% de las páginas (OUT) no puede alcanzar el núcleo siguiendo links hacia adelante, lo que implica que un crawler BFS desde seeds aleatorios puede nunca descubrir partes importantes del grafo.[^38][^39][^40][^41]

**Revisión de la topología.** **Meusel et al. (2015, WWW '15)** re-examinaron la estructura usando Common Crawl y encontraron que la SCC había crecido hasta el 51.8% del grafo (vs. 27.7% en Broder et al.) y el grado medio aumentó de 7.5 a 36.8, reflejando la densificación de la web en 15 años. La topología bow-tie es **consenso clásico y vigente** como caracterización macroscópica, aunque los valores concretos de los componentes varían con la metodología de crawl.[^42][^38]

***

## 2. COMPOSICIÓN Y ESTRUCTURA DE PÁGINA Y SITIO

### 2.1 DOM: El Árbol del Documento

El **Document Object Model** (DOM) es la representación interna que el navegador construye a partir del HTML parseado, modelando el documento como un árbol de nodos en el que cada elemento, atributo y texto es un nodo con tipo, nombre y relaciones padre-hijo bien definidas. La especificación DOM Level 1 fue publicada por W3C en 1998, y desde entonces ha evolucionado hasta el Living Standard de WHATWG. El DOM es la interfaz de programación universal para acceder y modificar la estructura de una página web; todo scraper, crawler de JavaScript (Playwright, Puppeteer) y web agent opera sobre él.

**HTML semántico y sectioning elements.** Con HTML5 (W3C, borrador 2008, recomendación 2014), se introdujo un conjunto de elementos de seccionalización que expresan la *semántica estructural* del documento de forma legible por máquina: `<nav>`, `<article>`, `<section>`, `<aside>`, `<header>`, `<footer>`, `<main>`. Estos elementos permiten a crawlers, screen readers y agentes identificar qué parte del DOM contiene la navegación principal, el contenido editorial, el boilerplate de cabecera/pie, etc., sin análisis heurístico de clases CSS. La especificación W3C establece que cada uno de estos elementos genera un *landmark* implícito en el árbol de accesibilidad.[^43][^44][^45][^46]

### 2.2 Árbol de Accesibilidad y ARIA

El **accessibility tree** es una representación paralela al DOM que expone la semántica del documento a tecnologías asistivas (screen readers) y, crucialmente para el modelado máquina, a herramientas de automatización y agentes. Cada nodo del accessibility tree tiene: *role* (su función semántica), *name* (etiqueta descriptiva), *state* (expandido, seleccionado, etc.) y *properties* (relaciones ARIA). La especificación **WAI-ARIA 1.1** (W3C, 2017; actualmente WAI-ARIA 1.3, W3C 2026) define el vocabulario formal de roles y propiedades.[^47][^48]

**ARIA (Accessible Rich Internet Applications)** fue diseñado para que widgets JavaScript complejos (árboles, grids, menús, progress bars) puedan exponer su semántica a través del accessibility tree cuando los elementos HTML nativos no son suficientes. La "Primera Regla de ARIA" establece que si existe un elemento HTML nativo con la semántica requerida, debe usarse en lugar de ARIA; ARIA es un fallback para widgets sin equivalente nativo. Los surveys de WebAIM muestran que las páginas con ARIA mal usado tienen un 41% más de errores detectados que las que no lo usan.[^49][^50]

**Relevancia para agentes.** WebArena (Liu et al., 2023), el benchmark de facto para LLM web agents, modela la observación del agente como una terna: screenshot, HTML crudo, y **árbol de accesibilidad**. La representación más eficiente para los agentes resulta ser el accessibility tree, no el HTML completo, porque elimina el boilerplate visual y preserva sólo los nodos interactivos y semánticos con sus roles y nombres.[^51][^52]

### 2.3 Web Semántica: Datos Estructurados Embebidos

La pregunta "¿qué hace a una página legible por máquina?" tiene una respuesta formal en el stack de la **Web Semántica**, una agenda iniciada por **Berners-Lee et al. (2001, Scientific American)** y articulada técnicamente en el documento *Linked Data Design Issues* (Berners-Lee, W3C, 2006). Las cuatro reglas de Linked Data son: usar URIs como nombres para cosas; usar URIs HTTP; servir RDF al resolver la URI; incluir links a otras URIs.[^53]

Los principales formatos de serialización de datos estructurados embebidos en HTML son:

- **Microdata** (HTML5 Working Group, 2009): extiende HTML con atributos `itemscope`, `itemtype`, `itemprop`. Fue el primer formato soportado por Schema.org.[^54]
- **RDFa** (W3C Recommendation, 2008; RDFa Lite 1.1, 2012): serialización de triples RDF dentro de HTML, usando atributos `vocab`, `typeof`, `property`. Está más alineado con la comunidad Linked Data.[^55][^54]
- **JSON-LD** (W3C Recommendation, 2014): serialización de grafos RDF como JSON embebido en un tag `<script type="application/ld+json">`, propuesto por el W3C JSON-LD Community Group. Google lo recomienda oficialmente por su separación limpia del HTML de presentación.[^56][^57]

**Schema.org** es el vocabulario de referencia para todos estos formatos, fundado en 2011 por Google, Microsoft, Yahoo y Yandex. A 2024, más de **45 millones de dominios** marcan sus páginas con más de **450 mil millones de objetos** Schema.org. El WebDataCommons (Brinkmann et al., 2024) extrae anualmente el corpus de datos estructurados del Common Crawl; el release de octubre 2023 contiene **86 mil millones de quads RDF** de 3.35 mil millones de páginas HTML, con JSON-LD presente en 9.5 millones de sitios, Microdata en 7.4 millones y RDFa en 0.5 millones.[^58][^59][^60][^61]

**OpenGraph** (Facebook, 2010) y **Twitter Cards** (Twitter, 2012) son vocabularios más simples, basados en meta tags, orientados a controlar la previsualización de páginas en redes sociales. No son compatibles con RDF pero son ampliamente adoptados.

**Estado del arte:** La web semántica completa (OWL, SPARQL, razonamiento) es **clásica y no masivamente adoptada**. Schema.org con JSON-LD es **clásico-reciente y plenamente vigente**, con adopción en >50% de las páginas web. Los datos estructurados embebidos son la vía práctica más directa para que una máquina extraiga entidades y relaciones de una página sin análisis heurístico.[^60]

***

## 3. MODELADO FORMAL DE APLICACIONES WEB

### 3.1 El Modelo Dexter de Hipertexto

El **Dexter Hypertext Reference Model**, desarrollado en los *Workshops on Hypertext Standardization* organizados por Walker y Leggett (primer taller: Dexter Inn, New Hampshire, octubre 1988), formalizado en **Halasz y Schwartz (1990, NIST Hypertext Standardization Workshop; versión definitiva 1994, CACM 37)**, es el primer intento serio de capturar las abstracciones fundamentales de los sistemas hipertexto.[^62][^63][^64][^65]

Dexter define tres capas: la **capa de almacenamiento** (red de nodos y links con UIDs globales), la **capa de run-time** (interacción del usuario), y la **capa within-component** (estructura interna de un nodo). El modelo es lo suficientemente general para describir links entre links y componentes compuestos (composite components que contienen recursivamente otros componentes). El mecanismo de *anchoring* separa el identificador de un punto de acceso (anchor ID, estable) de su posición en el contenido (anchor value, variable). Dexter es **clásico y fundacional**: toda la terminología posterior de hipertexto —nodos, anchors, links, traversal— deriva de este modelo.

### 3.2 OOHDM

El **Object-Oriented Hypermedia Design Model (OOHDM)**, desarrollado por **Schwabe y Rossi (1995, CACM 38:8; Hypertext '96; refinado en 1998)** en la PUC-Rio, propone diseñar aplicaciones hipermedia en cuatro etapas: diseño conceptual (modelo de dominio OO), diseño navegacional (vistas navegacionales como clases navegacionales y contextos navegacionales), diseño de interfaz abstracta (objetos de interfaz independientes de tecnología), e implementación. La innovación clave es que los *nodos navegacionales son vistas (en sentido de BD) sobre los objetos del dominio*, y el *espacio navegacional se especifica separado del modelo del dominio*, permitiendo múltiples vistas del mismo contenido para distintos perfiles de usuario. OOHDM es **clásico y fundacional** para metodologías de web engineering; su separación conceptual/navegacional/presentación influenció todos los métodos posteriores.[^66][^67][^68]

### 3.3 WebML

**WebML (Web Modeling Language)**, introducido por **Ceri, Fraternali y Bongio (2000, Computer Networks 33:1-6)** del Politecnico di Milano, proporciona una notación gráfica y textual (XML) para especificar sitios web complejos bajo cinco modelos ortogonales:[^69][^70][^71]

1. **Structural model**: contenido de datos (entidades, relaciones, similar a E/R).
2. **Composition model**: páginas como contenedores de unidades de contenido (*WebML units*).
3. **Navigation model**: topología de links entre páginas y unidades.
4. **Presentation model**: requisitos de layout y rendering.
5. **Personalization model**: entrega de contenido one-to-one.

Las especificaciones WebML son independientes del lenguaje cliente y de la plataforma servidor. Una semántica formal de WebML se definió después mediante **Statecharts** para capturar el comportamiento de navegación y los *data fills* de páginas. WebML es **clásico**: su herramienta CASE (ToriiSoft) nunca alcanzó adopción masiva, pero el enfoque model-driven fue precursor de los frameworks MDA.[^70]

### 3.4 UWE

**UWE (UML-based Web Engineering)**, desarrollado por **Koch y Kraus (2002, 2003; descripción completa en Koch et al., 2008)** en LMU Munich, define un metamodelo conservativamente extensible del metamodelo UML, añadiendo cuatro modelos específicos para web: requirements model, content model, navigation model y presentation model. UWE utiliza *stereotypes* UML estándar para representar conceptos web, lo que permite usar herramientas UML comerciales (como ArgoUWE). Es **clásico y académicamente relevante**; su contribución principal fue integrar métodos web con el ecosistema UML/MDA.[^72][^73][^74][^75]

### 3.5 Hera

**Hera**, presentado por **Frasincar, Houben y Barna (WWW 2002; extendido en 2003)**, es una metodología basada en RDF y XSLT que separa la descripción conceptual semántica de los datos (en RDF/OWL), los aspectos de navegación hipermedia, y el rendering de presentación. Hera es notable porque fue la primera metodología de web engineering que usa tecnologías de la web semántica (RDF, XML, XSLT) como base de implementación, conectando formalmente el modelado de aplicaciones web con la agenda de la web semántica.[^76][^77]

### 3.6 Statecharts para Navegación Hipermedia

El formalismo de **Statecharts** de **Harel (1987, Science of Computer Programming 8:3)** —extensión de las máquinas de estados finitos con jerarquía, concurrencia y comunicación broadcast— ha sido aplicado directamente al modelado de la navegación web. **Laufer et al. (1997, ACM Hypertext '97)** propusieron el **HMBS (Hypertext Model Based on Statecharts)**, que usa la estructura y semántica de ejecución de los statecharts para especificar tanto la organización estructural como la semántica de browsing de un hiperdocumento. Un statechart de navegación modela las páginas como estados, los clicks como eventos, y el comportamiento del back-button como memoria de historia, capturando la concurrencia de pestañas como estados ortogonales.[^78][^79][^80][^81]

Esta línea —aplicación a crawling y testing de aplicaciones web— se desarrolló extensivamente en la investigación de *model-based testing*: los modelos de aplicaciones web se representan como **State Flow Graphs (SFGs)**, donde los estados son snapshots del DOM y las transiciones son eventos de usuario, y la similitud entre estados se mide con *tree edit distance* sobre el DOM.[^82]

### 3.7 Information Architecture

**Rosenfeld y Morville** (1998, O'Reilly, *Information Architecture for the World Wide Web*) sistematizaron la disciplina de IA para la web, definiendo los cuatro sistemas fundamentales de un sitio: **organización** (taxonomías jerárquicas, facetadas, matriciales), **navegación** (mecanismos de browsing y orientación), **búsqueda** (indexación local), y **etiquetado** (elección de términos). La IA centra el diseño en el modelo mental del usuario, no en la tecnología subyacente. Sus contribuciones son **clásicas y vigentes**: la terminología de jerarquías, taxonomías y navegación facetada sigue siendo la base del diseño de la IA en cualquier sitio o aplicación.[^83]

***

## 4. REPRESENTACIÓN COMPACTA DE ESTRUCTURA

### 4.1 State Abstraction y Fingerprinting Estructural

La gestión del espacio de estados de una aplicación web requiere abstraer estados que, siendo funcionalmente equivalentes, difieren en detalles irrelevantes (timestamps, contadores, anuncios). Los enfoques clásicos para la abstracción de estados aplican heurísticas sobre el DOM:

1. **DOM tree edit distance**: La distancia de edición de árboles entre dos DOMs \(t_1\) y \(t_2\) se define como el mínimo número de operaciones atómicas (insertar, borrar, re-etiquetar un nodo) que transforma \(t_1\) en \(t_2\). **Zhang y Shasha (1989, JACM)** demostraron un algoritmo \(O(n^2)\) para árboles ordenados etiquetados. La diversidad normalizada \(DD(s_i, s_j) = TED(t_i, t_j) / \max(|t_i|, |t_j|)\) es usada para discriminar estados en crawlers de aplicaciones web [^82].

2. **Structural hashing**: un hash del esqueleto del DOM (ignorando contenido textual y atributos de valor variable) produce un fingerprint estructural. Dos páginas con el mismo fingerprint son candidatas a ser la misma plantilla instanciada con diferentes datos. Esta técnica es central en el **wrapper induction** (ver §4.2) y en sistemas de crawling de aplicaciones JavaScript modernas.

3. **SimHash del contenido**: el mismo SimHash de 64 bits usado para near-duplicate detection a nivel de contenido sirve también como fingerprint para detectar que una URL genera una página sustancialmente igual a una ya crawleada.[^84][^85][^18]

### 4.2 Wrapper Induction y Extracción de Estructuras Repetidas

El **wrapper induction**, introducido por **Kushmerick, Weld y Doorenbos (IJCAI 1997)** como la primera técnica formal para aprendizaje automático de wrappers de extracción, define *clases de wrappers* que se pueden aprender inductivamente a partir de ejemplos etiquetados. La clase `hlrt` (head-left, right-tail), definida formalmente en el paper, puede ser aprendida eficientemente y cubre el 48% de los recursos web de la muestra original; las clases más expresivas del paper cubren en total el 70% de los sitios encuestados.[^86][^87][^88][^89]

La idea fundamental del wrapper induction es que las páginas HTML generadas por templates exhiben **estructura repetida**: los items de un catálogo, los resultados de una búsqueda, las entradas de un blog comparten el mismo árbol DOM local modulo el contenido. Inferir esa plantilla (el *wrapper*) es equivalente a inferir el modelo de generación de la página. **Kushmerick (2000, Artificial Intelligence)** extendió el trabajo a 1997 con el sistema WIEN, añadiendo análisis de complejidad PAC.[^86]

**DEPTA (2006)** de **Zhai y Liu (IEEE TKDE 2006)** extendió el wrapper induction a la extracción basada en *partial trees*, manejando fuentes de datos con múltiples regiones de datos no contiguas dentro del mismo árbol DOM. La extracción de estructuras repetidas del DOM es **clásica y plenamente vigente**: es la base de herramientas como Scrapy, Playwright-based scrapers, y extractores modernos como Playwright + LLM.[^90]

### 4.3 Compresión del Modelo de Sitio

La compresión de la topología de un sitio a un grafo mínimamente navegable requiere tres operaciones:

1. **Colapso de páginas isomórficas**: páginas que son instancias del mismo template (mismo fingerprint estructural del DOM pero distinto contenido) se colapsan a un único nodo en el site model, con una arista que representa "navegar a una instancia de la lista de productos".

2. **Eliminación de estados absorbentes triviales**: estados del DOM que son self-loops (el DOM no cambia tras el evento) o state-independent events se eliden del SFG según el criterio de *event productivity*.[^82]

3. **Representación como grafo de URL con semántica**: la topología de navegación del sitio se representa como un grafo dirigido donde los nodos son clases de páginas (no páginas individuales) y las aristas son tipos de transición (link navigation, form submission, AJAX call). Esta es la representación que usan los crawler-based site model inference tools para *model-based testing*.

***

## 5. SÍNTESIS APLICADA: REPRESENTACIONES MÍNIMAS Y NAVEGABLES

### 5.1 Las Formas Mínimas Conocidas de Representar un Sitio

Después de treinta años de investigación, hay convergencia sobre qué capas debe tener una representación mínima y navegable de un sitio para un agente máquina:

**Capa 1 — URL Graph (topología pura).** Un grafo dirigido de URLs o URL-patrones, donde los arcos son links o acciones navegacionales. Es el modelo más compacto: sólo topología, sin semántica. Suficiente para crawling y análisis de PageRank. Su limitación es que no distingue el tipo ni el propósito de los nodos.

**Capa 2 — Structural DOM sketch por nodo.** Para cada clase de página (template), un esqueleto estructural del DOM (con roles ARIA, elementos semánticos HTML5, XPath de anclajes de datos) que permita al agente saber qué acciones son posibles desde esa clase. Esta representación, que **WebChallenger (2026)** denomina **PageMem**, se construye determinísticamente desde el DOM y expone cada página como una jerarquía de secciones semánticas con resúmenes cortos.[^91][^92][^93]

**Capa 3 — Schema.org / JSON-LD como semántica declarativa.** Los datos estructurados embebidos en las páginas proveen la semántica de entidades (Product, Article, Organization, Event, etc.) sin análisis heurístico. Un agente que extrae los grafos JSON-LD de las páginas obtiene una representación semántica explícita y fuertemente tipada del contenido.

**Capa 4 — Site-level memory (mapa de páginas y comportamientos).** WebChallenger demuestra empíricamente que un agente que realiza una única exploración ligera del sitio para construir un **mapa de páginas y comportamientos de elementos reutilizable** alcanza un 56.3% en WebArena, 48.7% en VisualWebArena y 70.9% en WorkArena usando modelos open-weight sin fine-tuning, aproximándose a sistemas propietarios de mayor costo. La estructura de memoria explícita de navegación de sitio es el estado del arte a junio 2026.[^92][^91]

### 5.2 Técnicas Clásicas Vigentes vs. Superadas

**Clásicas y plenamente vigentes:**
- Robots.txt (RFC 9309) + Sitemaps XML como protocolo de crawling cortés: no hay alternativa.
- BFS como política de crawl para descubrimiento de páginas de alta importancia.
- Índice invertido + BM25 como baseline de IR.
- SimHash (64 bits) para near-duplicate detection a escala web.
- PageRank para ranking de páginas en el grafo.
- Wrapper induction / inferencia de templates DOM para extracción estructurada.
- Schema.org / JSON-LD para semántica de entidades.
- Accessibility tree (WAI-ARIA) como representación semántica del DOM para agentes.

**Clásicas y parcialmente superadas:**
- HITS: superado por PageRank en robustez (más sensible a link farms, menos estable); todavía usado en análisis de grafos especializados.
- Microdata y RDFa: no superados técnicamente, pero JSON-LD es hoy el formato preferido por Google y la mayoría de herramientas.
- WebML, OOHDM, UWE: herramientas y procesos formales de diseño no adoptados industrialmente, pero los *conceptos* (separación conceptual/navegacional/presentación) siguen siendo relevantes.
- TF-IDF puro: superado por BM25 y por recuperación híbrida densa+dispersa.

**Recientes y en frontera activa:**
- Dense embeddings (DPR, ColBERT) + ANN para recuperación semántica.
- Recuperación híbrida (BM25 + embeddings + reranker) como arquitectura dominante en RAG.
- PageMem / site-memory estructurado para LLM web agents.
- Accessibility tree como representación de input para agentes (2023–2026).

***

## 6. TABLA DE TÉCNICAS REUTILIZABLES

| Técnica | Qué resuelve | Coste / Peso | Madurez |
|---|---|---|---|
| **robots.txt (RFC 9309)** | Política de acceso de crawlers; politeness | Negligible: fichero de texto <10KB | Estándar IETF (2022); adopción universal |
| **sitemaps.xml** | Descubrimiento explícito de URLs; prioridad relativa | XML, max 50K URLs / 50MB por fichero | Estándar de industria (sitemaps.org, 2006) |
| **BFS frontier** | Política de crawling que prioriza páginas de alto grado | O(V+E) memoria en la frontera | Consenso (Cho et al. 1998; Olston & Najork 2010) |
| **SimHash (64 bits)** | Near-duplicate detection de documentos a escala web | 8 bytes por documento; O(n) generación | Producción (Google, 2007); vigente a 2026 |
| **MinHash / Shingles** | Estimación de similitud Jaccard entre documentos | Configurable (k firmas); mayor recall | Clásico (Broder 1997); base de LSH moderno |
| **Inverted index + BM25** | Recuperación eficiente por término; ranking probabilístico | Configurable; Elasticsearch/Lucene | Baseline universal; clásico y vigente |
| **SPLADE (learned sparse)** | Expansión semántica de vocabulario + índice invertido | Inference overhead vs. BM25; índice compatible | Frontera (Formal et al. SIGIR 2021) |
| **Dense embeddings (DPR/ColBERT)** | Recuperación semántica zero-shot; cross-lingual | ANN index (~100ms/query); >VRAM | Frontera (Karpukhin et al. 2020) |
| **PageRank** | Ranking de páginas por importancia en el link graph | O(kE) por k iteraciones de power method | Clásico (Brin & Page 1998); vigente en crawlers |
| **DOM Accessibility Tree (WAI-ARIA)** | Representación semántica del DOM para agentes | Subset del DOM; ~10–100x más compacto que HTML raw | Estándar W3C (WAI-ARIA 1.3, 2026); usado en WebArena |
| **Schema.org / JSON-LD** | Entidades y relaciones declarativas en página | Script tag <2KB; overhead mínimo | Estándar de industria; 50%+ webs (2023) |
| **Wrapper induction (WIEN/DEPTA)** | Inferencia automática de plantillas DOM; extracción estructurada | Requiere 5–20 ejemplos de entrenamiento | Clásico (Kushmerick 1997); base de scrapers modernos |
| **Tree edit distance sobre DOM** | Comparación estructural de estados web; deduplicación de estados | O(n²) en número de nodos DOM | Clásico (Zhang & Shasha 1989); vigente en testing |
| **Structural DOM hashing (PageMem)** | Representación compacta de template de página para agentes | Determinístico desde el DOM; reutilizable | Reciente frontera (WebChallenger 2026) |
| **Statecharts / SFG web** | Modelado formal de la navegación como máquina de estados | Proporcional al espacio de estados del sitio | Clásico (Harel 1987; HMBS 1997); vigente en testing |
| **Bow-tie topology analysis** | Diagnóstico de crawlabilidad del sitio; análisis de componentes | Requiere crawl completo; O(V+E) | Clásico (Broder et al. 2000); herramienta de análisis |
| **Site-level memory map** | Mapa persistente de páginas y comportamientos para agentes LLM | Un único recorrido exploratorio del sitio | Frontera activa (WebChallenger, 2026) |

***

## Referencias Primarias por Eje

**Crawling:** Cho et al. (1998, WWW '98) · Najork & Wiener (2001) · Koster (1994, Robots.txt) · RFC 9309 (IETF, 2022) · Olston & Najork (2010, *Foundations and Trends in IR* 4:3)

**Near-duplicate:** Broder et al. (1997, SEQUENCES) · Charikar (2002, STOC, *Similarity Estimation Techniques from Rounding Algorithms*) · Manku et al. (2007, WWW '07) · Henzinger (2006, SIGIR '06)

**Web Graph:** Brin & Page (1998, WWW '98) · Kleinberg (1999, *JACM* 46:5) · Broder et al. (2000, *Computer Networks* 33) · Meusel et al. (2015, WWW '15)

**IR/Indexación:** Manning, Raghavan & Schütze (2008, *Introduction to Information Retrieval*, Cambridge UP) · Robertson & Walker (1994, TREC-3) · Karpukhin et al. (2020, ACL) · Formal, Piwowarski & Clinchant (2021, SIGIR)

**Modelado:** Halasz & Schwartz (1990/1994, NIST/CACM) · Schwabe & Rossi (1995, CACM 38:8) · Ceri, Fraternali & Bongio (2000, *Computer Networks* 33:1-6) · Koch & Kraus (2002/2003/2008, LMU Munich) · Frasincar et al. (2002/2003, WWW) · Harel (1987, *Science of Computer Programming* 8:3) · Laufer et al. (1997, ACM Hypertext '97)

**Web Semántica:** Berners-Lee (2006, W3C Design Issues) · W3C JSON-LD 1.1 (2020) · Schema.org · WebDataCommons (Brinkmann et al., 2024) · WAI-ARIA 1.3 (W3C, 2026)

**Extracción:** Kushmerick, Weld & Doorenbos (1997, IJCAI) · Kushmerick (2000, *Artificial Intelligence*) · Zhai & Liu (2006, IEEE TKDE)

**Agentes modernos:** Liu et al. (2023, WebArena) · WebChallenger (2026, arXiv:2606.10423)

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

