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

**Early work in progress.** Version 0.1.0 is the project skeleton: it builds, it ships a working
`stxt` executable, and the only thing that executable does is report its version. The document
commands (`check`, `format`, `parse`, ...) are not implemented yet — see [ROADMAP.md](ROADMAP.md)
for the planned order.

The package is not published to npm yet.

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

Once published, the CLI will be installed globally:

```bash
npm install -g @stxt-lang/cli
```

For now, install it from a clone of this repository:

```bash
git clone https://github.com/stxt-lang/stxt-cli.git
cd stxt-cli
npm install          # also builds, through the "prepare" script
npm link             # puts `stxt` on your PATH
```

Node 20 or newer is required.

## Usage

```bash
stxt --version
```

```
stxt 0.1.0 (@stxt-lang/core 0.5.3)
```

The version line reports the parser version as well, because that is what determines how
documents are actually parsed and validated.

```bash
stxt --help
```

Options use the GNU long form, and only that: there are no single-dash long options and no short
aliases.

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
