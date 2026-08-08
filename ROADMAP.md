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
- **[planned]** `stxt schemas [path]` — list the namespaces currently discovered for a document at `<path>`,
  or for the current directory if no path is provided. The fastest way to answer "why is my document
  not being validated?".

## 0.3.0 — Checking documents

The command that justifies the whole project: the one a CI pipeline calls.

- **[decided]** The command is called `check`, not `validate`. It covers parse errors, schema
  errors and, later, lint: one verb for "tell me whether this is right". `validate` reads as
  schema-only and would leave syntax errors without a command of their own.
- **[next]** `stxt check <file|dir>...` — parse every document and validate it against the schemas
  found, reporting every error rather than stopping at the first one (`Parser.parseResult`).
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
- **[open]** Exit-code contract for schema errors. The editor reports `ParseException` as an
  error and `ValidationException` as a warning; the CLI has to turn that distinction into an exit
  code, and whether a schema violation alone is enough to fail a build is still to be decided.
- **[planned]** Do not report `SCHEMA_NOT_FOUND` when no schema was loaded at all. Schemas are an
  optional layer (STXT-SPEC §15, §17.2), so a document with a namespace and no schemas anywhere
  is not wrong, just unvalidatable — the editor already skips that case, and without the same
  rule every project without a `.stxt/` would fail `check`.
- **[planned]** Documents whose namespace is `@stxt.schema` or `@stxt.template` get checked as
  schemas too, by running them through `transformNodeToSchema` /
  `transformTemplateNodeToSchema` and catching the `ParseException`. Otherwise `check` would pass
  a broken schema.
- **[planned]** `-r`, `--recursive` to descend into directories, picking up `*.stxt`.
- **[planned]** Human-readable diagnostics with file, line and error code; `--format json` for
  machines.
- **[open]** `--format github` (GitHub Actions annotations). Cheap to add, worth it only if the
  workflows actually get written.

## 0.4.0 — Formatting

- **[planned]** `stxt format <file|dir>...` — re-serialize through `NodeWriter`, rewriting the file
  in place.
- **[planned]** `--tabs` (default) / `--spaces-4` to pick the indent style.
- **[planned]** `--check` (also spelled `--dry-run`): do not write, exit `1` if anything would
  change. This is the CI-friendly half.
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
