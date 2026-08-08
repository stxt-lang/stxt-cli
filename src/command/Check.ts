/**
 * Implementation of `stxt check <file|dir>... [--recursive] [--format text|json]
 * [--warn-schema|--no-schema]`.
 *
 * Parses every given document, validates it against the schemas discovered for its own
 * resolution chain (STXT-DISCOVERY-SPEC, the same one `install` and `schemas` use), and reports
 * every error found rather than stopping at the first one.
 *
 * Schema (validation) errors fail the build by default, same as syntax errors. `--warn-schema`
 * downgrades them to warnings that are reported but do not affect the exit code; `--no-schema`
 * skips schema discovery and validation entirely, checking only the base-language grammar.
 * `SCHEMA_NOT_FOUND` is never reported for a document whose resolution chain has no schema at
 * all (STXT-SPEC §15, §17.2: schemas are an optional layer, so an unvalidatable document is not
 * wrong) — the same rule the VSCode extension applies.
 *
 * Two more things are surfaced here, both skipped by `--no-schema` since they are part of the
 * same schema layer: a `@stxt.schema`/`@stxt.template` document is itself run through
 * `transformNodeToSchema`/`transformTemplateNodeToSchema`, so a broken definition fails `check`
 * even though it has no schema of its own to validate against; and the `DiscoveryError`s found
 * while loading a document's own resolution chain (a broken schema file, a duplicate namespace)
 * are reported the way `schemas` already does, instead of silently behaving as "no schema here".
 */

import * as fs from "fs";
import * as path from "path";
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

/** Dependencies {@link runCheck} needs beyond argument parsing, all with production defaults. */
export interface CheckDependencies {
    /** Working directory relative paths are resolved against. Defaults to `process.cwd()`. */
    cwd?: string;

    /** Resolver used for schema discovery. Defaults to a real {@link DiscoveryResolver}. */
    resolver?: Pick<DiscoveryResolver, "resolve">;
}

/**
 * Runs `check`.
 *
 * @param args arguments after `check`: one or more files or directories, `--recursive`,
 *             `--format text|json` (default `text`), and at most one of `--warn-schema` /
 *             `--no-schema`.
 * @param io where to report the findings.
 * @param deps injectable dependencies; see {@link CheckDependencies}.
 * @returns `OK` when every document checked is free of errors, `FAILURE` when at least one
 *          error was found (warnings alone do not fail), `USAGE` when the invocation is wrong.
 */
export async function runCheck(
    args: string[],
    io: CliIO,
    deps: CheckDependencies = {}
): Promise<ExitCode> {
    const cwd = deps.cwd ?? process.cwd();
    const resolver = deps.resolver ?? createDiscoveryResolver();

    const parsed = parseArgs(args, io);
    if (parsed === null) {
        return ExitCode.USAGE;
    }

    const resolvedTargets = parsed.paths.map(target => path.resolve(cwd, target));
    const files = collectFiles(resolvedTargets, parsed.recursive, io);
    if (files === null) {
        return ExitCode.USAGE;
    }

    const findings: Finding[] = [];
    for (const file of files) {
        findings.push(...await checkFile(file, parsed.schemaMode, resolver));
    }

    printReport(io, parsed.format, findings);

    return findings.some(finding => finding.severity === "error") ? ExitCode.FAILURE : ExitCode.OK;
}

/** The result of successfully parsing the arguments of `check`. */
interface ParsedArgs {
    paths: string[];
    recursive: boolean;
    format: Format;
    schemaMode: SchemaMode;
}

/**
 * Parses the arguments of `check`, reporting a usage error on `io`.
 *
 * @param args arguments after `check`.
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
                io.err(`stxt check: ${FORMAT_FLAG} requires one of: ${FORMATS.join(", ")}`);
                return null;
            }
            format = value as Format;
        } else if (arg.startsWith("-")) {
            io.err(`stxt check: unknown option: ${arg}`);
            return null;
        } else {
            paths.push(arg);
        }
    }

    if (paths.length === 0) {
        io.err("stxt check: missing file or directory");
        io.err(
            "Usage: stxt check <file|dir>... [--recursive] [--format text|json] " +
            "[--warn-schema|--no-schema]"
        );
        return null;
    }

    if (warnSchema && noSchema) {
        io.err(`stxt check: ${WARN_SCHEMA_FLAG} and ${NO_SCHEMA_FLAG} cannot be combined`);
        return null;
    }

    const schemaMode: SchemaMode = noSchema ? "off" : warnSchema ? "warn" : "fail";
    return { paths, recursive, format, schemaMode };
}

/**
 * Expands the given targets into a flat list of document files: a file is kept as-is (even if it
 * turns out not to exist, so that it is reported per-file instead of aborting the whole run), a
 * directory is expanded to the `*.stxt` files under it, recursively.
 *
 * @param targets absolute paths given on the command line.
 * @param recursive whether directories may be descended into at all.
 * @param io where to report a usage error.
 * @returns the files to check, or null when a directory was given without `--recursive`
 *          (already reported).
 */
function collectFiles(targets: string[], recursive: boolean, io: CliIO): string[] | null {
    const files: string[] = [];

    for (const target of targets) {
        let isDirectory = false;
        try {
            isDirectory = fs.statSync(target).isDirectory();
        } catch {
            // Missing or unreadable: kept as a single "file", reported when checked.
        }

        if (!isDirectory) {
            files.push(target);
        } else if (!recursive) {
            io.err(`stxt check: ${target} is a directory (use ${RECURSIVE_FLAG}/-r to descend into it)`);
            return null;
        } else {
            files.push(...walkStxtFiles(target));
        }
    }

    return files;
}

/**
 * Lists every `*.stxt` file under a directory, descending into every subdirectory except
 * `.stxt` itself: a resolution directory (STXT-DISCOVERY-SPEC) holds schema and template
 * definitions, not documents to check, and every real project has one.
 *
 * @param dir directory to walk.
 * @returns the matching files, in a stable (name-sorted) order.
 */
function walkStxtFiles(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    const files: string[] = [];

    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== ".stxt") {
                files.push(...walkStxtFiles(full));
            }
        } else if (entry.isFile() && full.endsWith(".stxt")) {
            files.push(full);
        }
    }

    return files;
}

/**
 * Parses and, unless {@link SchemaMode} is `"off"`, validates one document.
 *
 * @param file absolute path of the document.
 * @param schemaMode how schema errors are treated.
 * @param resolver resolver used to discover the schemas of `file`'s own chain.
 * @returns every finding for this document, `SCHEMA_NOT_FOUND` already filtered out when the
 *          chain has no schema at all.
 */
async function checkFile(
    file: string,
    schemaMode: SchemaMode,
    resolver: Pick<DiscoveryResolver, "resolve">
): Promise<Finding[]> {
    let content: string;
    try {
        content = fs.readFileSync(file, "utf-8");
    } catch (error) {
        return [{ file, line: 0, code: "FILE_NOT_READABLE", message: (error as Error).message, severity: "error" }];
    }

    const parser = new Parser();
    let hasSchemas = false;
    const findings: Finding[] = [];

    if (schemaMode !== "off") {
        const discoveryResult = await resolver.resolve(path.dirname(file));
        hasSchemas = discoveryResult.getActiveDefinitions().length > 0;
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

        if (isValidation && error.code === "SCHEMA_NOT_FOUND" && !hasSchemas) {
            continue;
        }

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
            findings.push(...checkAsDefinition(file, node, schemaMode));
        }
    }

    return findings;
}

/**
 * Checks a root node that is itself a `@stxt.schema` or `@stxt.template` definition, by running
 * it through the same transform discovery would (`transformNodeToSchema` /
 * `transformTemplateNodeToSchema`). Without this, a broken schema/template document would pass
 * `check` simply because it has no schema of its own to be validated against.
 *
 * @param file document the node belongs to, for the finding.
 * @param node a root node of the parsed document.
 * @param schemaMode how a validation error here is reported; see {@link SchemaMode}.
 * @returns the findings for this node; empty unless it is an invalid @stxt.schema/@stxt.template.
 */
function checkAsDefinition(file: string, node: Node, schemaMode: SchemaMode): Finding[] {
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
 * @param findings the findings collected across every file checked.
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
