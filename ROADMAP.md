# Roadmap

Working list of goals for the `stxt` command. It is a route, not a contract: items move, split
and get dropped. Most of the raw ideas behind it come from the CLI notes in `../stxt-cms/TODO.txt`;
what is written here is the filtered version, with the reasoning kept.

Legend: **[done]** shipped · **[next]** being worked on · **[planned]** agreed, not started ·
**[decided]** a settled decision, kept here for its reason · **[open]** wanted, but a decision is
still missing · **[blocked]** needs work outside this repo.

---

## 0.1.0 — Skeleton

- **[done]** TypeScript / CommonJS project mirroring `stxt-js` (same `tsconfig`, eslint, mocha).
- **[done]** `stxt` executable, `@stxt-lang/core` as the only runtime dependency.
- **[done]** `--version`, reporting the CLI version *and* the parser version.
- **[done]** `--help`, exit-code convention (`0` ok / `1` documents failed / `2` bad usage).
- **[done]** MIT license, README, this roadmap.
- **[done]** First publication to npm as `@stxt-lang/cli`. Deliberately published while it is
  still a skeleton: it makes the command name real and reserved under the `@stxt-lang` scope, and
  it exercises the whole release path once, on a version where nothing can break. Decided along
  with it: no `main` field — this package is a `bin` and importing it would execute the command —
  and `prepublishOnly: npm test`, so nothing reaches the registry without building, linting and
  passing the tests.

## 0.2.0 — Schema paths and installation

- **[decided]** Search-path model: `./.stxt` (project) → `~/.stxt` (user) → `/etc/stxt` (system),
  with `STXT_PATH` as an override that replaces the whole chain. This turned out not to need a
  separate decision: STXT-DISCOVERY-SPEC (`../stxt-web/es/stxt-discovery-ref.stxt`), written for
  `check`'s 0.3.0 groundwork, already fixes these same paths, and `NodeDiscoveryEnvironment`
  (`src/discovery/NodeDiscovery.ts`) already resolves them. `install` reuses that class instead of
  hardcoding the paths a second time, so it cannot drift from what `check` and the editor resolve.
- **[done]** `stxt install <file>` with `--local` (default) / `--user` / `--system` /
  `--root <dir>`, copying a **local** schema or template file into the matching directory. Fixed
  paths for the three named scopes; `--root` for anything else, with no magic mixing.
  Implemented in [src/command/Install.ts](src/command/Install.ts). Also took `--force`: the
  destination is never overwritten silently (AGENTS.md's "no destructive defaults" rule), so a
  pre-existing file at the target needs that flag.

  > **Note**: remote URLs (`stxt install <url>`) were considered and **discarded** for this version due to
  > security concerns (arbitrary downloads, MITM, content validation). If needed, download the file
  > manually and install it as a local path. A future official schema registry may revisit this.
- **[done]** `stxt schemas [path]` — list the namespaces currently discovered for a document at `<path>`,
  or for the current directory if no path is provided. The fastest way to answer "why is my document
  not being validated?". Implemented in [src/command/Schemas.ts](src/command/Schemas.ts): prints
  the resolution chain, the active definition per namespace (nearest level wins) and any
  `DiscoveryError` found while loading the chain. Exits `FAILURE` when there are such errors — a
  broken schema file in the chain is a real problem, even though `schemas` itself does not
  validate any document. Needing this command to await `DiscoveryResolver.resolve()` is what made
  `run()` (`src/runtime/Cli.ts`) async; every command dispatched from it may now return a
  `Promise<ExitCode>`, which `check` will need too.

## 0.3.0 — Checking documents

The command that justifies the whole project: the one a CI pipeline calls.

- **[decided]** The command is called `check`, not `validate`. It covers parse errors, schema
  errors and, later, lint: one verb for "tell me whether this is right". `validate` reads as
  schema-only and would leave syntax errors without a command of their own.
- **[done]** `stxt check <file|dir>...` — parse every document and validate it against the schemas
  found, reporting every error rather than stopping at the first one (`Parser.parseResult`).
  Implemented in [src/command/Check.ts](src/command/Check.ts).
- **[done]** Schema discovery. It is now **specified** — STXT-DISCOVERY-SPEC,
  `../stxt-web/es/stxt-discovery-ref.stxt` (2026-08-02), which replaced the old informal rule
  ("stop at the first `.stxt/`", copied from the extension) with the full chain: *every*
  ancestor `.stxt/` from the document's directory (nearest first), then `$HOME/.stxt`, then
  `/etc/stxt` (`%USERPROFILE%\.stxt` / `%ProgramData%\stxt` on Windows), `STXT_PATH` replacing
  the whole chain, precedence **per namespace** (nearest level wins), same-level duplicates as
  errors. The reference implementation is `DiscoveryResolver` in `@stxt-lang/core` 0.6.0
  (`../stxt-js/src/discovery/`), host-agnostic over injected interfaces; this repo contributes
  only the Node adapters, in [src/discovery/NodeDiscovery.ts](src/discovery/NodeDiscovery.ts)
  (`createDiscoveryResolver()` is what `check` should call). The editor consumes the same
  resolver, so CLI and editor can no longer disagree by construction.
- **[decided]** With several paths on one command line: resolution is **per document**
  (STXT-DISCOVERY-SPEC section 7). `DiscoveryResolver` caches loaded levels, so resolving many
  documents that share a project loads each `.stxt/` once; sharing beyond that must not change
  any document's outcome. One resolver per invocation, one `resolve()` per document.
- **[decided]** Exit-code contract for schema errors: **a schema (validation) error fails the
  build by default**, exactly like a syntax error — `check` is meant for CI, and a document that
  violates its own declared schema is not a passing document. Two explicit opt-outs, since a
  flat yes/no turned out not to be enough:
  - `--warn-schema`: schema errors are still parsed, resolved and reported, but do not affect the
    exit code (only syntax errors do). This is the editor's own severity split
    (`ParseException` as an error, `ValidationException` as a warning), offered as an opt-in
    rather than the CLI default.
  - `--no-schema`: skips schema discovery and validation entirely — no `DiscoveryResolver` call
    is even made — checking only the base-language grammar. For a document (or a whole codebase)
    that has no interest in the schema layer at all.
  The two are mutually exclusive (a usage error otherwise); neither is a repeat of the other,
  which is why both exist instead of a single boolean.
- **[done]** Do not report `SCHEMA_NOT_FOUND` when no schema was loaded at all. Schemas are an
  optional layer (STXT-SPEC §15, §17.2), so a document with a namespace and no schemas anywhere
  is not wrong, just unvalidatable — same rule the VSCode extension applies (`AnalysisDoc.ts`,
  `hasSchemas`), checked per document (a namespace with no matching schema when at least one
  schema *is* loaded somewhere in the chain still reports `SCHEMA_NOT_FOUND` — only a chain with
  zero active definitions at all suppresses it).
- **[done]** Documents whose namespace is `@stxt.schema` or `@stxt.template` get checked as
  schemas too, by running them through `transformNodeToSchema` /
  `transformTemplateNodeToSchema` and catching the thrown `ValidationException` (a subclass of
  `ParseException`). Otherwise `check` would pass a broken schema just because it has no schema
  of its own to be validated against. Implemented in `checkAsDefinition()`
  ([src/command/Check.ts](src/command/Check.ts)), run per root node after the ordinary
  parse/validate pass. Governed by the same `SchemaMode` as everything else in the schema layer:
  skipped entirely by `--no-schema`, downgraded to a warning by `--warn-schema`.
- **[done]** Report the `DiscoveryError`s found while loading a document's resolution chain
  (broken schema files, duplicate namespaces) as part of `check`'s own output, the way `schemas`
  already does. Each becomes a `Finding` naming the *offending definition's own file* (not the
  document being checked) at line `0`, since a resolution error is not tied to a line of the
  document; same `SchemaMode` treatment as above. Not deduplicated across several documents that
  share the same broken file in their chain (e.g. a `--recursive` run): each document reports the
  errors of its own chain, which is the simplest rule and matches "one `resolve()` per document"
  above — revisit if the repetition turns out to be noisy in practice.
- **[done]** `--recursive`, with the `-r` alias — one of the three near-universal short aliases
  allowed once AGENTS.md's "one option spelling only" rule was relaxed to permit them (`-v`, `-h`,
  `-r`; see the cross-cutting item below). A directory given without `--recursive`/`-r` is a
  usage error naming the flag, rather than silently checking nothing or only its top level.
  Recursion skips `.stxt/` directories: they are the resolution chain itself (schema/template
  definitions), not documents to check, and every real project has one.
- **[done]** Human-readable diagnostics with file, line and error code (`--format text`, the
  default: `file:line: [CODE] message (error|warning)`, plus a summary line); `--format json` for
  machines (a single JSON array of `{file, line, code, message, severity}`, always printed even
  when empty).
- **[open]** `--format github` (GitHub Actions annotations). Cheap to add, worth it only if the
  workflows actually get written.

## 0.4.0 — Formatting

- **[done]** `stxt format <file|dir>... [--recursive] [--tabs|--spaces-4] [--write|--check]`,
  re-serializing through `NodeWriter` ([src/command/Format.ts](src/command/Format.ts)). Reuses
  `collectStxtFiles` ([src/runtime/StxtFiles.ts](src/runtime/StxtFiles.ts)), extracted out of
  `check`'s own directory-walking code once `format` needed the exact same "descend, skip
  `.stxt/`, list `*.stxt`" logic — the first case where sharing that code across commands was
  actually worth it, since here it is a byte-for-byte identical algorithm, not just a similar one.
- **[decided]** No destructive default (AGENTS.md): without a flag, `format` only **prints** the
  reformatted text to stdout and touches nothing on disk — it reverses what the original
  ROADMAP note for this version said ("rewriting the file in place" by default), which turned out
  to conflict with that rule once it came time to implement it. `--write`/`-w` is the explicit
  flag that rewrites a file in place (only when it would actually change; silent otherwise).
  `--check` (no `--dry-run` spelling — one spelling per option, as everywhere else) is the
  CI-friendly middle ground: writes nothing, reports which files would change
  (`<file>: would be reformatted`) and fails the build if any would, the same idea as
  `gofmt -l`/`prettier --check`. `--write` and `--check` are mutually exclusive.
- **[done]** `--tabs` (default) / `--spaces-4` to pick the indent style, mutually exclusive.
- **[decided]** A document with a syntax error is never reformatted, in any mode (its parse tree
  may be incomplete) — it is reported the same way `check` reports a syntax error, and always
  fails the build. `format` does not look at schemas at all: it has no `SchemaMode`, no
  `--warn-schema`/`--no-schema`, since re-serializing a tree has nothing to do with whether it
  validates against one.
- **[open]** `--clean`: format *and* strip comments. Losing comments on a formatting run is a
  destructive default, so it must stay an explicit opt-in — and it may belong in its own command.

## 0.5.0 — Conversion

- **[planned]** `stxt parse <file>` — emit the canonical JSON tree on stdout. Needed for
  cross-implementation testing: two parsers agree if their canonical JSON matches.
- **[open]** The canonical JSON shape is not specified anywhere yet. Before implementing it, it
  has to be written down in `../stxt-web` and agreed with `../stxt-java`, otherwise each
  implementation invents its own.
- **[open]** `stxt from-json` (the reverse trip). Useful for generating STXT from other tooling;
  no concrete need yet.
- **[planned]** `stxt compile <template>` — turn a `@stxt.template` document into the equivalent
  `@stxt.schema` document (`transformTemplateNodeToSchema`).

## Later / undecided

- **[rejected]** `stxt install <url>` — remote URL support for `install`. Discarded due to security
  risks (arbitrary downloads, MITM attacks, content validation complexity). Use manual download +
  `stxt install <file>` instead. A future **official schema registry** (with HTTPS, checksums, and signed
  artefacts) could revisit this, but it is out of scope for this CLI.
- **[blocked]** Transformations: `stxt2html`, `stxt2xml`, `stxt2yaml`, `stxt2toml`, `stxt2pdf`, This is the largest block of ideas in the notes, and
  none of it can start here: it needs a transformation language (`@stxt.transform` / `@stxt.t2`)
  specified in `../stxt-web` and implemented in `stxt-js` first. `@stxt.slots` was the earlier
  attempt and is on hold as too verbose.
- **[blocked]** `stxt2stxt` as a **migration** tool (`org.example.docs` → `org.example.docs.v2`).
  Same blocker, but it is arguably the most valuable transformation of the whole set, because
  nothing else can migrate documents when a schema evolves.
- **[open]** Documentation generator: schema → HTML reference tables (the OpenAPI/Swagger idea).
  Fits the CLI well, but only once schemas carry descriptions.
- **[open]** Semantic linter on top of the validator: empty nodes, ambiguous names, node order.
- **[rejected for now]** "`stxt file.stxt` with no verb does everything it can" (validate,
  convert to every available target, import schemas). It reads well in notes, but a command whose
  behaviour depends on what happens to be installed is not scriptable and cannot have a stable
  exit code. The explicit verb stays mandatory; a bare path may later be sugar for `stxt check`.
- **[open]** Java parity: `stxt-java` has no CLI. If it ever gets one, this repository is the
  reference for the command names and exit codes, the same way `stxt-web` is the reference for
  the language.

## Cross-cutting, whenever it becomes relevant

- **[decided]** Short option aliases: allowed, but only for the handful where a single letter is
  a near-universal Unix convention — `-v`/`--version`, `-h`/`--help`, `-r`/`--recursive`,
  `-w`/`--write` (`format`, 0.4.0; confirmed with the user before implementing, per the "nothing
  invented without asking" rule below) — each exactly one letter, nothing else without asking
  first. Reverses the original "one option spelling only, GNU long form" rule (AGENTS.md), which
  turned out to be fighting a convention users already expect rather than avoiding real
  ambiguity. Adding `-r` exposed a latent gap in every command's own argument parsing: an
  unrecognized *single*-dash option used to be silently treated as a positional argument instead
  of a usage error, because each `parseArgs` only checked for the `--` prefix. Fixed in
  `Install.ts`, `Schemas.ts` and `Check.ts` alike (and built into `Format.ts` from the start),
  with a test per command.
- **[open]** Colour output, and turning it off (`--no-color`, `NO_COLOR`, non-TTY detection).
- **[open]** Reading from stdin (`stxt check -`) for editor and pipe integration.
- **[open]** Publishing to npm, and whether the version tracks `@stxt-lang/core` or moves on its
  own. Current decision: **its own version line**, starting at 0.1.0 — the "same number, same
  behaviour" rule binds the two language implementations, and the CLI is not one of them.
- **[open]** `.github/workflows` for build + test on push (needs a token that allows workflows).
- **[open]** Revisit the `prepare: npm run build` script. Installing the published package prints
  an npm `allow-scripts` warning about it, which is noise for anyone with a strict script policy.
  Nothing is broken: `prepare` does not run when the package is installed as a dependency — only
  on `npm install` inside the project, on installs straight from git, and before publishing — and
  it was verified that a clean install of the 0.1.0 tarball never executes it. It is kept because
  it is what compiles a fresh clone, and `stxt-js` publishes with the same script. Worth revisiting
  if the warning ever becomes a real obstacle for users.
