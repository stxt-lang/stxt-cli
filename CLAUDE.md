# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

The official **command-line interface for STXT**, an indentation-based structured-text format:
the `stxt` command, written in TypeScript for Node, published to npm as **`@stxt-lang/cli`**.
It compiles via `tsc` to plain CommonJS in `out/`, and `package.json`'s `bin` maps `stxt` to
`out/cli.js`.

**This repository contains no parser.** It is a front end over `@stxt-lang/core`, its single
runtime dependency. Everything about how a document is parsed, validated or serialized lives in
the sibling repo `../stxt-js`; a bug in any of that is fixed there, published, and consumed here
by bumping the dependency range. If a CLI feature seems to need a parser change, make the change
in `../stxt-js` (it is writable from here), run its `npm test`, and only then wire it up here.

### The sibling repositories

- **`../stxt-web`** — the normative language spec, written in STXT itself. Canonical Spanish in
  `es/`, English mirror in `en/`. **The spec has authority over every implementation, including
  this one.**
  - `es/stxt-core-ref.stxt` — base syntax (STXT-SPEC): indentation, inline nodes, text blocks,
    namespaces, comments, normalization, error codes.
  - `es/stxt-schema-ref.stxt` — `@stxt.schema` (STXT-SCHEMA-SPEC): `Node`/`Children`/`Child`,
    types, cardinalities, and the official meta-schema.
  - `es/stxt-template-ref.stxt` — `@stxt.template` (STXT-TEMPLATE-SPEC): the simplified authoring
    form that compiles to a schema.
- **`../stxt-js`** — the TypeScript implementation, published as `@stxt-lang/core`. Its public
  surface is `src/all.ts` and nothing else: `Parser`, `ParseResult`, `Node`, `Line`, `Constants`,
  `parseLine`, `StringUtils`, `ParseException`, `ValidationException`, `Observer`, `Schema`,
  `SchemaValidator`, `SchemaProvider`, `NodeDefinition`, `ChildDefinition`, `transformNodeToSchema`,
  `UnifiedSchemaProvider`, `ConditionalValidator`, `NodeWriter`, `IndentStyle`,
  `transformTemplateNodeToSchema`, and — since 0.6.0 — the discovery layer: `DiscoveryResolver`,
  `DiscoveryOptions`, `DiscoveryResult`, `DiscoveryDefinition`, `DiscoveryLevel`,
  `DiscoveryError`, `DiscoveryFileSystem`, `DiscoveryEntry`, `DiscoveryEnvironment`. If this CLI
  needs something that is not on that list, the fix is to export it there, with JSDoc — not to
  reach into `@stxt-lang/core/out/...`.
- **`../stxt-java`** — the Java implementation (`dev.stxt:stxt-core`), kept behaviour-compatible
  with `stxt-js` under the same version number. It has **no CLI**; if it ever gets one, this
  repository is the reference for command names and exit codes.
- **`../stxt-vscode`** — the VSCode extension. Also a pure consumer of `@stxt-lang/core`. Schema
  discovery is **specified** (STXT-DISCOVERY-SPEC, `../stxt-web/es/stxt-discovery-ref.stxt`) and
  implemented once, as `DiscoveryResolver` in `@stxt-lang/core` 0.6.0; both the extension and
  this CLI consume that same resolver through host adapters (here,
  `src/discovery/NodeDiscovery.ts`, whose `createDiscoveryResolver()` is what `check` should
  call), so editor and command line agree by construction about which schemas apply.
- **`../stxt-cms`** — unrelated codebase, but its `TODO.txt` is where the user's scattered ideas
  for the CLI live. [ROADMAP.md](ROADMAP.md) is the filtered version of those notes.

## Current state (as of 2026-08-08)

Version **0.1.0**, the skeleton, published to npm on 2026-08-02 and tagged in git as `v0.1.0`
(GPG-signed, pushed to `origin`). `stxt --version` and `stxt --help` work; there is no document
command yet. Every published version gets a signed tag — see [help.txt](help.txt) for the exact
commands.

**0.2.0** (schema search paths: `install`, `schemas`) has not been started — it is still waiting
on the `[open]` search-path model decision in [ROADMAP.md](ROADMAP.md), which is language-level
and belongs in `../stxt-web` before either `stxt-js` or this CLI can implement it.

Work has instead moved ahead on the groundwork for **0.3.0** (`check`), already committed and
pushed:

- The dependency moved to `@stxt-lang/core` **^0.6.0**, the release that added the discovery
  layer that `check` depends on.
- `src/discovery/NodeDiscovery.ts` landed: the Node adapters over that layer, plus
  `src/test/discovery.test.ts`. `npm test` is 16 passing (7 CLI + 9 discovery).
- Still missing for 0.3.0: the `check` command itself, and therefore `src/command/`.

See [ROADMAP.md](ROADMAP.md), which is the live list of goals and the place to record decisions as
they are taken.

## How work is done here

- **The user makes every commit, always.** Never run `git commit`, `git push` or `git tag`; do not
  offer to. He reviews what goes in — if only by volume — before it is uploaded, and that review
  is the point. Leave the work in the working tree and say what changed.
- The same applies to publishing: `npm publish` is his call, not something to run or suggest
  mid-task.
- [ROADMAP.md](ROADMAP.md) is the shared route. When a decision is taken (a command name, a flag,
  something rejected), record it there with its reason, and move the item's status. An item that
  turns out to belong to the language rather than the CLI gets marked as blocked on `../stxt-web`
  and `../stxt-js` rather than half-implemented here.

## Commands

```bash
npm run build   # tsc: src/**/*.ts -> out/**/*.js (+ .d.ts + sourcemaps)
npm run watch   # build in watch mode
npm run lint    # eslint src --ext .ts
npm test        # pretest (build + lint), then mocha over out/test/**/*.test.js
node out/cli.js --version   # run the built CLI without installing it
```

`tsconfig.json` has `strict` + `noEmitOnError`, so type errors fail the build. The `npm audit`
warnings all come from mocha's dependency tree (dev only).

## Architecture

Deliberately small, and organized so that adding a command does not touch the entry point.

- [src/cli.ts](src/cli.ts) — the `bin` entry: shebang, EPIPE guard, and one call to `run()`. It
  sets `process.exitCode` rather than calling `process.exit()`, so Node flushes stdout before
  terminating. The EPIPE guard is what keeps `stxt ... | head` from printing a stack trace.
- [src/runtime/Cli.ts](src/runtime/Cli.ts) — argument dispatch. `run(args, io)` returns an exit
  code and never touches `console` directly: all output goes through the `CliIO` interface, which
  is what makes the commands testable without spawning a process.
- [src/runtime/ExitCode.ts](src/runtime/ExitCode.ts) — the exit-code contract: `0` ok, `1` the
  documents failed, `2` the invocation was wrong. The `1` / `2` split is the point: a CI job must
  be able to tell a document error from a broken command line.
- [src/runtime/PackageInfo.ts](src/runtime/PackageInfo.ts) — reads the version out of
  `package.json` at runtime (own version, and `@stxt-lang/core`'s via `require.resolve`). **The
  version is never written in the source**, so `npm version` is enough to bump it.
- [src/discovery/NodeDiscovery.ts](src/discovery/NodeDiscovery.ts) — the host adapters that let
  the core `DiscoveryResolver` run in a Node process: `NodeDiscoveryFileSystem` over `node:fs`,
  `NodeDiscoveryEnvironment` over `process.env` / `os.homedir()`, and `createDiscoveryResolver()`,
  which is what a command calls. **No discovery policy lives here** — the chain, the precedence
  and the duplicate rules are all in `@stxt-lang/core`; this file only answers "what is on disk".
  Every constructor parameter has a `process`/`os` default so the tests can inject a fake
  environment instead of mutating the real one.
- `src/command/` — does not exist yet; it is where one file per document command goes once
  `check` lands. The dispatcher in `Cli.ts` grows a table pointing at them.

## Conventions

- **Everything user-facing is in English**: source comments, JSDoc, README, roadmap, help text
  and error messages. This matches `../stxt-js` since its 0.5.3. (Conversations with the user are
  in Spanish; the repository is not.) The one exception is [help.txt](help.txt), the user's own
  npm cheat-sheet, which is in Spanish here and in `../stxt-js` — keep it that way.
- Every exported member carries a JSDoc comment: a summary sentence plus `@param`/`@returns`.
- **Every option has exactly one spelling**, the GNU long form (`--version`). No single-dash long
  form (`-version`), no short aliases (`-v`), no synonyms — an unknown spelling is a usage error,
  and there is a test asserting it. The user asked for the most standard surface possible and
  explicitly does not want fallbacks; do not add an alias without asking.
- Tests are mocha `describe`/`it` suites under `src/test/*.test.ts`, compiled alongside the code
  and run from `out/test`. Commands are tested by calling `run()` with a capturing `CliIO`, not by
  spawning the binary.
- Anything destructive (rewriting files in place, deleting comments) needs an explicit flag; no
  destructive defaults.
