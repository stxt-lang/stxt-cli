/**
 * Implementation of `stxt schemas [path]`.
 *
 * Lists the namespaces resolvable for a document at `path` (or the current directory), using
 * the same {@link DiscoveryResolver} chain `check` and `install` rely on. This is the
 * diagnostic counterpart of `install`: the fastest way to answer "why is my document not being
 * validated?" or "which definition actually applies here?".
 */

import * as fs from "fs";
import * as path from "path";
import { DiscoveryDefinition, DiscoveryError, DiscoveryResolver } from "@stxt-lang/core";
import { CliIO } from "../runtime/Cli";
import { ExitCode } from "../runtime/ExitCode";
import { createDiscoveryResolver } from "../discovery/NodeDiscovery";

/** The subset of {@link DiscoveryResolver} this command needs, so tests can stub it. */
export interface SchemasResolver {
    resolve(documentDir: string | null): Promise<{
        getChain(): ReadonlyArray<string>;
        getActiveDefinitions(): ReadonlyArray<DiscoveryDefinition>;
        getErrors(): ReadonlyArray<DiscoveryError>;
    }>;
}

/** Dependencies {@link runSchemas} needs beyond argument parsing, all with production defaults. */
export interface SchemasDependencies {
    /** Working directory used when no `path` is given. Defaults to `process.cwd()`. */
    cwd?: string;

    /** Resolver to run the chain through. Defaults to a real {@link DiscoveryResolver}. */
    resolver?: SchemasResolver;
}

/**
 * Runs `schemas`.
 *
 * @param args arguments after `schemas`: at most one path, to a document or to a directory.
 * @param io where to report the chain, the active namespaces and any resolution errors.
 * @param deps injectable dependencies; see {@link SchemasDependencies}.
 * @returns `OK` when the chain resolves with no errors, `FAILURE` when it resolves but with
 *          resolution errors (STXT-DISCOVERY-SPEC section 8), `USAGE` when the invocation is
 *          wrong.
 */
export async function runSchemas(
    args: string[],
    io: CliIO,
    deps: SchemasDependencies = {}
): Promise<ExitCode> {
    const cwd = deps.cwd ?? process.cwd();
    const resolver: SchemasResolver = deps.resolver ?? createDiscoveryResolver();

    const parsed = parseArgs(args, io);
    if (parsed === null) {
        return ExitCode.USAGE;
    }

    const target = parsed.path !== undefined ? path.resolve(cwd, parsed.path) : cwd;

    let documentDir: string;
    try {
        documentDir = fs.statSync(target).isDirectory() ? target : path.dirname(target);
    } catch {
        io.err(`stxt schemas: no such file or directory: ${target}`);
        return ExitCode.FAILURE;
    }

    const result = await resolver.resolve(documentDir);
    const chain = result.getChain();
    const definitions = result.getActiveDefinitions();
    const errors = result.getErrors();

    io.out(`Resolution chain for ${documentDir}:`);
    if (chain.length === 0) {
        io.out("    (empty — no .stxt directory found)");
    } else {
        chain.forEach(dir => io.out(`    ${dir}`));
    }

    io.out("");
    if (definitions.length === 0) {
        io.out("No namespaces resolved.");
    } else {
        io.out("Namespaces:");
        definitions.forEach(def => io.out(`    ${def.namespace} <- ${def.file}`));
    }

    if (errors.length > 0) {
        io.err("");
        io.err("Errors:");
        errors.forEach(error => io.err(`    ${error.code} ${error.file}: ${error.message}`));
    }

    return errors.length > 0 ? ExitCode.FAILURE : ExitCode.OK;
}

/** The result of successfully parsing the arguments of `schemas`. */
interface ParsedArgs {
    path?: string;
}

/**
 * Parses the arguments of `schemas`, reporting a usage error on `io`.
 *
 * @param args arguments after `schemas`.
 * @param io where to report a usage error.
 * @returns the parsed arguments, or null when the invocation is wrong (already reported).
 */
function parseArgs(args: string[], io: CliIO): ParsedArgs | null {
    if (args.length > 1) {
        io.err("stxt schemas: only one path may be given");
        return null;
    }

    const [maybePath] = args;
    if (maybePath !== undefined && maybePath.startsWith("-")) {
        io.err(`stxt schemas: unknown option: ${maybePath}`);
        return null;
    }

    return { path: maybePath };
}
