# CLAUDE.md

Este fichero da contexto a Claude Code (claude.ai/code) para trabajar con el código de este
repositorio.

## Proyecto

La **interfaz de línea de comandos oficial de STXT**, un formato de texto estructurado basado en
indentación: el comando `stxt`, escrito en TypeScript para Node, publicado en npm como
**`@stxt-lang/cli`**. Compila vía `tsc` a CommonJS plano en `out/`, y el `bin` de `package.json`
hace que `stxt` apunte a `out/cli.js`.

**Este repositorio no contiene ningún parser.** Es una interfaz sobre `@stxt-lang/core`, su única
dependencia en tiempo de ejecución. Todo lo relativo a cómo se parsea, valida o serializa un
documento vive en el repositorio hermano `../stxt-js`; un bug en cualquiera de esas partes se
arregla allí, se publica, y se consume aquí subiendo el rango de la dependencia. Si una
funcionalidad de la CLI parece necesitar un cambio en el parser, el cambio se hace en `../stxt-js`
(es escribible desde aquí), se ejecuta su `npm test`, y solo entonces se conecta aquí.

### Los repositorios hermanos

- **`../stxt-web`** — la especificación normativa del lenguaje, escrita en el propio STXT.
  Español canónico en `es/`, espejo en inglés en `en/`. **La especificación tiene autoridad sobre
  cualquier implementación, incluida esta.**
  - `es/stxt-core-ref.stxt` — sintaxis base (STXT-SPEC): indentación, nodos en línea, bloques de
    texto, namespaces, comentarios, normalización, códigos de error.
  - `es/stxt-schema-ref.stxt` — `@stxt.schema` (STXT-SCHEMA-SPEC): `Node`/`Children`/`Child`,
    tipos, cardinalidades, y el meta-esquema oficial.
  - `es/stxt-template-ref.stxt` — `@stxt.template` (STXT-TEMPLATE-SPEC): la forma simplificada de
    autoría que compila a un esquema.
- **`../stxt-js`** — la implementación en TypeScript, publicada como `@stxt-lang/core`. Su
  superficie pública es `src/all.ts` y nada más: `Parser`, `ParseResult`, `Node`, `Line`,
  `Constants`, `parseLine`, `StringUtils`, `ParseException`, `ValidationException`, `Observer`,
  `Schema`, `SchemaValidator`, `SchemaProvider`, `NodeDefinition`, `ChildDefinition`,
  `transformNodeToSchema`, `UnifiedSchemaProvider`, `ConditionalValidator`, `NodeWriter`,
  `IndentStyle`, `transformTemplateNodeToSchema`, y — desde la 0.6.0 — la capa de discovery:
  `DiscoveryResolver`, `DiscoveryOptions`, `DiscoveryResult`, `DiscoveryDefinition`,
  `DiscoveryLevel`, `DiscoveryError`, `DiscoveryFileSystem`, `DiscoveryEntry`,
  `DiscoveryEnvironment`. Si esta CLI necesita algo que no está en esa lista, la solución es
  exportarlo allí, con JSDoc — no acceder directamente a `@stxt-lang/core/out/...`.
- **`../stxt-java`** — la implementación en Java (`dev.stxt:stxt-core`), mantenida compatible en
  comportamiento con `stxt-js` bajo el mismo número de versión. **No tiene CLI**; si alguna vez la
  tiene, este repositorio es la referencia para nombres de comandos y códigos de salida.
- **`../stxt-vscode`** — la extensión de VSCode. También un consumidor puro de
  `@stxt-lang/core`. El discovery de esquemas está **especificado** (STXT-DISCOVERY-SPEC,
  `../stxt-web/es/stxt-discovery-ref.stxt`) e implementado una sola vez, como `DiscoveryResolver`
  en `@stxt-lang/core` 0.6.0; tanto la extensión como esta CLI consumen ese mismo resolver a
  través de adaptadores de host (aquí, `src/discovery/NodeDiscovery.ts`, cuyo
  `createDiscoveryResolver()` es lo que `check` debe llamar), de modo que el editor y la línea de
  comandos coinciden por construcción sobre qué esquemas aplican.
- **`../stxt-cms`** — código no relacionado, pero su `TODO.txt` es donde viven las ideas sueltas
  del usuario para la CLI. [ROADMAP.md](ROADMAP.md) es la versión filtrada de esas notas.

## Estado actual (a 2026-08-08)

Versión **0.4.1** en `package.json`. `v0.1.0` a `v0.4.0` ya están publicadas en npm y etiquetadas
en git (firmadas con GPG, subidas a `origin`) — ver [help.txt](help.txt) para los comandos
exactos. **0.4.1 está preparada pero todavía no publicada ni etiquetada**: el `npm publish` y el
`git tag -s v0.4.1` los lanza el usuario.

**0.3.0** lanzó `check`: `stxt check <file|dir>... [--recursive|-r] [--format text|json]
[--warn-schema|--no-schema]`, en [src/command/Check.ts](src/command/Check.ts), despachado desde
la tabla de comandos de `Cli.ts`. Reutiliza la misma cadena
`DiscoveryResolver`/`NodeDiscoveryEnvironment` que `install`/`schemas` (un resolver por
invocación, un `resolve()` por documento, según STXT-DISCOVERY-SPEC sección 7). Decidido junto
con esto: un error de esquema (validación) hace fallar el build **por defecto**, igual que un
error de sintaxis — `--warn-schema` lo rebaja a un warning que no falla, `--no-schema` se salta
por completo el discovery y la validación de esquemas (solo sintaxis). `SCHEMA_NOT_FOUND` se
suprime solo cuando la cadena de un documento no tiene ningún esquema, la misma regla que aplica
`AnalysisDoc.ts` de `stxt-vscode`. `--recursive` adoptó el alias `-r` en cuanto se permitieron los
alias cortos en general (más abajo); la recursión se salta los directorios `.stxt/` al descender,
ya que son la propia cadena de resolución, no documentos que comprobar.

**0.3.1** cierra los dos puntos con los que `check` se había lanzado incompletos: un nodo raíz
cuyo namespace es `@stxt.schema`/`@stxt.template` ahora también pasa por
`transformNodeToSchema`/`transformTemplateNodeToSchema` (`checkAsDefinition()` en `Check.ts`), de
modo que un documento de esquema/template roto hace fallar `check` aunque no tenga esquema propio
contra el que validarse; y los `DiscoveryError` encontrados al cargar la propia cadena de un
documento (fichero de esquema roto, namespace duplicado) ahora también se convierten en
hallazgos, nombrando el fichero de la propia definición causante en la línea `0`. Ambos se rigen
por el mismo `SchemaMode` que el resto de la capa de esquemas (omitidos por `--no-schema`,
rebajados por `--warn-schema`), y no se deduplican entre documentos que comparten un fichero roto
en su cadena — ver ROADMAP.md para el razonamiento.

También decidido por el camino: la CLI permite un alias corto para el puñado de opciones donde
uno es una convención Unix asentada — `-v`, `-h`, `-r` — revirtiendo la regla original de "nada
de alias cortos" (ver Convenciones más abajo). Añadir `-r` expuso un hueco latente en el parseo
de argumentos de cada comando: una opción de un solo guion no reconocida (p. ej. `-x`) se trataba
silenciosamente como argumento posicional en vez de como error de uso, porque cada `parseArgs`
solo comprobaba `arg.startsWith("--")`. Arreglado en los tres comandos (`Install.ts`,
`Schemas.ts`, `Check.ts`) comprobando `arg.startsWith("-")` en su lugar, con un test por comando.

**0.4.0** lanza `format`: `stxt format <file|dir>... [--recursive|-r] [--tabs|--spaces-4]
[--write|-w] [--check]`, en [src/command/Format.ts](src/command/Format.ts). Sin valor por
defecto destructivo (AGENTS.md): sin flag, solo imprime el texto reformateado por stdout, sin
tocar nada en disco — esto revierte lo que la nota original de ROADMAP.md decía para esta versión
("reescribir el fichero in situ" por defecto), detectado y corregido antes de implementarlo en
vez de después. `--write`/`-w` es el flag explícito que reescribe un fichero in situ, y solo
cuando realmente cambiaría; `--check` no escribe nada y reporta qué ficheros cambiarían, haciendo
fallar el build si alguno lo haría (la idea de `gofmt -l`/`prettier --check`). `-w` es un alias
corto nuevo, confirmado antes con el usuario según la regla de "nada inventado sin preguntar". Un
documento con un error de sintaxis se reporta, nunca se reformatea, en ningún modo; `format` no
tiene ningún `SchemaMode`, ya que reserializar un árbol no tiene nada que ver con si valida contra
un esquema. Reutiliza `collectStxtFiles()`, extraído de `Check.ts` a
[src/runtime/StxtFiles.ts](src/runtime/StxtFiles.ts) ya que ambos comandos recorren directorios
de forma idéntica (descender, saltar `.stxt/`, listar `*.stxt`, ordenado por nombre).

**0.4.1** corrige el fallo con el que `format` se había lanzado: **destruía los comentarios**.
Reserializaba con `NodeWriter`, y el árbol de parseo no contiene ni comentarios ni líneas en
blanco, así que no había forma de devolverlos — un valor por defecto destructivo escondido, justo
lo que AGENTS.md prohíbe. Ahora `format` reescribe el documento **línea a línea**: re-renderiza en
forma canónica las líneas que abren un nodo y conserva toda línea que el árbol no describe
(comentarios, blancos, contenido de bloques de texto), quitándole solo los espacios finales. Es la
misma estrategia que el `FormattingProvider` de `../stxt-vscode`, que nunca tuvo el problema
porque formatea con un `TextEdit` por línea; aquí el mapa línea→nodo lo construye un `Observer`
propio (`SourceLines`, en `Format.ts`), análogo al `TokenGeneratorObserver` de la extensión. Se
conserva también el final de línea original (CRLF) y la ausencia de salto final, y el namespace se
escribe solo donde el fuente lo escribió. Con esto `--clean` — que estaba **[open]** en
ROADMAP.md — pasa a tener sentido y queda implementado: es exactamente el camino de `NodeWriter`
de antes, ahora opt-in explícito, y se queda como flag de `format` en vez de comando aparte porque
es el mismo trabajo sobre los mismos ficheros y con los mismos `--write`/`--check`/`--tabs`.

**Sin publicar todavía**, encima de 0.4.1: `install` deja de ser una copia. Se había lanzado
aceptando **cualquier** fichero y dejándolo en el destino con su propio nombre, así que permitía
romper el nivel entero sin decir nada (un `.txt` instalado hace que `schemas` salga con 1 y que
`check` reporte `DISCOVERY_NOT_A_DEFINITION` en todos los documentos). Ahora valida primero — el
fichero debe tener extensión `.stxt`, parsear, y cada nodo raíz debe ser una definición que valide
contra su meta-esquema (`SchemaValidator` sobre `UnifiedSchemaProvider`, la misma comprobación que
hace `DiscoveryResolver` al cargar un nivel) — y solo entonces escribe, todo o nada. Cada
definición se escribe por separado y en forma canónica (`NodeWriter`, la salida de
`format --clean`) como `<nivel>/@stxt.schema/<namespace>.stxt` o
`<nivel>/@stxt.template/<namespace>.stxt`, con el namespace **objetivo**, no el nombre del fichero
de origen; un fichero con varias definiciones se parte, una por fichero. Esa nomenclatura es
convención de esta CLI —- STXT-DISCOVERY-SPEC §3 no da significado ni a nombres ni a
subdirectorios —, pensada como recomendación: a mano se puede seguir colocando lo que se quiera.
Un nodo raíz que no es ni schema ni template hace fallar el fichero entero salvo con
`--ignore-non-definitions`, y `--force` pasa a cubrir también el choque de **namespace** (otro
fichero del mismo nivel que ya lo define), no solo el de ruta.

`npm test` da 108 tests pasando (7 CLI + 9 discovery + 26 install + 9 schemas + 32 check + 25
format).

Ver [ROADMAP.md](ROADMAP.md), que es la lista viva de objetivos y el sitio donde registrar
decisiones a medida que se toman.

## Cómo se trabaja aquí

- **El usuario hace siempre todos los commits.** Nunca ejecutar `git commit`, `git push` ni
  `git tag`; ni ofrecerse a hacerlo. Él revisa lo que entra — aunque solo sea por volumen — antes
  de subirlo, y esa revisión es el objetivo. Dejar el trabajo en el árbol de trabajo y decir qué
  ha cambiado.
- Lo mismo aplica a publicar: `npm publish` es decisión suya, no algo que ejecutar o sugerir a
  mitad de tarea.
- [ROADMAP.md](ROADMAP.md) es la ruta compartida. Cuando se toma una decisión (un nombre de
  comando, un flag, algo rechazado), se registra ahí con su razón, y se mueve el estado del ítem.
  Un ítem que resulta pertenecer al lenguaje y no a la CLI se marca como bloqueado en
  `../stxt-web` y `../stxt-js` en vez de dejarlo a medio implementar aquí.

## Comandos

```bash
npm run build   # tsc: src/**/*.ts -> out/**/*.js (+ .d.ts + sourcemaps)
npm run watch   # build en modo watch
npm run lint    # eslint src --ext .ts
npm test        # pretest (build + lint), y luego mocha sobre out/test/**/*.test.js
node out/cli.js --version   # ejecutar la CLI compilada sin instalarla
```

`tsconfig.json` tiene `strict` + `noEmitOnError`, así que los errores de tipos hacen fallar el
build. Los avisos de `npm audit` vienen todos del árbol de dependencias de mocha (solo de
desarrollo).

## Arquitectura

Deliberadamente pequeña, y organizada de modo que añadir un comando no toca el punto de entrada.

- [src/cli.ts](src/cli.ts) — el punto de entrada `bin`: shebang, guarda contra EPIPE, y una
  llamada a `run()`. Fija `process.exitCode` en vez de llamar a `process.exit()`, para que Node
  vacíe stdout antes de terminar. La guarda EPIPE es lo que evita que `stxt ... | head` imprima
  un stack trace.
- [src/runtime/Cli.ts](src/runtime/Cli.ts) — despacho de argumentos. `run(args, io)` es `async` y
  resuelve a un código de salida; nunca toca `console` directamente — toda la salida pasa por la
  interfaz `CliIO`, que es lo que hace testeables los comandos sin lanzar un proceso. La tabla
  `COMMANDS` mapea el primer argumento que no es una opción a una función de comando (síncrona o
  asíncrona; `run()` espera cualquiera de las dos); `--version`/`--help` se comprueban primero
  para que funcionen delante de cualquier comando también.
- [src/runtime/ExitCode.ts](src/runtime/ExitCode.ts) — el contrato de códigos de salida: `0` ok,
  `1` los documentos fallaron, `2` la invocación fue incorrecta. La separación `1` / `2` es el
  punto clave: un job de CI debe poder distinguir un error de documento de una línea de comandos
  rota.
- [src/runtime/PackageInfo.ts](src/runtime/PackageInfo.ts) — lee la versión de `package.json` en
  tiempo de ejecución (la propia, y la de `@stxt-lang/core` vía `require.resolve`). **La versión
  nunca se escribe en el fuente**, así que `npm version` basta para subirla.
- [src/discovery/NodeDiscovery.ts](src/discovery/NodeDiscovery.ts) — los adaptadores de host que
  permiten que el `DiscoveryResolver` del core corra en un proceso Node:
  `NodeDiscoveryFileSystem` sobre `node:fs`, `NodeDiscoveryEnvironment` sobre `process.env` /
  `os.homedir()`, y `createDiscoveryResolver()`, que es lo que llama un comando. **Aquí no vive
  ninguna política de discovery** — la cadena, la precedencia y las reglas de duplicados están
  todas en `@stxt-lang/core`; este fichero solo responde "qué hay en disco". Cada parámetro del
  constructor tiene un valor por defecto de `process`/`os` para que los tests puedan inyectar un
  entorno falso en vez de mutar el real.
- `src/command/` — un fichero por comando de documento, despachado desde la tabla `COMMANDS` de
  `Cli.ts`. [src/command/Install.ts](src/command/Install.ts): `runInstall(args, io, deps)`,
  donde `deps` (`cwd`, `environment`) usa por defecto el proceso real pero permite que los tests
  apunten `--local` y `--user`/`--system` a un directorio temporal — el mismo patrón de
  dependencia inyectable que `NodeDiscoveryEnvironment`. [src/command/Schemas.ts](src/command/Schemas.ts):
  `runSchemas(args, io, deps)`, `async` porque espera a `DiscoveryResolver.resolve()`; `deps`
  (`cwd`, `resolver`) es inyectable de la misma forma, hasta una interfaz `SchemasResolver` (solo
  el método `resolve()`) para que un test pueda simular un resultado sin tocar el sistema de
  ficheros. [src/command/Check.ts](src/command/Check.ts): `runCheck(args, io, deps)`, misma
  forma de `deps` pero tipada como `Pick<DiscoveryResolver, "resolve">` ya que necesita el
  contrato completo de `SchemaProvider` (`getSchema`) para construir un `SchemaValidator`, no solo
  la vista de solo lectura que usa `schemas`. Construye un `Parser` desnudo por documento (sin
  ningún validador registrado cuando hay `--no-schema`), recoge cada `ParseResult.getErrors()` en
  un `Finding`, y clasifica la severidad a partir de `instanceof ValidationException` más el modo
  de esquema. [src/command/Format.ts](src/command/Format.ts): `runFormat(args, io, deps)`,
  síncrono (sin discovery, sin ningún esquema involucrado — reformatear un documento no tiene
  nada que ver con si valida contra uno). Reescribe línea a línea sobre el mapa línea→nodo que
  construye su `Observer` `SourceLines`, de modo que los comentarios y las líneas en blanco
  sobreviven; un documento con un error de sintaxis se reporta, nunca se reformatea, en ningún
  modo. Tres modos mutuamente excluyentes: imprimir el texto reformateado por stdout (por
  defecto, sin flag — la regla de sin valor por defecto destructivo de abajo), `--check`
  (reportar qué ficheros cambiarían, sin escribir nada, fallando si alguno lo haría),
  `--write`/`-w` (reescribir in situ, solo cuando realmente cambiaría). `--clean` cambia el
  motor: reserializa vía `NodeWriter.toSTXTDocs()`, lo que produce el documento canónico pero
  pierde comentarios y líneas en blanco. `--tabs` (por defecto) / `--spaces-4` eligen el
  `IndentStyle`, también mutuamente excluyentes. Comparte `collectStxtFiles()`
  ([src/runtime/StxtFiles.ts](src/runtime/StxtFiles.ts)) con `Check.ts`: la regla de recorrido de
  directorios (descender, saltar `.stxt/`, listar `*.stxt`, ordenado por nombre) es idéntica en
  ambos, así que se extrajo en cuanto `format` la necesitó por segunda vez.

## Convenciones

- **Todo el texto de cara al usuario está en inglés**: comentarios del código, JSDoc, README,
  hoja de ruta, texto de ayuda y mensajes de error. Esto coincide con `../stxt-js` desde su
  0.5.3. (Las conversaciones con el usuario son en español; el repositorio no.) La excepción es
  [help.txt](help.txt), el chuleta de npm del propio usuario, que está en español aquí y en
  `../stxt-js` — mantenerlo así; y desde ahora también estos tres ficheros de gobierno del
  proyecto (este mismo, [AGENTS.md](AGENTS.md) y [ROADMAP.md](ROADMAP.md)), traducidos a
  español a petición del usuario para su propio control, y que no forman parte del código ni de
  la salida de la CLI.
- Cada miembro exportado lleva un comentario JSDoc: una frase resumen más `@param`/`@returns`.
- **Cada opción tiene una única forma larga**, la forma GNU (`--version`). Existe un alias corto
  solo para el puñado de convenciones Unix casi universales — `-v`/`--version`, `-h`/`--help`,
  `-r`/`--recursive`, `-w`/`--write` — y es exactamente una letra; nada de formas largas con un
  solo guion (`-version`). Nada más recibe un alias corto sin preguntar antes:
  `--local`/`--user`/`--system`/`--root`/`--force` (`install`),
  `--format`/`--warn-schema`/`--no-schema` (`check`),
  `--tabs`/`--spaces-4`/`--check`/`--clean` (`format`) se quedan solo en forma larga, ya que no
  hay una convención de una sola letra igual de obvia para ellas. Lo mismo vale para
  `--ignore-non-definitions` (`install`). Las grafías desconocidas — incluida cualquier opción de un solo guion no
  reconocida, no solo las de `--` — son errores de uso, y hay tests para ello, uno por cada
  `parseArgs` de comando.
- Los tests son suites `describe`/`it` de mocha bajo `src/test/*.test.ts`, compiladas junto al
  código y ejecutadas desde `out/test`. Los comandos se testean llamando a `run()` con un
  `CliIO` que captura la salida, no lanzando el binario.
- Cualquier cosa destructiva (reescribir ficheros in situ, borrar comentarios) necesita un flag
  explícito; nada de valores por defecto destructivos.
