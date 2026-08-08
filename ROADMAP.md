# Hoja de ruta

Lista de trabajo de objetivos para el comando `stxt`. Es una ruta, no un contrato: los ítems se
mueven, se dividen y se descartan. La mayoría de las ideas en bruto detrás de esto vienen de las
notas de CLI en `../stxt-cms/TODO.txt`; lo que está escrito aquí es la versión filtrada, con el
razonamiento conservado.

Leyenda: **[done]** entregado · **[next]** en desarrollo · **[planned]** acordado, sin empezar ·
**[decided]** una decisión asentada, conservada aquí por su razón · **[open]** deseado, pero
falta una decisión · **[blocked]** necesita trabajo fuera de este repositorio.

---

## 0.1.0 — Esqueleto

- **[done]** Proyecto TypeScript / CommonJS que refleja `stxt-js` (mismo `tsconfig`, eslint,
  mocha).
- **[done]** Ejecutable `stxt`, `@stxt-lang/core` como única dependencia en tiempo de ejecución.
- **[done]** `--version`, reportando la versión de la CLI *y* la versión del parser.
- **[done]** `--help`, convención de códigos de salida (`0` ok / `1` documentos fallaron / `2`
  uso incorrecto).
- **[done]** Licencia MIT, README, esta hoja de ruta.
- **[done]** Primera publicación en npm como `@stxt-lang/cli`. Publicado deliberadamente mientras
  aún es un esqueleto: hace real y reservado el nombre del comando bajo el scope `@stxt-lang`, y
  ejercita toda la ruta de publicación una vez, en una versión donde nada puede romperse.
  Decidido junto con esto: sin campo `main` — este paquete es un `bin` e importarlo ejecutaría el
  comando — y `prepublishOnly: npm test`, de modo que nada llega al registro sin compilar, pasar
  el lint y pasar los tests.

## 0.2.0 — Rutas de esquema e instalación

- **[decided]** Modelo de ruta de búsqueda: `./.stxt` (proyecto) → `~/.stxt` (usuario) →
  `/etc/stxt` (sistema), con `STXT_PATH` como override que reemplaza toda la cadena. Resultó no
  necesitar una decisión separada: STXT-DISCOVERY-SPEC (`../stxt-web/es/stxt-discovery-ref.stxt`),
  escrita para el trabajo preparatorio de `check` en 0.3.0, ya fija estas mismas rutas, y
  `NodeDiscoveryEnvironment` (`src/discovery/NodeDiscovery.ts`) ya las resuelve. `install`
  reutiliza esa clase en vez de codificar las rutas por segunda vez, así que no puede divergir de
  lo que `check` y el editor resuelven.
- **[done]** `stxt install <file>` con `--local` (por defecto) / `--user` / `--system` /
  `--root <dir>`, copiando un fichero de esquema o template **local** al directorio
  correspondiente. Rutas fijas para los tres scopes con nombre; `--root` para cualquier otra
  cosa, sin mezcla mágica. Implementado en [src/command/Install.ts](src/command/Install.ts).
  También incluye `--force`: el destino nunca se sobrescribe silenciosamente (la regla de "nada
  de valores por defecto destructivos" de AGENTS.md), así que un fichero preexistente en el
  destino necesita ese flag.

  > **Nota**: se consideraron y se **descartaron** las URLs remotas (`stxt install <url>`) para
  > esta versión por motivos de seguridad (descargas arbitrarias, MITM, validación de
  > contenido). Si hace falta, descarga el fichero manualmente e insálalo como ruta local. Un
  > futuro registro oficial de esquemas podría revisar esto.
- **[fixed]** `install` se lanzó siendo **solo una copia**: aceptaba cualquier fichero, sin mirar
  la extensión, ni si parseaba, ni si su nodo raíz era una definición, y lo dejaba en el destino
  con su propio nombre. Es decir, dejaba romper el nivel entero sin decir nada — un `.txt`
  instalado hace que `schemas` salga con 1 y que `check` reporte `DISCOVERY_NOT_A_DEFINITION` en
  todos los documentos del proyecto. Revisado a fondo: copiar un fichero ya sabe hacerlo
  cualquiera a mano; la gracia de `install` es que **haga cosas**.
- **[decided]** `install` valida antes de escribir, y es todo o nada: el fichero debe existir,
  tener extensión `.stxt`, parsear, y **cada** nodo raíz debe ser una definición
  (`@stxt.schema`/`@stxt.template`) que valide **contra su meta-esquema** — la misma comprobación
  que hace `DiscoveryResolver` al cargar un nivel (`SchemaValidator` sobre
  `UnifiedSchemaProvider`, que sirve los dos meta-esquemas), de modo que `install` no puede
  escribir algo que el discovery vaya a rechazar después. Con un solo problema no se escribe
  nada: nada de ficheros a medias de válidos.
- **[decided]** Nomenclatura de destino: `<nivel>/@stxt.schema/<namespace>.stxt` y
  `<nivel>/@stxt.template/<namespace>.stxt`, donde `<namespace>` es el namespace **objetivo** de
  la definición, no el nombre del fichero de origen. STXT-DISCOVERY-SPEC §3 no da ningún
  significado ni a los nombres de fichero ni a los subdirectorios, así que esto es **convención
  de esta CLI**, no regla del lenguaje: el usuario sigue pudiendo colocar ficheros a mano como
  quiera. A cambio, un nivel se lee de un vistazo y un choque de namespace se convierte en un
  choque de ruta. El namespace se vuelve a validar contra `^@?[a-z0-9]+(\.[a-z0-9]+)+$`
  (STXT-SPEC §7.1) antes de usarlo en una ruta, ya que viene del documento parseado.
- **[decided]** El fichero instalado se escribe en **forma canónica** (`NodeWriter`, la misma
  salida que `format --clean`), no copiado byte a byte: lo instalado es un artefacto normalizado,
  y el fuente conserva sus comentarios. Como consecuencia natural, un fichero con **varias**
  definiciones se **parte**: una definición por fichero, que es justo lo que la nomenclatura
  `<namespace>.stxt` supone (y un fichero que mezclara un schema y un template ni siquiera podría
  elegir subdirectorio).
- **[decided]** Un nodo raíz que no es ni schema ni template hace fallar todo el fichero, salvo
  con `--ignore-non-definitions`, que instala las definiciones y se salta el resto. Sigue siendo
  un error si el fichero no acaba aportando ninguna definición.
- **[decided]** `--force` pasa a cubrir también los choques de **namespace**, no solo los de
  ruta: si otro fichero de ese mismo nivel ya define el namespace, instalar encima dejaría el
  namespace **sin definición activa** (STXT-DISCOVERY-SPEC §8), así que se rechaza salvo que se
  pida explícitamente.
- **[done]** `stxt schemas [path]` — lista los namespaces actualmente descubiertos para un
  documento en `<path>`, o para el directorio actual si no se da ninguna ruta. La forma más
  rápida de responder "¿por qué no se valida mi documento?". Implementado en
  [src/command/Schemas.ts](src/command/Schemas.ts): imprime la cadena de resolución, la
  definición activa por namespace (gana el nivel más cercano) y cualquier `DiscoveryError`
  encontrado al cargar la cadena. Sale con `FAILURE` cuando hay tales errores — un fichero de
  esquema roto en la cadena es un problema real, aunque `schemas` en sí no valide ningún
  documento. Que este comando necesite esperar a `DiscoveryResolver.resolve()` es lo que hizo
  asíncrono a `run()` (`src/runtime/Cli.ts`); cada comando despachado desde ahí puede ahora
  devolver un `Promise<ExitCode>`, algo que `check` también necesitará.

## 0.3.0 — Comprobación de documentos

El comando que justifica todo el proyecto: el que llama un pipeline de CI.

- **[decided]** El comando se llama `check`, no `validate`. Cubre errores de parseo, errores de
  esquema y, más adelante, lint: un solo verbo para "dime si esto está bien". `validate` se lee
  como solo-esquema y dejaría los errores de sintaxis sin un comando propio.
- **[done]** `stxt check <file|dir>...` — parsea cada documento y lo valida contra los esquemas
  encontrados, reportando cada error en vez de detenerse en el primero (`Parser.parseResult`).
  Implementado en [src/command/Check.ts](src/command/Check.ts).
- **[done]** Discovery de esquemas. Ahora está **especificado** — STXT-DISCOVERY-SPEC,
  `../stxt-web/es/stxt-discovery-ref.stxt` (2026-08-02), que reemplazó la vieja regla informal
  ("parar en el primer `.stxt/`", copiada de la extensión) por la cadena completa: *cada*
  ancestro `.stxt/` desde el directorio del documento (el más cercano primero), luego
  `$HOME/.stxt`, luego `/etc/stxt` (`%USERPROFILE%\.stxt` / `%ProgramData%\stxt` en Windows),
  `STXT_PATH` reemplazando toda la cadena, precedencia **por namespace** (gana el nivel más
  cercano), duplicados del mismo nivel como errores. La implementación de referencia es
  `DiscoveryResolver` en `@stxt-lang/core` 0.6.0 (`../stxt-js/src/discovery/`), agnóstica de host
  sobre interfaces inyectadas; este repositorio contribuye solo los adaptadores de Node, en
  [src/discovery/NodeDiscovery.ts](src/discovery/NodeDiscovery.ts) (`createDiscoveryResolver()`
  es lo que `check` debe llamar). El editor consume el mismo resolver, así que CLI y editor ya no
  pueden discrepar por construcción.
- **[decided]** Con varias rutas en una línea de comandos: la resolución es **por documento**
  (STXT-DISCOVERY-SPEC sección 7). `DiscoveryResolver` cachea los niveles cargados, así que
  resolver muchos documentos que comparten un proyecto carga cada `.stxt/` una sola vez;
  compartir más allá de eso no debe cambiar el resultado de ningún documento. Un resolver por
  invocación, un `resolve()` por documento.
- **[decided]** Contrato de código de salida para errores de esquema: **un error de esquema
  (validación) hace fallar el build por defecto**, exactamente igual que un error de sintaxis —
  `check` está pensado para CI, y un documento que viola su propio esquema declarado no es un
  documento que pase. Dos opt-outs explícitos, ya que un sí/no plano resultó no ser suficiente:
  - `--warn-schema`: los errores de esquema se siguen parseando, resolviendo y reportando, pero
    no afectan al código de salida (solo lo hacen los errores de sintaxis). Esta es la misma
    separación de severidad del propio editor (`ParseException` como error,
    `ValidationException` como warning), ofrecida como opt-in en vez de como valor por defecto de
    la CLI.
  - `--no-schema`: se salta el discovery y la validación de esquemas por completo —ni siquiera
    se hace ninguna llamada a `DiscoveryResolver`—, comprobando solo la gramática base del
    lenguaje. Para un documento (o todo un codebase) que no tiene ningún interés en la capa de
    esquemas.
  Los dos son mutuamente excluyentes (un error de uso en caso contrario); ninguno es una
  repetición del otro, que es por lo que existen ambos en vez de un solo booleano.
- **[done]** No reportar `SCHEMA_NOT_FOUND` cuando no se cargó ningún esquema en absoluto. Los
  esquemas son una capa opcional (STXT-SPEC §15, §17.2), así que un documento con un namespace y
  sin esquemas en ningún sitio no está mal, simplemente no es validable — la misma regla que
  aplica la extensión de VSCode (`AnalysisDoc.ts`, `hasSchemas`), comprobada por documento (un
  namespace sin esquema coincidente cuando al menos un esquema *sí* está cargado en algún punto
  de la cadena sigue reportando `SCHEMA_NOT_FOUND` — solo una cadena con cero definiciones activas
  en absoluto lo suprime).
- **[done]** Los documentos cuyo namespace es `@stxt.schema` o `@stxt.template` también se
  comprueban como esquemas, pasándolos por `transformNodeToSchema` /
  `transformTemplateNodeToSchema` y capturando la `ValidationException` lanzada (una subclase de
  `ParseException`). De lo contrario `check` daría por bueno un esquema roto solo porque no tiene
  esquema propio contra el que validarse. Implementado en `checkAsDefinition()`
  ([src/command/Check.ts](src/command/Check.ts)), ejecutado por nodo raíz después del pase normal
  de parseo/validación. Gobernado por el mismo `SchemaMode` que todo lo demás en la capa de
  esquemas: omitido por completo por `--no-schema`, rebajado a warning por `--warn-schema`.
- **[done]** Reportar los `DiscoveryError` encontrados al cargar la cadena de resolución de un
  documento (ficheros de esquema rotos, namespaces duplicados) como parte de la propia salida de
  `check`, tal como ya hace `schemas`. Cada uno se convierte en un `Finding` que nombra el
  *fichero de la propia definición causante* (no el documento que se está comprobando) en la
  línea `0`, ya que un error de resolución no está ligado a una línea del documento; mismo
  tratamiento de `SchemaMode` que arriba. No se deduplica entre varios documentos que comparten
  el mismo fichero roto en su cadena (p. ej. una ejecución con `--recursive`): cada documento
  reporta los errores de su propia cadena, que es la regla más simple y coincide con "un
  `resolve()` por documento" de arriba — revisar si la repetición resulta ser ruidosa en la
  práctica.
- **[done]** `--recursive`, con el alias `-r` — uno de los tres alias cortos casi universales
  permitidos en cuanto se relajó la regla de "una sola grafia por opción" de AGENTS.md para
  permitirlos (`-v`, `-h`, `-r`; ver el ítem transversal más abajo). Un directorio dado sin
  `--recursive`/`-r` es un error de uso que nombra el flag, en vez de comprobar nada silenciosamente
  o solo su nivel superior. La recursión se salta los directorios `.stxt/`: son la propia cadena
  de resolución (definiciones de esquema/template), no documentos que comprobar, y todo proyecto
  real tiene uno.
- **[done]** Diagnósticos legibles por humanos con fichero, línea y código de error (`--format
  text`, por defecto: `file:line: [CODE] message (error|warning)`, más una línea de resumen);
  `--format json` para máquinas (un único array JSON de `{file, line, code, message, severity}`,
  siempre impreso incluso cuando está vacío).
- **[open]** `--format github` (anotaciones de GitHub Actions). Barato de añadir, solo vale la
  pena si los workflows realmente llegan a escribirse.

## 0.4.0 — Formateo

- **[done]** `stxt format <file|dir>... [--recursive] [--tabs|--spaces-4] [--write|--check]`
  ([src/command/Format.ts](src/command/Format.ts)). Reutiliza
  `collectStxtFiles` ([src/runtime/StxtFiles.ts](src/runtime/StxtFiles.ts)), extraído del propio
  código de recorrido de directorios de `check` en cuanto `format` necesitó exactamente la misma
  lógica de "descender, saltar `.stxt/`, listar `*.stxt`" — el primer caso donde compartir ese
  código entre comandos realmente valía la pena, ya que aquí es un algoritmo idéntico byte a
  byte, no solo parecido.
- **[decided]** Sin valor por defecto destructivo (AGENTS.md): sin flag, `format` solo
  **imprime** el texto reformateado por stdout y no toca nada en disco — esto revierte lo que la
  nota original de ROADMAP para esta versión decía ("reescribir el fichero in situ" por
  defecto), que resultó entrar en conflicto con esa regla en el momento de implementarlo.
  `--write`/`-w` es el flag explícito que reescribe un fichero in situ (solo cuando realmente
  cambiaría; silencioso en caso contrario). `--check` (sin grafia `--dry-run` — una sola grafia
  por opción, como en todos los demás sitios) es el punto medio adecuado para CI: no escribe
  nada, reporta qué ficheros cambiarían (`<file>: would be reformatted`) y hace fallar el build si
  alguno lo haría, la misma idea que `gofmt -l`/`prettier --check`. `--write` y `--check` son
  mutuamente excluyentes.
- **[done]** `--tabs` (por defecto) / `--spaces-4` para elegir el estilo de indentación,
  mutuamente excluyentes.
- **[decided]** Un documento con un error de sintaxis nunca se reformatea, en ningún modo (su
  árbol de parseo puede estar incompleto) — se reporta de la misma forma que `check` reporta un
  error de sintaxis, y siempre hace fallar el build. `format` no mira los esquemas en absoluto: no
  tiene `SchemaMode`, ni `--warn-schema`/`--no-schema`, ya que reserializar un árbol no tiene nada
  que ver con si valida contra uno.
- **[fixed en 0.4.1]** `format` se lanzó reserializando con `NodeWriter`, y eso **destruía los
  comentarios** (y las líneas en blanco): el árbol de parseo no los contiene, así que
  reserializarlo no puede devolverlos. Formatear no puede borrar lo que el autor escribió — es
  justo el valor por defecto destructivo que AGENTS.md prohíbe, solo que escondido. Corregido
  reescribiendo el documento **línea a línea**: las líneas que abren un nodo se re-renderizan en
  su forma canónica, y toda línea que el árbol no describe (comentarios, blancos, contenido de un
  bloque de texto) se conserva, quitándole solo los espacios finales. Es la misma estrategia del
  `FormattingProvider` de `../stxt-vscode` — que nunca tuvo el problema, precisamente por
  formatear con `TextEdit` por línea —, de modo que editor y línea de comandos coinciden por
  construcción. Implementado con un `Observer` propio (`SourceLines` en `Format.ts`) que apunta
  qué línea abrió qué nodo y qué línea es texto de qué bloque, igual que el
  `TokenGeneratorObserver` de la extensión.
- **[decided]** El namespace se escribe solo donde el fuente lo escribió: un hijo que repite el
  namespace de su padre es redundante pero legal, y quitarlo sería una edición, no un formateo.
  (`NodeWriter`, y por tanto `--clean`, sí lo quita.)
- **[decided]** La indentación de los comentarios se conserva tal cual, sin reindentar. Un
  comentario no pertenece a ningún nodo del árbol, así que no hay a qué nivel reindentarlo sin
  inventárselo; con `--spaces-4` esto puede dejar comentarios indentados con tabuladores, y es el
  precio correcto por no tocar lo que el parser ignora.
- **[decided]** Se conserva el final de línea del documento (CRLF si lo tenía) y su falta de
  salto de línea final si no lo tenía. `NodeWriter` siempre emitía LF y siempre añadía el salto
  final; el modo línea a línea no tiene por qué.
- **[done en 0.4.1]** `--clean`: formatear *y* eliminar comentarios — implementado como el flag que
  reserializa vía `NodeWriter`, es decir, el comportamiento que `format` tenía por defecto hasta
  que se corrigió. Se queda como flag de `format` y no como comando aparte: es el mismo trabajo
  sobre el mismo conjunto de ficheros y con los mismos `--write`/`--check`/`--tabs`, solo que
  quedándose únicamente con lo que el árbol contiene. Perder comentarios sigue siendo un valor
  por defecto destructivo, así que es opt-in explícito.

## 0.5.0 — Conversión

- **[planned]** `stxt parse <file>` — emitir el árbol JSON canónico por stdout. Necesario para
  tests entre implementaciones: dos parsers coinciden si su JSON canónico coincide.
- **[open]** La forma del JSON canónico aún no está especificada en ningún sitio. Antes de
  implementarlo, hay que escribirla en `../stxt-web` y acordarla con `../stxt-java`, o si no cada
  implementación se inventará la suya.
- **[open]** `stxt from-json` (el viaje inverso). Útil para generar STXT desde otras herramientas;
  aún sin necesidad concreta.
- **[planned]** `stxt compile <template>` — convertir un documento `@stxt.template` en el
  documento `@stxt.schema` equivalente (`transformTemplateNodeToSchema`).

## Más adelante / sin decidir

- **[rejected]** `stxt install <url>` — soporte de URL remota para `install`. Descartado por
  riesgos de seguridad (descargas arbitrarias, ataques MITM, complejidad de validación de
  contenido). Usar descarga manual + `stxt install <file>` en su lugar. Un futuro **registro
  oficial de esquemas** (con HTTPS, checksums y artefactos firmados) podría revisar esto, pero
  queda fuera del alcance de esta CLI.
- **[blocked]** Transformaciones: `stxt2html`, `stxt2xml`, `stxt2yaml`, `stxt2toml`, `stxt2pdf`.
  Este es el bloque de ideas más grande de las notas, y nada de esto puede empezar aquí: necesita
  un lenguaje de transformación (`@stxt.transform` / `@stxt.t2`) especificado en `../stxt-web` e
  implementado primero en `stxt-js`. `@stxt.slots` fue el intento anterior y está en pausa por
  demasiado verboso.
- **[blocked]** `stxt2stxt` como herramienta de **migración** (`org.example.docs` →
  `org.example.docs.v2`). Mismo bloqueo, pero es posiblemente la transformación más valiosa de
  todo el conjunto, porque nada más puede migrar documentos cuando un esquema evoluciona.
- **[open]** Generador de documentación: esquema → tablas de referencia HTML (la idea de
  OpenAPI/Swagger). Encaja bien con la CLI, pero solo una vez que los esquemas lleven
  descripciones.
- **[open]** Linter semántico sobre el validador: nodos vacíos, nombres ambiguos, orden de nodos.
- **[rejected for now]** "`stxt file.stxt` sin verbo hace todo lo que puede" (validar, convertir a
  cada destino disponible, importar esquemas). Se lee bien en las notas, pero un comando cuyo
  comportamiento depende de lo que esté instalado no es scriptable y no puede tener un código de
  salida estable. El verbo explícito sigue siendo obligatorio; una ruta a secas podría más
  adelante ser azúcar para `stxt check`.
- **[open]** Paridad con Java: `stxt-java` no tiene CLI. Si alguna vez la tiene, este repositorio
  es la referencia para los nombres de comandos y códigos de salida, de la misma forma que
  `stxt-web` es la referencia para el lenguaje.

## Transversal, cuando sea relevante

- **[decided]** Alias cortos de opción: permitidos, pero solo para el puñado donde una sola letra
  es una convención Unix casi universal — `-v`/`--version`, `-h`/`--help`, `-r`/`--recursive`,
  `-w`/`--write` (`format`, 0.4.0; confirmado con el usuario antes de implementarlo, según la
  regla de "nada inventado sin preguntar" de abajo) — exactamente una letra cada uno, nada más
  sin preguntar antes. Revierte la regla original de "una sola grafia por opción, forma larga
  GNU" (AGENTS.md), que resultó estar luchando contra una convención que los usuarios ya esperan
  en vez de evitar una ambigüedad real. Añadir `-r` expuso un hueco latente en el propio parseo de
  argumentos de cada comando: una opción de un solo guion no reconocida solía tratarse
  silenciosamente como argumento posicional en vez de como error de uso, porque cada `parseArgs`
  solo comprobaba el prefijo `--`. Arreglado por igual en `Install.ts`, `Schemas.ts` y `Check.ts`
  (e incorporado a `Format.ts` desde el principio), con un test por comando.
- **[open]** Salida en color, y cómo desactivarla (`--no-color`, `NO_COLOR`, detección de no-TTY).
- **[open]** Leer desde stdin (`stxt check -`) para integración con editor y con pipes.
- **[open]** Publicar en npm, y si la versión sigue a `@stxt-lang/core` o va por su cuenta.
  Decisión actual: **su propia línea de versión**, empezando en 0.1.0 — la regla de "mismo
  número, mismo comportamiento" ata a las dos implementaciones del lenguaje, y la CLI no es una
  de ellas.
- **[open]** `.github/workflows` para build + test en cada push (necesita un token que permita
  workflows).
- **[open]** Revisar el script `prepare: npm run build`. Instalar el paquete publicado imprime un
  aviso `allow-scripts` de npm sobre esto, que es ruido para quien tenga una política estricta de
  scripts. Nada está roto: `prepare` no se ejecuta cuando el paquete se instala como dependencia
  — solo en `npm install` dentro del proyecto, en instalaciones directas desde git, y antes de
  publicar — y se verificó que una instalación limpia del tarball de 0.1.0 nunca lo ejecuta. Se
  mantiene porque es lo que compila un clon recién hecho, y `stxt-js` publica con el mismo script.
  Vale la pena revisarlo si el aviso llega a ser algún día un obstáculo real para los usuarios.
