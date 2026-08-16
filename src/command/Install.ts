/**
 * Implementation of `stxt install <file> [--local|--user|--system|--root <dir>] [--force]
 * [--ignore-non-definitions]`.
 *
 * `install` is deliberately more than a copy — copying a file is something anybody can do by
 * hand. It validates the document first, and only then writes it into the resolution chain
 * (STXT-DISCOVERY-SPEC), already normalized and already placed where it belongs:
 *
 * 1. The source must parse, and every root node must be a definition (`@stxt.schema` or
 *    `@stxt.template`) that validates against its meta-schema. A half-valid file installs
 *    nothing at all — every check runs before anything is written.
 * 2. Each definition is written on its own, in canonical form (`NodeWriter`, the same output
 *    `format --clean` produces), as `<level>/@stxt.schema/<namespace>.stxt` or
 *    `<level>/@stxt.template/<namespace>.stxt`. The spec gives no meaning to file names or
 *    subdirectories (section 3), so this naming is this CLI's convention, not a rule of the
 *    language: it makes a level self-explanatory and turns a namespace clash into a path clash.
 *    A source file holding several definitions is therefore split, one file per definition.
 *
 * The three named scopes reuse {@link NodeDiscoveryEnvironment}, the same source of truth
 * `validate` will use to read the chain back, so `install` and discovery can never disagree about
 * a path.
 *
 * Remote URLs are out of scope by design (decided for 0.2.0): only a local file is accepted.
 */

import * as fs from "fs";
import * as path from "path";
import {
    IndentStyle, Node, NodeWriter, Parser, Schema, SchemaValidator, UnifiedSchemaProvider,
    transformNodeToSchema, transformTemplateNodeToSchema,
} from "@stxt-lang/core";
import { CliIO } from "../runtime/Cli";
import { ExitCode } from "../runtime/ExitCode";
import { NodeDiscoveryEnvironment } from "../discovery/NodeDiscovery";

const LOCAL_FLAG = "--local";
const USER_FLAG = "--user";
const SYSTEM_FLAG = "--system";
const ROOT_FLAG = "--root";
const FORCE_FLAG = "--force";
const IGNORE_FLAG = "--ignore-non-definitions";

const SCHEMA_NAMESPACE = "@stxt.schema";
const TEMPLATE_NAMESPACE = "@stxt.template";
const STXT_EXTENSION = ".stxt";

// A namespace is ASCII `a.b[.c...]` with an optional leading `@` (STXT-SPEC 7.1). It is checked
// again here because it comes from the parsed document and ends up inside a file path.
const NAMESPACE_PATTERN = /^@?[a-z0-9]+(\.[a-z0-9]+)+$/;

/** A definition found in the source file, and where it is to be installed. */
interface Definition {
    /** The reserved namespace the definition is written in: `@stxt.schema` or `@stxt.template`. */
    kind: string;

    /** The namespace the definition applies to. */
    namespace: string;

    /** The root node of the definition, to be written in canonical form. */
    node: Node;

    /** Absolute path the definition is to be written to. */
    destination: string;
}

/** The named installation scopes; `root` carries the directory given after `--root`. */
type Scope =
    | { kind: "local" }
    | { kind: "user" }
    | { kind: "system" }
    | { kind: "root"; dir: string };

/**
 * Dependencies {@link runInstall} needs beyond argument parsing, all with production defaults so
 * that tests can point `--local` and `--user`/`--system` at a temporary directory instead of the
 * real project and machine.
 */
export interface InstallDependencies {
    /** Working directory `--local` installs into (as `<cwd>/.stxt`). Defaults to `process.cwd()`. */
    cwd?: string;

    /** Source of the user- and system-level directories. Defaults to a real {@link NodeDiscoveryEnvironment}. */
    environment?: Pick<NodeDiscoveryEnvironment, "getUserLevelDir" | "getSystemLevelDir">;
}

/**
 * Runs `install`.
 *
 * @param args arguments after `install`: the file to install, and any of `--local`, `--user`,
 *             `--system`, `--root <dir>` (at most one; `--local` is the default), `--force` and
 *             `--ignore-non-definitions`.
 * @param io where to report the outcome.
 * @param deps injectable dependencies; see {@link InstallDependencies}.
 * @returns `OK` once every definition is written, `USAGE` when the invocation is wrong,
 *          `FAILURE` when the invocation is fine but nothing can be installed (missing or
 *          invalid source, unresolvable or unwritable destination, a destination or a namespace
 *          already taken without `--force`).
 */
export function runInstall(args: string[], io: CliIO, deps: InstallDependencies = {}): ExitCode {
    const cwd = deps.cwd ?? process.cwd();
    const environment = deps.environment ?? new NodeDiscoveryEnvironment();

    const parsed = parseArgs(args, io);
    if (parsed === null) {
        return ExitCode.USAGE;
    }

    const { file, scope, force, ignoreNonDefinitions } = parsed;

    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        io.err(`stxt install: not a file: ${file}`);
        return ExitCode.FAILURE;
    }

    if (!file.endsWith(STXT_EXTENSION)) {
        io.err(`stxt install: not an STXT document (${STXT_EXTENSION} expected): ${file}`);
        return ExitCode.FAILURE;
    }

    const targetDir = resolveTargetDir(scope, cwd, environment);
    if (targetDir === null) {
        io.err("stxt install: cannot determine the system directory (ProgramData is not set)");
        return ExitCode.FAILURE;
    }

    const definitions = readDefinitions(file, targetDir, ignoreNonDefinitions, io);
    if (definitions === null) {
        return ExitCode.FAILURE;
    }

    if (!force && !destinationsAreFree(definitions, targetDir, io)) {
        return ExitCode.FAILURE;
    }

    for (const definition of definitions) {
        try {
            fs.mkdirSync(path.dirname(definition.destination), { recursive: true });
            fs.writeFileSync(definition.destination, NodeWriter.toSTXT(definition.node, IndentStyle.TABS), "utf-8");
        } catch (error) {
            io.err(`stxt install: cannot write ${definition.destination}: ${(error as Error).message}`);
            return ExitCode.FAILURE;
        }

        io.out(`Installed ${definition.namespace} (${definition.kind}) to ${definition.destination}`);
    }

    return ExitCode.OK;
}

/** The result of successfully parsing the arguments of `install`. */
interface ParsedArgs {
    file: string;
    scope: Scope;
    force: boolean;
    ignoreNonDefinitions: boolean;
}

/**
 * Parses the arguments of `install`, reporting usage errors on `io`.
 *
 * @param args arguments after `install`.
 * @param io where to report a usage error.
 * @returns the parsed arguments, or null when the invocation is wrong (already reported).
 */
function parseArgs(args: string[], io: CliIO): ParsedArgs | null {
    let file: string | undefined;
    let scope: Scope | undefined;
    let force = false;
    let ignoreNonDefinitions = false;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === LOCAL_FLAG || arg === USER_FLAG || arg === SYSTEM_FLAG || arg === ROOT_FLAG) {
            if (scope !== undefined) {
                io.err("stxt install: only one of --local, --user, --system, --root may be given");
                return null;
            }
            if (arg === ROOT_FLAG) {
                const dir = args[++i];
                if (dir === undefined) {
                    io.err(`stxt install: ${ROOT_FLAG} requires a directory`);
                    return null;
                }
                scope = { kind: "root", dir };
            } else {
                scope = { kind: arg === LOCAL_FLAG ? "local" : arg === USER_FLAG ? "user" : "system" };
            }
        } else if (arg === FORCE_FLAG) {
            force = true;
        } else if (arg === IGNORE_FLAG) {
            ignoreNonDefinitions = true;
        } else if (arg.startsWith("-")) {
            io.err(`stxt install: unknown option: ${arg}`);
            return null;
        } else if (file !== undefined) {
            io.err("stxt install: only one file may be given");
            return null;
        } else {
            file = arg;
        }
    }

    if (file === undefined) {
        io.err("stxt install: missing file");
        io.err(`Usage: stxt install <file> [--local|--user|--system|--root <dir>] [--force] [${IGNORE_FLAG}]`);
        return null;
    }

    return { file, scope: scope ?? { kind: "local" }, force, ignoreNonDefinitions };
}

/**
 * Resolves the scope to an installation directory.
 *
 * @param scope the parsed scope.
 * @param cwd the working directory, for `--local`.
 * @param environment source of the user- and system-level directories.
 * @returns the directory to install into, or null when the system level cannot be determined.
 */
function resolveTargetDir(
    scope: Scope,
    cwd: string,
    environment: Pick<NodeDiscoveryEnvironment, "getUserLevelDir" | "getSystemLevelDir">
): string | null {
    switch (scope.kind) {
        case "local":
            return path.join(cwd, ".stxt");
        case "user":
            return environment.getUserLevelDir();
        case "system":
            return environment.getSystemLevelDir();
        case "root":
            return scope.dir;
    }
}

/**
 * Reads the source file and turns it into the list of definitions to install, reporting on `io`
 * and giving up on the first problem — nothing is written unless the whole file is installable.
 *
 * @param file the source file.
 * @param targetDir the level the definitions are to be installed into.
 * @param ignoreNonDefinitions true to skip the root nodes that are not definitions instead of
 *                             refusing the file.
 * @param io where to report why the file cannot be installed.
 * @returns the definitions with their destination already resolved, or null when the file cannot
 *          be installed (already reported).
 */
function readDefinitions(file: string, targetDir: string, ignoreNonDefinitions: boolean,
    io: CliIO): Definition[] | null {

    let text: string;
    try {
        text = fs.readFileSync(file, "utf-8");
    } catch (error) {
        io.err(`stxt install: cannot read ${file}: ${(error as Error).message}`);
        return null;
    }

    const result = new Parser().parseResult(text);
    if (result.hasErrors()) {
        for (const error of result.getErrors()) {
            io.err(`${file}:${error.line}: [${error.code}] ${error.message}`);
        }
        io.err(`stxt install: ${file} is not a valid STXT document; nothing was installed`);
        return null;
    }

    // The same meta-schemas the resolver validates a level against, so that install can only
    // ever write definitions discovery will accept afterwards.
    const validator = new SchemaValidator(new UnifiedSchemaProvider(), true);
    const definitions: Definition[] = [];

    for (const node of result.getNodes()) {
        const kind = node.getNamespace();

        if (kind !== SCHEMA_NAMESPACE && kind !== TEMPLATE_NAMESPACE) {
            if (ignoreNonDefinitions) {
                continue;
            }
            io.err(`stxt install: ${file}:${node.getLine()}: root node '${node.getName()}' belongs to `
                + `'${kind}', not to ${SCHEMA_NAMESPACE} or ${TEMPLATE_NAMESPACE} `
                + `(use ${IGNORE_FLAG} to install only the definitions)`);
            return null;
        }

        const definition = readDefinition(node, kind, file, targetDir, validator, io);
        if (definition === null) {
            return null;
        }

        const clash = definitions.find(other => other.namespace === definition.namespace);
        if (clash) {
            io.err(`stxt install: ${file} defines '${definition.namespace}' more than once; `
                + "a namespace can only have one definition per level");
            return null;
        }

        definitions.push(definition);
    }

    if (definitions.length === 0) {
        io.err(`stxt install: ${file} defines no ${SCHEMA_NAMESPACE} or ${TEMPLATE_NAMESPACE} document`);
        return null;
    }

    return definitions;
}

/**
 * Validates one root node as a definition and resolves where it is to be installed.
 *
 * @param node the root node.
 * @param kind the reserved namespace it is written in.
 * @param file the source file, for the error messages.
 * @param targetDir the level the definition is to be installed into.
 * @param validator validator holding the two meta-schemas.
 * @param io where to report why the definition is not installable.
 * @returns the definition, or null when it is not installable (already reported).
 */
function readDefinition(node: Node, kind: string, file: string, targetDir: string,
    validator: SchemaValidator, io: CliIO): Definition | null {

    const errors = validator.validate(node);
    if (errors.length > 0) {
        for (const error of errors) {
            io.err(`${file}:${error.line}: [${error.code}] ${error.message}`);
        }
        io.err(`stxt install: ${file} does not validate against the meta-schema of ${kind}; `
            + "nothing was installed");
        return null;
    }

    let schema: Schema;
    try {
        schema = kind === SCHEMA_NAMESPACE ? transformNodeToSchema(node) : transformTemplateNodeToSchema(node);
    } catch (error) {
        io.err(`stxt install: ${file}: invalid ${kind} definition: ${(error as Error).message}`);
        return null;
    }

    const namespace = schema.getNamespace();
    if (!NAMESPACE_PATTERN.test(namespace)) {
        io.err(`stxt install: ${file}: '${namespace}' is not a valid target namespace`);
        return null;
    }

    return {
        kind,
        namespace,
        node,
        destination: path.join(targetDir, kind, `${namespace}${STXT_EXTENSION}`),
    };
}

/**
 * Checks that no definition would overwrite a file, and that no namespace it defines is already
 * defined elsewhere in the level — two definitions of one namespace in a single level leave that
 * namespace with no active definition at all (STXT-DISCOVERY-SPEC section 8).
 *
 * @param definitions the definitions to install.
 * @param targetDir the level they are to be installed into.
 * @param io where to report a destination or a namespace that is already taken.
 * @returns true when every destination is free.
 */
function destinationsAreFree(definitions: Definition[], targetDir: string, io: CliIO): boolean {
    const installed = installedNamespaces(targetDir);

    for (const definition of definitions) {
        if (fs.existsSync(definition.destination)) {
            io.err(`stxt install: ${definition.destination} already exists (use ${FORCE_FLAG} to overwrite)`);
            return false;
        }

        const other = installed.get(definition.namespace);
        if (other !== undefined) {
            io.err(`stxt install: '${definition.namespace}' is already defined at this level by ${other} `
                + `(use ${FORCE_FLAG} to install it anyway)`);
            return false;
        }
    }

    return true;
}

/**
 * Reads which namespaces a level already defines. Files that do not parse or are not definitions
 * are skipped: they are already a resolution error of their own, which `schemas` and `validate`
 * report, and they define no namespace to clash with.
 *
 * @param dir the level directory; it need not exist.
 * @returns the file that defines each namespace found, by namespace.
 */
function installedNamespaces(dir: string): Map<string, string> {
    const found = new Map<string, string>();

    for (const file of collectFiles(dir)) {
        let nodes: Node[];
        try {
            nodes = new Parser().parse(fs.readFileSync(file, "utf-8"));
        } catch {
            continue;
        }

        for (const node of nodes) {
            const kind = node.getNamespace();
            if (kind !== SCHEMA_NAMESPACE && kind !== TEMPLATE_NAMESPACE) {
                continue;
            }
            try {
                const schema = kind === SCHEMA_NAMESPACE
                    ? transformNodeToSchema(node)
                    : transformTemplateNodeToSchema(node);
                if (!found.has(schema.getNamespace())) {
                    found.set(schema.getNamespace(), file);
                }
            } catch {
                continue;
            }
        }
    }

    return found;
}

/**
 * Lists every `*.stxt` file under a directory, recursively: subdirectories of a resolution
 * directory are organization only, and belong to the same level (STXT-DISCOVERY-SPEC section 3).
 *
 * @param dir the directory; it need not exist.
 * @returns the absolute paths of the files found.
 */
function collectFiles(dir: string): string[] {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        return [];
    }

    const files: string[] = [];

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const entryPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            files.push(...collectFiles(entryPath));
        } else if (entry.name.endsWith(STXT_EXTENSION)) {
            files.push(entryPath);
        }
    }

    return files;
}
