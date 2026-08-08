# @stxt-lang/cli

Command-line interface for **STXT**, an indentation-based structured-text format.

STXT is a plain-text format for writing structured, semantic documents: no braces, no closing
tags, just indentation. It is designed to be equally readable by humans and by machines, and it
comes with an optional schema layer so documents can be validated.

This repository is the official `stxt` command: the way to parse, validate and format STXT
documents from a terminal, a Makefile or a CI pipeline.

- Website and language reference: <https://stxt.dev>
- Parser this CLI runs on: [`@stxt-lang/core`](https://www.npmjs.com/package/@stxt-lang/core)
- VSCode extension: [STXT - Semantic Text](https://marketplace.visualstudio.com/items?itemName=stxt-lang.stxt)
- Java implementation: [`dev.stxt:stxt-core`](https://central.sonatype.com/artifact/dev.stxt/stxt-core)

## Status

**Early work in progress.** `stxt install`, `stxt schemas`, `stxt check` and `stxt format` are
implemented: placing schema/template files in the resolution chain, inspecting what applies to a
document, validating documents against their discovered schemas, and reformatting them in their
canonical form without losing comments. The commands that convert documents (`parse`,
`from-json`, `compile`) are not implemented yet — see [ROADMAP.md](ROADMAP.md) for the planned
order.

It is published from the start so that the command name is real and installable while it grows;
until 0.x settles, expect the command surface to change between minor versions.

## What STXT looks like

```stxt
# A line starting with '#' is a comment

Article (blog.post):
    Title: Getting started with STXT
    Author: Joan
    Published: 2026-07-28
    Tags:
        Tag: parser
        Tag: text-format
    Body >>
        Everything indented under a '>>' node is kept verbatim
        as a block of text lines.
```

- `Name: value` declares an **inline node**.
- `Name >>` opens a **text block**; every deeper-indented line belongs to it.
- Indentation is **one level per tab or per 4 spaces**.
- `Name (a.b.c):` attaches a **namespace** to a node; children inherit it unless they declare
  their own.

## Install

```bash
npm install -g @stxt-lang/cli
```

Node 20 or newer is required.

To work on the CLI itself, install it from a clone of this repository instead:

```bash
git clone https://github.com/stxt-lang/stxt-cli.git
cd stxt-cli
npm install          # also builds, through the "prepare" script
npm link             # puts `stxt` on your PATH
```

## Usage

```bash
stxt --version
```

```
stxt 0.4.0 (@stxt-lang/core 0.6.0)
```

The version line reports the parser version as well, because that is what determines how
documents are actually parsed and validated.

```bash
stxt --help
```

Options use the GNU long form. A short alias exists only for the handful of entrenched Unix
conventions: `-v`/`--version`, `-h`/`--help`, `-r`/`--recursive`, `-w`/`--write`; there are no
single-dash long options and no aliases beyond those four.

### Installing a schema or template

```bash
stxt install <file> [--local|--user|--system|--root <dir>] [--force]
```

Copies a local `@stxt.schema` or `@stxt.template` file into the resolution chain: `--local`
(the default) puts it in `./.stxt` of the current project, `--user` in `~/.stxt`, `--system` in
`/etc/stxt` (`%ProgramData%\stxt` on Windows), and `--root <dir>` in any directory you choose.
`--force` is required to overwrite a file already at the destination.

### Inspecting what applies to a document

```bash
stxt schemas [path]
```

Lists the resolution chain for a document at `path` (or the current directory), the active
definition for each namespace, and any resolution error found along the way. It is the fastest
way to answer "why is my document not being validated?".

### Checking documents

```bash
stxt check <file|dir>... [--recursive|-r] [--format text|json] [--warn-schema|--no-schema]
```

Parses every given document and validates it against the schemas discovered for its own
resolution chain (the same one `install`/`schemas` use), reporting every error found rather than
stopping at the first one. A directory requires `--recursive`/`-r`, which descends into
subdirectories, checking every `*.stxt` file and skipping `.stxt/` directories (they are the
resolution chain itself, not documents to check).

By default, a schema (validation) error fails the build exactly like a syntax error — `check` is
meant for CI. Two opt-outs:

- `--warn-schema`: schema errors are still reported, but only syntax errors affect the exit code.
- `--no-schema`: skips schema discovery and validation entirely, checking only the base-language
  grammar.

`SCHEMA_NOT_FOUND` is never reported for a document whose resolution chain has no schema at all
(schemas are an optional layer), the same rule the VSCode extension applies.

`--format text` (the default) prints one line per finding — `file:line: [CODE] message
(error|warning)` — plus a summary; `--format json` prints a single JSON array of
`{file, line, code, message, severity}`, for tooling and CI.

### Formatting documents

```bash
stxt format <file|dir>... [--recursive|-r] [--tabs|--spaces-4] [--write|-w] [--check] [--clean]
```

Rewrites every given document line by line: the lines that open a node are re-rendered in their
canonical form, and everything the parse tree does not describe — comments, blank lines, the
content of a text block — is kept, with only its trailing whitespace removed. This is the same
formatting the VSCode extension applies, so the editor and the command line agree. The directory
walking rules are those of `check` (`--recursive`/`-r`, skipping `.stxt/`). No destructive
default: without a flag the reformatted text is only printed to stdout, nothing on disk is
touched.

- `--write`/`-w`: rewrites each file in place, only when it would actually change.
- `--check`: writes nothing; reports which files would change (`<file>: would be reformatted`)
  and fails the build if any would — the CI-friendly half, the same idea as `gofmt -l`/
  `prettier --check`.
- `--clean`: re-serializes the parse tree instead (`NodeWriter`), which drops every comment and
  every blank line. It is the destructive reading of "format", so it is an explicit opt-in.

`--tabs` (the default) / `--spaces-4` pick the indent style; `--write` and `--check` are mutually
exclusive, and so are `--tabs` and `--spaces-4`. A document with a syntax error is reported,
never reformatted, in every mode — `format` does not look at schemas at all.

## Exit codes

The command is meant to be used from scripts, so the exit code distinguishes *your documents are
wrong* from *you called me wrong*:

| Code | Meaning                                                                 |
|------|-------------------------------------------------------------------------|
| `0`  | The command did what it was asked to do.                                 |
| `1`  | The command ran, but the documents did not pass (parse or schema errors).|
| `2`  | The command line itself was wrong: unknown option, missing argument.     |

## Development

```bash
npm run build   # tsc: src/**/*.ts -> out/**/*.js
npm run watch   # build in watch mode
npm run lint    # eslint src --ext .ts
npm test        # pretest (build + lint), then mocha over out/test/**/*.test.js
```

The parser and the schema engine are **not** in this repository: they live in
[`stxt-js`](https://github.com/stxt-lang/stxt-js) and are consumed here as the npm dependency
`@stxt-lang/core`. Parsing and validation bugs are fixed there, not here.

## License

MIT — see [LICENSE](LICENSE).
