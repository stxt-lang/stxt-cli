# Agent Instructions — stxt-cli

See [CLAUDE.md](CLAUDE.md) for the full project context, architecture decisions, and roadmap
summary. The notes below are the directives that most affect agent behavior.

## Build and Test

```bash
npm run build   # tsc: src/ → out/ (strict, noEmitOnError — type errors fail the build)
npm run lint    # eslint src --ext .ts
npm test        # pretest (build + lint) then mocha out/test/**/*.test.js
```

Current baseline: **63 tests passing** (7 CLI + 9 discovery + 14 install + 9 schemas + 24 check).

## Hard Rules

- **Never commit, push, tag, or publish.** The user reviews and runs all git/npm operations.
- **No parser changes here.** Parser, schema, and validation logic lives in `../stxt-js`
  (`@stxt-lang/core`). If a CLI feature seems to require a parser change, make it there first.
- **One long spelling per option, GNU form** (`--version`), plus a short alias only for the
  handful of options where a single letter is a near-universal Unix convention: `-v`/`--version`,
  `-h`/`--help`, `-r`/`--recursive`. No single-dash long forms (`-version`), no aliases invented
  for anything else (`--local`, `--force`, `--format`, ...) without asking first. Unknown
  spellings are usage errors; there are tests for this.
- **No destructive defaults.** Any file-rewriting behaviour needs an explicit flag.

## Architecture in One Paragraph

`src/cli.ts` is the shebang entry point; it calls `run()` from `src/runtime/Cli.ts`, which
dispatches commands and returns an `ExitCode` (0 ok / 1 document error / 2 bad usage). All output
goes through the `CliIO` interface — never `console` — so tests call `run()` with a capturing IO
instead of spawning a process. Discovery adapters live in `src/discovery/NodeDiscovery.ts`; they
wrap `@stxt-lang/core`'s `DiscoveryResolver` with injectable `fs`/`process`/`os` defaults for
testability. `src/command/` holds one file per document command (`Install.ts`, `Schemas.ts`,
`Check.ts`), dispatched from `Cli.ts`'s `COMMANDS` table.

## What Is Next

0.1.0 and 0.2.0 (`install`, `schemas`) are published. 0.3.0's `check` is committed and pushed to
`master`, not yet released (`package.json` is still at 0.2.0 — the version bump, tag and publish
are the user's own next step) — see [ROADMAP.md](ROADMAP.md) for what is still `[planned]`/
`[open]` there (checking `@stxt.schema`/`@stxt.template` documents as schemas, surfacing a
chain's own `DiscoveryError`s through `check`, `--format github`) before moving on to `format`
(0.4.0).

## Conventions

- All user-facing text (code, comments, JSDoc, error messages) is in **English**.
  Conversations with the user are in Spanish; the repository is not.
- Every exported member has a JSDoc summary line plus `@param`/`@returns`.
- Tests live in `src/test/*.test.ts`, compiled to `out/test/`, and use mocha `describe`/`it`.
- The version is never hardcoded in source — `npm version` is the only place to change it.
