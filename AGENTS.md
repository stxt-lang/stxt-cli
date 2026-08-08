# Agent Instructions — stxt-cli

See [CLAUDE.md](CLAUDE.md) for the full project context, architecture decisions, and roadmap
summary. The notes below are the directives that most affect agent behavior.

## Build and Test

```bash
npm run build   # tsc: src/ → out/ (strict, noEmitOnError — type errors fail the build)
npm run lint    # eslint src --ext .ts
npm test        # pretest (build + lint) then mocha out/test/**/*.test.js
```

Current baseline: **90 tests passing** (7 CLI + 9 discovery + 14 install + 9 schemas + 32 check +
19 format).

## Hard Rules

- **Never commit, push, tag, or publish.** The user reviews and runs all git/npm operations.
- **No parser changes here.** Parser, schema, and validation logic lives in `../stxt-js`
  (`@stxt-lang/core`). If a CLI feature seems to require a parser change, make it there first.
- **One long spelling per option, GNU form** (`--version`), plus a short alias only for the
  handful of options where a single letter is a near-universal Unix convention: `-v`/`--version`,
  `-h`/`--help`, `-r`/`--recursive`, `-w`/`--write`. No single-dash long forms (`-version`), no
  aliases invented for anything else (`--local`, `--force`, `--format`, ...) without asking
  first. Unknown spellings are usage errors; there are tests for this.
- **No destructive defaults.** Any file-rewriting behaviour needs an explicit flag.

## Architecture in One Paragraph

`src/cli.ts` is the shebang entry point; it calls `run()` from `src/runtime/Cli.ts`, which
dispatches commands and returns an `ExitCode` (0 ok / 1 document error / 2 bad usage). All output
goes through the `CliIO` interface — never `console` — so tests call `run()` with a capturing IO
instead of spawning a process. Discovery adapters live in `src/discovery/NodeDiscovery.ts`; they
wrap `@stxt-lang/core`'s `DiscoveryResolver` with injectable `fs`/`process`/`os` defaults for
testability. `src/command/` holds one file per document command (`Install.ts`, `Schemas.ts`,
`Check.ts`, `Format.ts`), dispatched from `Cli.ts`'s `COMMANDS` table. `src/runtime/StxtFiles.ts`
holds `collectStxtFiles()`, the directory-walking logic shared by `check` and `format` (descend,
skip `.stxt/`, list `*.stxt`, name-sorted).

## What Is Next

0.1.0 through 0.4.0 (`install`, `schemas`, `check`, `format`) are implemented; 0.1.0–0.3.1 are
published, `package.json` is now at **0.4.0** (`npm version 0.4.0 --no-git-tag-version` already
run) — the commit, the signed tag and `npm publish` are the user's own next step, same as every
release so far. `--format github` for `check` and `--clean` for `format` are still `[open]` in
[ROADMAP.md](ROADMAP.md) — worth revisiting, but not blocking. Next in the roadmap is 0.5.0
(`parse`/`from-json`/`compile`), blocked on the canonical JSON shape being specified in
`../stxt-web` first.

## Conventions

- All user-facing text (code, comments, JSDoc, error messages) is in **English**.
  Conversations with the user are in Spanish; the repository is not.
- Every exported member has a JSDoc summary line plus `@param`/`@returns`.
- Tests live in `src/test/*.test.ts`, compiled to `out/test/`, and use mocha `describe`/`it`.
- The version is never hardcoded in source — `npm version` is the only place to change it.
