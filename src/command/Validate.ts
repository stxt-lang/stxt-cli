/**
 * Implementation of `stxt validate <file|dir|->... [--recursive] [--format text|json]
 * [--warn-schema|--no-schema]`.
 *
 * Parses every given document, validates it against the schemas discovered for its own
 * resolution chain (STXT-DISCOVERY-SPEC, the same one `install` and `schemas` use), and reports
 * every error found rather than stopping at the first one. `-` reads one document from the
 * standard input (for pipes and CI); it is reported as `<stdin>`, and its resolution chain starts
 * at the working directory, as if the document were a file there.
 *
 * Schema (validation) errors fail the build by default, same as syntax errors. `--warn-schema`
 * downgrades them to warnings that are reported but do not affect the exit code; `--no-schema`
 * skips schema discovery and validation entirely, validating only the base-language grammar.
 * A namespace that no schema of the chain defines is `SCHEMA_NOT_FOUND` (STXT-SCHEMA-SPEC §13),
 * also when the chain has no schema at all: `validate` was asked to validate, and an
 * unvalidatable document is not a validated one. (Until 0.10.0 the code was silenced on an empty
 * chain, which made the verdict depend on whether an unrelated schema happened to be installed.)
 * To check only the syntax, use `--no-schema`.
 *
 * Two more things are surfaced here, both skipped by `--no-schema` since they are part of the
 * same schema layer: a `@stxt.schema`/`@stxt.template` document is itself run through
 * `transformNodeToSchema`/`transformTemplateNodeToSchema`, so a broken definition fails `validate`
 * even though it has no schema of its own to validate against; and the `DiscoveryError`s found
 * while loading a document's own resolution chain (a broken schema file, a duplicate namespace)
 * are reported the way `schemas` already does, instead of silently behaving as "no schema here".
 */

import {
    ConditionalValidator,
    DiscoveryResolver,
    Node,
    Parser,
    SchemaValidator,
    transformNodeToSchema,
    transformTemplateNodeToSchema,
    ValidationException,
} from "@stxt-lang/core";
import { CliIO } from "../runtime/Cli";
import { ExitCode } from "../runtime/ExitCode";
import { collectSources, DocumentSource, readStdin, STDIN_TARGET } from "../runtime/StxtFiles";
import { createDiscoveryResolver } from "../discovery/NodeDiscovery";

const RECURSIVE_FLAG = "--recursive";
const RECURSIVE_FLAGS = [RECURSIVE_FLAG, "-r"];
const FORMAT_FLAG = "--format";
const WARN_SCHEMA_FLAG = "--warn-schema";
const NO_SCHEMA_FLAG = "--no-schema";

/** The output formats `--format` accepts. */
const FORMATS = ["text", "json"] as const;
type Format = (typeof FORMATS)[number];

/** How schema (validation) errors are treated; see the module doc comment. */
type SchemaMode = "fail" | "warn" | "off";

/** One problem found in one document, ready to be reported in either format. */
interface Finding {
    file: string;
    line: number;
    code: string;
    message: string;
    severity: "error" | "warning";
}

/** Dependencies {@link runValidate} needs beyond argument parsing, all with production defaults. */
export interface ValidateDependencies {
    /** Working directory relative paths are resolved against. Defaults to `process.cwd()`. */
    cwd?: string;

    /** Resolver used for schema discovery. Defaults to a real {@link DiscoveryResolver}. */
    resolver?: Pick<DiscoveryResolver, "resolve">;

    /** How `-` reads the standard input. Defaults to reading the real one. */
    readStdin?: () => string;
}

/**
 * Runs `validate`.
 *
 * @param args arguments after `validate`: one or more files, directories or `-` (stdin, at
 *             most once), `--recursive`, `--format text|json` (default `text`), and at most one
 *             of `--warn-schema` / `--no-schema`.
 * @param io where to report the findings.
 * @param deps injectable dependencies; see {@link ValidateDependencies}.
 * @returns `OK` when every document validated is free of errors, `FAILURE` when at least one
 *          error was found (warnings alone do not fail), `USAGE` when the invocation is wrong.
 */
export async function runValidate(
    args: string[],
    io: CliIO,
    deps: ValidateDependencies = {}
): Promise<ExitCode> {
    const cwd = deps.cwd ?? process.cwd();
    const resolver = deps.resolver ?? createDiscoveryResolver();

    const parsed = parseArgs(args, io);
    if (parsed === null) {
        return ExitCode.USAGE;
    }

    const sources = collectSources(
        parsed.paths, cwd, parsed.recursive, "stxt validate", io, deps.readStdin ?? readStdin
    );
    if (sources === null) {
        return ExitCode.USAGE;
    }

    const findings: Finding[] = [];
    for (const source of sources) {
        findings.push(...await validateSource(source, parsed.schemaMode, resolver));
    }

    printReport(io, parsed.format, findings);

    return findings.some(finding => finding.severity === "error") ? ExitCode.FAILURE : ExitCode.OK;
}

/** The result of successfully parsing the arguments of `validate`. */
interface ParsedArgs {
    paths: string[];
    recursive: boolean;
    format: Format;
    schemaMode: SchemaMode;
}

/**
 * Parses the arguments of `validate`, reporting a usage error on `io`.
 *
 * @param args arguments after `validate`.
 * @param io where to report a usage error.
 * @returns the parsed arguments, or null when the invocation is wrong (already reported).
 */
function parseArgs(args: string[], io: CliIO): ParsedArgs | null {
    const paths: string[] = [];
    let recursive = false;
    let format: Format = "text";
    let warnSchema = false;
    let noSchema = false;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (RECURSIVE_FLAGS.includes(arg)) {
            recursive = true;
        } else if (arg === WARN_SCHEMA_FLAG) {
            warnSchema = true;
        } else if (arg === NO_SCHEMA_FLAG) {
            noSchema = true;
        } else if (arg === FORMAT_FLAG) {
            const value = args[++i];
            if (value === undefined || !(FORMATS as readonly string[]).includes(value)) {
                io.err(`stxt validate: ${FORMAT_FLAG} requires one of: ${FORMATS.join(", ")}`);
                return null;
            }
            format = value as Format;
        } else if (arg === STDIN_TARGET) {
            paths.push(arg);
        } else if (arg.startsWith("-")) {
            io.err(`stxt validate: unknown option: ${arg}`);
            return null;
        } else {
            paths.push(arg);
        }
    }

    if (paths.length === 0) {
        io.err("stxt validate: missing file or directory");
        io.err(
            "Usage: stxt validate <file|dir|->... [--recursive] [--format text|json] " +
            "[--warn-schema|--no-schema]"
        );
        return null;
    }

    if (warnSchema && noSchema) {
        io.err(`stxt validate: ${WARN_SCHEMA_FLAG} and ${NO_SCHEMA_FLAG} cannot be combined`);
        return null;
    }

    const schemaMode: SchemaMode = noSchema ? "off" : warnSchema ? "warn" : "fail";
    return { paths, recursive, format, schemaMode };
}

/**
 * Parses and, unless {@link SchemaMode} is `"off"`, validates one document.
 *
 * @param source the document, a file or the standard input.
 * @param schemaMode how schema errors are treated.
 * @param resolver resolver used to discover the schemas of the document's own chain.
 * @returns every finding for this document.
 */
async function validateSource(
    source: DocumentSource,
    schemaMode: SchemaMode,
    resolver: Pick<DiscoveryResolver, "resolve">
): Promise<Finding[]> {
    const file = source.name;
    let content: string;
    try {
        content = source.read();
    } catch (error) {
        return [{ file, line: 0, code: "FILE_NOT_READABLE", message: (error as Error).message, severity: "error" }];
    }

    const parser = new Parser();
    const findings: Finding[] = [];

    if (schemaMode !== "off") {
        const discoveryResult = await resolver.resolve(source.dir);
        parser.registerValidator(new ConditionalValidator(new SchemaValidator(discoveryResult)));

        for (const error of discoveryResult.getErrors()) {
            findings.push({
                file: error.file,
                line: 0,
                code: error.code,
                message: error.message,
                severity: schemaMode === "warn" ? "warning" : "error",
            });
        }
    }

    const parseResult = parser.parseResult(content);
    for (const error of parseResult.getErrors()) {
        const isValidation = error instanceof ValidationException;

        findings.push({
            file,
            line: error.line,
            code: error.code,
            message: error.message,
            severity: isValidation && schemaMode === "warn" ? "warning" : "error",
        });
    }

    if (schemaMode !== "off") {
        for (const node of parseResult.getNodes()) {
            findings.push(...validateAsDefinition(file, node, schemaMode));
        }
    }

    return findings;
}

/**
 * Validates a root node that is itself a `@stxt.schema` or `@stxt.template` definition, by running
 * it through the same transform discovery would (`transformNodeToSchema` /
 * `transformTemplateNodeToSchema`). Without this, a broken schema/template document would pass
 * `validate` simply because it has no schema of its own to be validated against.
 *
 * @param file document the node belongs to, for the finding.
 * @param node a root node of the parsed document.
 * @param schemaMode how a validation error here is reported; see {@link SchemaMode}.
 * @returns the findings for this node; empty unless it is an invalid @stxt.schema/@stxt.template.
 */
function validateAsDefinition(file: string, node: Node, schemaMode: SchemaMode): Finding[] {
    const namespace = node.getNamespace();
    const transform =
        namespace === "@stxt.schema" ? transformNodeToSchema :
        namespace === "@stxt.template" ? transformTemplateNodeToSchema :
        null;

    if (transform === null) {
        return [];
    }

    try {
        transform(node);
        return [];
    } catch (error) {
        if (!(error instanceof ValidationException)) {
            throw error;
        }
        return [{
            file,
            line: error.line,
            code: error.code,
            message: error.message,
            severity: schemaMode === "warn" ? "warning" : "error",
        }];
    }
}

/**
 * Prints every finding in the requested format.
 *
 * @param io where to print.
 * @param format `"text"` for one human-readable line per finding plus a summary, `"json"` for a
 *               single JSON array (always printed, even when empty).
 * @param findings the findings collected across every file validated.
 */
function printReport(io: CliIO, format: Format, findings: Finding[]): void {
    if (format === "json") {
        io.out(JSON.stringify(findings));
        return;
    }

    for (const finding of findings) {
        io.out(`${finding.file}:${finding.line}: [${finding.code}] ${finding.message} (${finding.severity})`);
    }

    if (findings.length > 0) {
        const errorCount = findings.filter(finding => finding.severity === "error").length;
        const warningCount = findings.length - errorCount;
        io.out(`${errorCount} error(s), ${warningCount} warning(s)`);
    }
}
