# Roadmap

Working list of goals for the `stxt` command. It is a route, not a contract: items move, split
and get dropped. Most of the raw ideas behind it come from the CLI notes in `../stxt-cms/TODO.txt`;
what is written here is the filtered version, with the reasoning kept.

Legend: **[done]** shipped · **[next]** being worked on · **[planned]** agreed, not started ·
**[open]** wanted, but a decision is still missing · **[blocked]** needs work outside this repo.

---

## 0.1.0 — Skeleton

- **[done]** TypeScript / CommonJS project mirroring `stxt-js` (same `tsconfig`, eslint, mocha).
- **[done]** `stxt` executable, `@stxt-lang/core` as the only runtime dependency.
- **[done]** `--version`, reporting the CLI version *and* the parser version.
- **[done]** `--help`, exit-code convention (`0` ok / `1` documents failed / `2` bad usage).
- **[done]** MIT license, README, this roadmap.

## 0.2.0 — Checking documents

The command that justifies the whole project: the one a CI pipeline calls.

- **[next]** `stxt check <path>...` — parse every document and validate it against the schemas
  found, reporting every error rather than stopping at the first one (`Parser.parseResult`).
- **[next]** Schema discovery: walk up from each document to the first `.stxt/` directory and
  load everything under it into a `UnifiedSchemaProvider`. This is exactly what the VSCode
  extension does in `SchemaLoader.ts`; the policy must stay identical so that the editor and the
  CLI never disagree about which schemas apply.
- **[planned]** `-r`, `--recursive` to descend into directories, picking up `*.stxt`.
- **[planned]** Human-readable diagnostics with file, line and error code; `--format json` for
  machines.
- **[open]** `--format github` (GitHub Actions annotations). Cheap to add, worth it only if the
  workflows actually get written.
- **[open]** Is `check` the right name, or should it be `validate`? The notes use both. `check`
  covers parse errors + schema errors + lint; `validate` sounds schema-only.

## 0.3.0 — Formatting

- **[planned]** `stxt format <path>...` — re-serialize through `NodeWriter`, rewriting the file
  in place.
- **[planned]** `--tabs` (default) / `--spaces-4` to pick the indent style.
- **[planned]** `--check` (also spelled `--dry-run`): do not write, exit `1` if anything would
  change. This is the CI-friendly half.
- **[open]** `--clean`: format *and* strip comments. Losing comments on a formatting run is a
  destructive default, so it must stay an explicit opt-in — and it may belong in its own command.

## 0.4.0 — Conversion

- **[planned]** `stxt parse <file>` — emit the canonical JSON tree on stdout. Needed for
  cross-implementation testing: two parsers agree if their canonical JSON matches.
- **[open]** The canonical JSON shape is not specified anywhere yet. Before implementing it, it
  has to be written down in `../stxt-web` and agreed with `../stxt-java`, otherwise each
  implementation invents its own.
- **[open]** `stxt from-json` (the reverse trip). Useful for generating STXT from other tooling;
  no concrete need yet.

## 0.5.0 — Schema paths and installation

Everything here depends on a convention that does not exist yet: where STXT looks for schemas
outside the current project.

- **[open]** Search-path model: `./.stxt` (project) → `~/.stxt` (user) → `/etc/stxt` (system),
  with `STXT_HOME` / `STXT_PATH` as overrides. **This is language-level configuration, not a CLI
  feature**: it has to be specified in `../stxt-web` and implemented in both `stxt-js` and
  `stxt-java`, so that a document validates the same way from the editor, the CLI and a Java
  program. The CLI is only the front door.
- **[planned]** `stxt install <file>` with `--local` (default) / `--user` / `--system` /
  `--root <dir>`, copying a schema or template into the matching directory. Fixed paths for the
  three named scopes; `--root` for anything else, with no magic mixing.
- **[planned]** `stxt schemas` — list the namespaces currently discovered and the file each one
  comes from. The fastest way to answer "why is my document not being validated?".
- **[planned]** `stxt compile <template>` — turn a `@stxt.template` document into the equivalent
  `@stxt.schema` document (`transformTemplateNodeToSchema`).

## Later / undecided

- **[blocked]** Transformations: `stxt2html`, `stxt2xml`, `stxt2yaml`, `stxt2toml`, `stxt2pdf`,
  and the reverse imports (`xml2stxt`, ...). This is the largest block of ideas in the notes, and
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
