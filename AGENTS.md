# Instrucciones para el agente — stxt-cli

Consulta [CLAUDE.md](CLAUDE.md) para el contexto completo del proyecto, las decisiones de
arquitectura y el resumen de la hoja de ruta. Las notas de abajo son las directrices que más
afectan al comportamiento del agente.

## Compilación y tests

```bash
npm run build   # tsc: src/ → out/ (strict, noEmitOnError — los errores de tipos hacen fallar el build)
npm run lint    # eslint src --ext .ts
npm test        # pretest (build + lint) y luego mocha out/test/**/*.test.js
```

Línea base actual: **96 tests pasando** (7 CLI + 9 discovery + 14 install + 9 schemas + 32 check +
25 format).

## Reglas fijas

- **Nunca hacer commit, push, tag ni publish.** El usuario revisa y ejecuta todas las
  operaciones de git/npm.
- **Aquí no se toca el parser.** La lógica de parser, esquema y validación vive en `../stxt-js`
  (`@stxt-lang/core`). Si una funcionalidad de la CLI parece requerir un cambio en el parser,
  hazlo allí primero.
- **Una única forma larga por opción, forma GNU** (`--version`), más un alias corto solo para el
  puñado de opciones donde una sola letra es una convención Unix casi universal: `-v`/`--version`,
  `-h`/`--help`, `-r`/`--recursive`, `-w`/`--write`. Nada de formas largas con un solo guion
  (`-version`), ni alias inventados para nada más (`--local`, `--force`, `--format`, `--clean`,
  ...) sin preguntar antes. Las grafías desconocidas son errores de uso; hay tests para ello.
- **Nada de valores por defecto destructivos.** Cualquier comportamiento que reescriba ficheros
  necesita un flag explícito.

## Arquitectura en un párrafo

`src/cli.ts` es el punto de entrada shebang; llama a `run()` desde `src/runtime/Cli.ts`, que
despacha los comandos y devuelve un `ExitCode` (0 ok / 1 error de documento / 2 uso incorrecto).
Toda la salida pasa por la interfaz `CliIO` — nunca `console` — de modo que los tests llaman a
`run()` con un `CliIO` que captura la salida en lugar de lanzar un proceso. Los adaptadores de
discovery viven en `src/discovery/NodeDiscovery.ts`; envuelven el `DiscoveryResolver` de
`@stxt-lang/core` con valores por defecto inyectables de `fs`/`process`/`os` para que sean
testeables. `src/command/` contiene un fichero por comando de documento (`Install.ts`,
`Schemas.ts`, `Check.ts`, `Format.ts`), despachados desde la tabla `COMMANDS` de `Cli.ts`.
`src/runtime/StxtFiles.ts` contiene `collectStxtFiles()`, la lógica de recorrido de directorios
compartida por `check` y `format` (descender, saltar `.stxt/`, listar `*.stxt`, ordenado por
nombre).

## Qué viene ahora

0.1.0 hasta 0.4.0 (`install`, `schemas`, `check`, `format`) están implementadas y publicadas;
`v0.1.0` a `v0.4.0` están etiquetadas, firmadas y subidas a `origin`, y `0.4.0` ya está publicada
en npm. Encima de eso hay sin publicar la corrección de `format` (ya no destruye comentarios:
reescribe línea a línea) y su nuevo `--clean`. Lo siguiente en la hoja de ruta es 0.5.0
(`parse`/`from-json`/`compile`), bloqueado hasta que se especifique la forma canónica del JSON en
`../stxt-web`. `--format github` para `check` sigue **[open]** en [ROADMAP.md](ROADMAP.md) — vale
la pena revisarlo, pero no es bloqueante.

## Convenciones

- Todo el texto de cara al usuario (código, comentarios, JSDoc, mensajes de error) está en
  **inglés**. Las conversaciones con el usuario son en español; el repositorio no — con la
  excepción de [help.txt](help.txt) y de estos tres ficheros de gobierno del proyecto (este
  mismo, [CLAUDE.md](CLAUDE.md) y [ROADMAP.md](ROADMAP.md)), que están en español a propósito
  para que el usuario tenga mejor control sobre ellos. No son código ni forman parte de la salida
  de la CLI.
- Cada miembro exportado lleva un resumen JSDoc más `@param`/`@returns`.
- Los tests viven en `src/test/*.test.ts`, compilados a `out/test/`, y usan `describe`/`it` de
  mocha.
- La versión nunca está fijada en el código fuente — `npm version` es el único lugar donde
  cambiarla.
