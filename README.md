# @stxt-lang/cli

Command-line interface for **STXT**, an indentation-based structured-text language.

STXT is a plain-text language for writing structured, semantic documents: no braces, no closing
tags, just indentation. It is designed to be equally readable by humans and by machines, and it
comes with an optional schema layer so documents can be validated.

This repository is the official `stxt` command: the way to parse, validate and format STXT
documents from a terminal, a Makefile or a CI pipeline.

- Website and language reference: <https://stxt.dev>
- Parser this CLI runs on: [`@stxt-lang/core`](https://www.npmjs.com/package/@stxt-lang/core)
- VSCode extension: [STXT Language](https://marketplace.visualstudio.com/items?itemName=stxt-lang.stxt)
- Java implementation: [`dev.stxt:stxt-core`](https://central.sonatype.com/artifact/dev.stxt/stxt-core)

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

## Update

To update a global installation to the latest release:

```bash
npm update -g @stxt-lang/cli
```

Confirm the installed version with `stxt --version`. Until 1.0, a minor release can include
command-surface changes.

## Uninstall

To remove the global command:

```bash
npm uninstall -g @stxt-lang/cli
```

## Usage

```bash
stxt --version
```

```
stxt 0.13.0 (@stxt-lang/core 0.13.0, spec 1.0)
```

The version line reports the parser version as well, because that is what determines how
documents are actually parsed and validated, and the version of the STXT specifications that
parser implements (`SPEC_VERSION` of `@stxt-lang/core`), because that is what determines which
documents are valid. Two installations with different package versions read the same STXT as
long as the spec version is the same.

```bash
stxt --help
```

Options use the GNU long form. A short alias exists only for the handful of entrenched Unix
conventions: `-v`/`--version`, `-h`/`--help`, `-r`/`--recursive`, `-w`/`--write`; there are no
single-dash long options and no aliases beyond those four.

### Installing a schema or template

```bash
stxt install <file> [--local|--user|--system|--root <dir>] [--force] [--ignore-non-definitions]
```

Installs a local `@stxt.schema` or `@stxt.template` document into the resolution chain. It is
deliberately more than a copy — copying a file is something you can do by hand:

- The document is validated first. It must parse, and every root node must be a definition that
  validates against its meta-schema. A half-valid file installs nothing at all.
- Each definition is then written on its own, in canonical form (the same output
  `format --clean` produces), as `<level>/@stxt.schema/<namespace>.stxt` or
  `<level>/@stxt.template/<namespace>.stxt`. A file holding several definitions is split, one
  file per definition. The spec gives no meaning to file names or subdirectories inside a
  `.stxt` directory, so this layout is a convention of this CLI — a recommended one, not a rule
  of the language: you remain free to place files by hand.
- A root node that is neither a schema nor a template makes the whole file fail, unless
  `--ignore-non-definitions` is given, which installs the definitions and skips the rest.

`--local` (the default) installs into `./.stxt` of the current project, `--user` into `~/.stxt`,
`--system` into `/etc/stxt` (`%ProgramData%\stxt` on Windows), and `--root <dir>` into any
directory you choose. `--force` is required to overwrite a definition already installed, or to
install a namespace another file of that level already defines — two definitions of one
namespace in a single level leave that namespace with no active definition at all.

### Inspecting what applies to a document

```bash
stxt schemas [path]
```

Lists the resolution chain for a document at `path` (or the current directory), the active
definition for each namespace, and any resolution error found along the way. It is the fastest
way to answer "why is my document not being validated?".

### Validating documents

```bash
stxt validate <file|dir|->... [--recursive|-r] [--format text|json] [--warn-schema|--no-schema]
```

Parses every given document and validates it against the schemas discovered for its own
resolution chain (the same one `install`/`schemas` use), reporting every error found rather than
stopping at the first one. A directory requires `--recursive`/`-r`, which descends into
subdirectories, validating every `*.stxt` file and skipping `.stxt/` directories (they are the
resolution chain itself, not documents to validate). `-` reads one document from the standard
input (for pipes and CI: `cat doc.stxt | stxt validate -`); it is reported as `<stdin>`, and its
resolution chain starts at the current directory, as if the document were a file there. `-` can
be mixed with files, but given only once.

By default, a schema (validation) error fails the build exactly like a syntax error — `validate` is
meant for CI. Two opt-outs:

- `--warn-schema`: schema errors are still reported, but only syntax errors affect the exit code.
- `--no-schema`: skips schema discovery and validation entirely, validating only the base-language
  grammar.

A namespace that no schema of the chain defines is reported as `SCHEMA_NOT_FOUND`, also when the
chain has no schema at all: `validate` was asked to validate, and a document it cannot validate is
not a validated one. Documents without namespace are not validated and pass (STXT-SCHEMA-SPEC §5);
to check only the syntax of namespaced ones, use `--no-schema`.

`--format text` (the default) prints one line per finding — `file:line: [CODE] message
(error|warning)` — plus a summary, and prints nothing at all when every document passes (silence
is success, as with `gofmt` or `make`); `--format json` always prints a single JSON array of
`{file, line, code, message, severity}` (empty when there is nothing to report), for tooling
and CI.

### Describing the logical tree

```bash
stxt describe <file|->
```

Parses one document (a file, or the standard input with `-`) with the base STXT grammar and
writes its *STXT-TREE-SPEC* canonical JSON tree to stdout. It neither discovers nor applies schemas: use `stxt validate` when validation is
required. The outer JSON array preserves every root node, `children` appears only on inline nodes,
and a block carries its literal logical lines in `lines`.

### Formatting documents

```bash
stxt format <file|dir|->... [--recursive|-r] [--tabs|--spaces] [--write|-w] [--check] [--clean]
```

Rewrites every given document line by line with the `Formatter` of `@stxt-lang/core`: the lines
that open a node are re-rendered in their canonical form, the lines of a text block — blank ones
included — are re-indented to the level of their block (any indentation of their own beyond it
is content and stays), the whole indentation units of a comment (tabs or groups of four spaces)
are converted to the chosen style, one for one, and everything else — the text of the comments,
blank lines — is kept, with only its trailing whitespace removed. The VS Code extension and the
playground call the same formatter, so every tool agrees. The directory
walking rules are those of `validate` (`--recursive`/`-r`, skipping `.stxt/`). No destructive
default: without a flag the reformatted text is only printed to stdout, nothing on disk is
touched.

- `--write`/`-w`: rewrites each file in place, only when it would actually change.
- `--check`: writes nothing; reports which files would change (`<file>: would be reformatted`)
  and fails the build if any would — the CI-friendly half, the same idea as `gofmt -l`/
  `prettier --check`.
- `--clean`: re-serializes the parse tree instead (`NodeWriter`), which drops every comment and
  every blank line. It is the destructive reading of "format", so it is an explicit opt-in.

`--tabs` (the default) / `--spaces` (four spaces per level) pick the indent style; `--write` and
`--check` are mutually exclusive, and so are `--tabs` and `--spaces`. A document with a syntax
error is reported, never reformatted, in every mode — `format` does not look at schemas at all.

`-` reads one document from the standard input and prints the result to stdout (`--check -`
reports `<stdin>: would be reformatted`); `--write` with `-` is a usage error, since there is no
file to write back to. This is what makes `format` usable as an editor filter:
`stxt format - < doc.stxt`.

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
npm run build   # clean out/ and compile src/**/*.ts -> out/**/*.js
npm run watch   # build in watch mode
npm run lint    # eslint src --ext .ts
npm test        # pretest (build + lint), then mocha over out/test/**/*.test.js
```

The parser and the schema engine are **not** in this repository: they live in
[`stxt-js`](https://github.com/stxt-lang/stxt-js) and are consumed here as the npm dependency
`@stxt-lang/core`. Parsing and validation bugs are fixed there, not here.

## License

MIT — see [LICENSE](LICENSE).
