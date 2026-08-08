# Agent Instructions — stxt-cli

See [CLAUDE.md](CLAUDE.md) for the full project context, architecture decisions, and roadmap
summary. The notes below are the directives that most affect agent behavior.

## Build and Test

```bash
npm run build   # tsc: src/ → out/ (strict, noEmitOnError — type errors fail the build)
npm run lint    # eslint src --ext .ts
npm test        # pretest (build + lint) then mocha out/test/**/*.test.js
```

Current baseline: **16 tests passing** (7 CLI + 9 discovery).

## Hard Rules

- **Never commit, push, tag, or publish.** The user reviews and runs all git/npm operations.
- **No parser changes here.** Parser, schema, and validation logic lives in `../stxt-js`
  (`@stxt-lang/core`). If a CLI feature seems to require a parser change, make it there first.
- **One option spelling only** — GNU long form (`--version`). No short aliases (`-v`), no
  single-dash forms (`-version`). Unknown spellings are usage errors; there is a test for this.
- **No destructive defaults.** Any file-rewriting behaviour needs an explicit flag.

## Architecture in One Paragraph

`src/cli.ts` is the shebang entry point; it calls `run()` from `src/runtime/Cli.ts`, which
dispatches commands and returns an `ExitCode` (0 ok / 1 document error / 2 bad usage). All output
goes through the `CliIO` interface — never `console` — so tests call `run()` with a capturing IO
instead of spawning a process. Discovery adapters live in `src/discovery/NodeDiscovery.ts`; they
wrap `@stxt-lang/core`'s `DiscoveryResolver` with injectable `fs`/`process`/`os` defaults for
testability. `src/command/` does not exist yet — that is where the `check` command lands.

## What Is Next

The immediate task is `stxt check <file|dir>...` (0.3.0). See [ROADMAP.md](ROADMAP.md) for
open decisions (exit-code contract for schema errors, `SCHEMA_NOT_FOUND` suppression, etc.)
that must be resolved before the command is complete.

## Conventions

- All user-facing text (code, comments, JSDoc, error messages) is in **English**.
  Conversations with the user are in Spanish; the repository is not.
- Every exported member has a JSDoc summary line plus `@param`/`@returns`.
- Tests live in `src/test/*.test.ts`, compiled to `out/test/`, and use mocha `describe`/`it`.
- The version is never hardcoded in source — `npm version` is the only place to change it.
