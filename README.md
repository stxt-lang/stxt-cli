# @stxt-lang/cli

The `stxt` command: parse, validate and format **STXT** documents from a terminal, a Makefile
or a CI pipeline.

STXT is a **Human-First** language, designed for documents and structured data: indentation is
the structure, free text is literal, and schemas are written in STXT itself.

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

- `Name: value` is an **inline node**.
- `Name >>` opens a **text block**. Every deeper-indented line belongs to it.
- Indentation is **one level per tab or per 4 spaces**.
- `Name (a.b.c):` attaches a **namespace** to a node. Children inherit it unless they declare their own.

Links:

- The language: <https://stxt.dev>
- The full reference of this command: <https://stxt.dev/tools-cli>
- The parser it runs on: [`@stxt-lang/core`](https://www.npmjs.com/package/@stxt-lang/core)
- The VS Code extension: [STXT Language](https://marketplace.visualstudio.com/items?itemName=stxt-lang.stxt)

## Install

```bash
npm install -g @stxt-lang/cli      # install (Node 20 or newer)
npm update -g @stxt-lang/cli       # update
npm uninstall -g @stxt-lang/cli    # uninstall
```

```bash
stxt --version
```

```
stxt 1.0.4 (@stxt-lang/core 1.0.3, spec 2026-09-07)
```

The version line has three parts:

| Part | What it is |
|---|---|
| `stxt 1.0.4` | The version of this package |
| `@stxt-lang/core 1.0.3` | The version of the parser, which decides how documents are parsed and validated |
| `spec 2026-09-07` | The date of the STXT-SPEC text the parser implements, which decides which documents are valid |

Two installations with different package versions read the same STXT when the spec date is the same.

## Commands

| Command | What it does |
|---|---|
| `stxt validate` | Parses documents and validates them against their schemas |
| `stxt format` | Reformats documents, keeping comments and blank lines |
| `stxt describe` | Prints the canonical JSON tree of a document |
| `stxt schemas` | Shows which definitions apply to a document |
| `stxt install` | Installs a schema or a template into a `.stxt` directory |

Options use the GNU long form. There are four short aliases: `-v`/`--version`, `-h`/`--help`,
`-r`/`--recursive` and `-w`/`--write`.

**No command rewrites or deletes a file without an explicit option.**

### validate

```bash
stxt validate <file|dir|->... [--recursive|-r] [--format text|json] [--warn-schema|--no-schema]
              [--verbose]
```

```bash
stxt validate docs/report.stxt
stxt validate --recursive docs/
cat doc.stxt | stxt validate -
```

Each document is validated against the definitions of its own resolution chain (see `schemas`).
Every error is reported, not only the first one:

```
/home/ana/books/docs/book.stxt:6: [INVALID_VALUE] Published: Invalid date (October 1st, 2025) (error)
/home/ana/books/docs/book.stxt:1: [TOO_FEW_CHILDREN] 0 nodes of 'com.acme.book:isbn' and min is 1 (error)
2 error(s), 0 warning(s)
```

Each finding is `file:line: [CODE] message (error|warning)`.

| Option | What it does |
|---|---|
| `--recursive`, `-r` | Required for a directory. Validates every `*.stxt` file, and skips the `.stxt/` directories |
| `-` | Reads one document from the standard input. It is reported as `<stdin>`, and its chain starts at the current directory |
| `--warn-schema` | Schema errors are still reported, but only syntax errors affect the exit code |
| `--no-schema` | Checks only the syntax |
| `--format json` | Prints a JSON array of `{file, line, code, message, severity}`, empty when there is nothing to report |
| `--verbose` | Prints `Validating <file>` to stderr before each document. The report on stdout does not change |

- By default a schema error fails like a syntax error, because `validate` is meant for CI.
- With `--format text` (the default) nothing is printed when every document passes.
- The findings of a document are printed when it finishes, and the count closes the run. The JSON array is printed once, at the end.
- A namespace that no definition of the chain covers is `SCHEMA_NOT_FOUND`, also when the chain is empty.
- Documents without a namespace are not validated, and pass (STXT-SCHEMA-SPEC §5).

### format

```bash
stxt format <file|dir|->... [--recursive|-r] [--tabs|--spaces] [--write|-w] [--check] [--clean]
            [--verbose]
```

```bash
stxt format doc.stxt                 # prints the result, touches nothing
stxt format --write --recursive docs/
stxt format --check --recursive docs/
stxt format - < doc.stxt             # as an editor filter
```

Without an option the reformatted text is only printed to stdout.

| Option | What it does |
|---|---|
| `--write`, `-w` | Rewrites each file in place, only when it would change |
| `--check` | Writes nothing. Reports `<file>: would be reformatted`, and fails if any file would change |
| `--tabs` / `--spaces` | The indentation style: tabs (the default) or four spaces per level |
| `--clean` | Rewrites the document from its tree, which **drops every comment and every blank line** |
| `--verbose` | Prints `Formatting <file>` (`Checking <file>` with `--check`) to stderr before each document |

What the formatter does with each line:

| Line | What happens |
|---|---|
| A line that opens a node | Rewritten in canonical form |
| A line of a text block | Re-indented to the level of its block. Any indentation beyond it is content, and stays |
| A comment | Its indentation units are converted to the chosen style. Its text is kept |
| A blank line | Kept |

- `--write` and `--check` are mutually exclusive, and so are `--tabs` and `--spaces`.
- `--write` with `-` is a usage error.
- A document with a syntax error is reported and never reformatted.
- `format` does not look at schemas.
- It is the `Formatter` of `@stxt-lang/core`, the same one as the VS Code extension and the playground.

### describe

```bash
stxt describe <file|->
```

Prints the *STXT-TREE-SPEC* canonical JSON tree of one document. It does not apply schemas.

```json
[
  {
    "name": "Title",
    "canonicalName": "title",
    "namespace": "",
    "form": "inline",
    "value": "Hello",
    "children": []
  }
]
```

The outer array has every root node. `children` appears only on inline nodes, and a block has
its literal lines in `lines`.

### schemas

```bash
stxt schemas [path]
```

Lists the resolution chain for a document at `path` (or the current directory), the active
definition for each namespace, and any resolution error. It answers the question
"why is this document not being validated?".

### install

```bash
stxt install <file> [--local|--user|--system|--root <dir>] [--force] [--ignore-non-definitions]
```

Installs an `@stxt.schema` or `@stxt.template` document into the resolution chain.

| Option | Installs into |
|---|---|
| `--local` (the default) | `./.stxt` of the current project |
| `--user` | `~/.stxt` |
| `--system` | `/etc/stxt` (`%ProgramData%\stxt` on Windows) |
| `--root <dir>` | Any directory |

It does more than a copy:

- The document is validated first. It must parse, and every root node must be a definition that
  validates against its meta-schema. Otherwise nothing is installed.
- Each definition is written on its own, in canonical form, as
  `<level>/@stxt.schema/<namespace>.stxt` or `<level>/@stxt.template/<namespace>.stxt`.
  A file with several definitions is split.
- This layout is a convention of the CLI and not a rule of the language. The specification gives
  no meaning to file names inside a `.stxt` directory, so files can also be placed by hand.
- A root node that is not a definition makes the whole file fail, unless
  `--ignore-non-definitions` is given.
- `--force` is required to overwrite a definition, or to install a namespace that another file
  of that level already defines. Two definitions of one namespace in one level leave that
  namespace with no active definition.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | The command did what it was asked to do |
| `1` | The command ran, but the documents did not pass (parse or schema errors) |
| `2` | The command line was wrong: unknown option, missing argument |

## Development

```bash
git clone https://github.com/stxt-lang/stxt-cli.git
cd stxt-cli
npm install          # also builds, through the "prepare" script
npm link             # puts `stxt` on the PATH

npm run build   # clean out/ and compile src/**/*.ts -> out/**/*.js
npm run watch   # build in watch mode
npm run lint    # eslint src --ext .ts
npm test        # pretest (build + lint), then mocha over out/test/**/*.test.js
```

The parser and the schema engine are **not** in this repository. They live in
[`stxt-js`](https://github.com/stxt-lang/stxt-js), and are used here as the npm dependency
`@stxt-lang/core`. Parsing and validation bugs are fixed there.

## License

MIT, see [LICENSE](LICENSE).
