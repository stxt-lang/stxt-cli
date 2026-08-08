/**
 * Implementation of `stxt install <file> [--local|--user|--system|--root <dir>] [--force]`.
 *
 * Copies a local schema or template file into one of the fixed directories of the resolution
 * chain (STXT-DISCOVERY-SPEC), so that `check` and the editor pick it up afterwards. The three
 * named scopes reuse {@link NodeDiscoveryEnvironment}, the same source of truth `check` will use
 * to read the chain back, so `install` and discovery can never disagree about a path.
 *
 * Remote URLs are out of scope by design (ROADMAP.md, 0.2.0): only a local file is accepted.
 */

import * as fs from "fs";
import * as path from "path";
import { CliIO } from "../runtime/Cli";
import { ExitCode } from "../runtime/ExitCode";
import { NodeDiscoveryEnvironment } from "../discovery/NodeDiscovery";

const LOCAL_FLAG = "--local";
const USER_FLAG = "--user";
const SYSTEM_FLAG = "--system";
const ROOT_FLAG = "--root";
const FORCE_FLAG = "--force";

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
 *             `--system`, `--root <dir>` (at most one; `--local` is the default) and `--force`.
 * @param io where to report the outcome.
 * @param deps injectable dependencies; see {@link InstallDependencies}.
 * @returns `OK` once the file is copied, `USAGE` when the invocation is wrong, `FAILURE` when the
 *          invocation is fine but the file cannot be installed (missing source, unresolvable or
 *          unwritable destination, pre-existing destination without `--force`).
 */
export function runInstall(args: string[], io: CliIO, deps: InstallDependencies = {}): ExitCode {
    const cwd = deps.cwd ?? process.cwd();
    const environment = deps.environment ?? new NodeDiscoveryEnvironment();

    const parsed = parseArgs(args, io);
    if (parsed === null) {
        return ExitCode.USAGE;
    }

    const { file, scope, force } = parsed;

    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        io.err(`stxt install: not a file: ${file}`);
        return ExitCode.FAILURE;
    }

    const targetDir = resolveTargetDir(scope, cwd, environment);
    if (targetDir === null) {
        io.err("stxt install: cannot determine the system directory (ProgramData is not set)");
        return ExitCode.FAILURE;
    }

    const destination = path.join(targetDir, path.basename(file));

    if (fs.existsSync(destination) && !force) {
        io.err(`stxt install: ${destination} already exists (use ${FORCE_FLAG} to overwrite)`);
        return ExitCode.FAILURE;
    }

    try {
        fs.mkdirSync(targetDir, { recursive: true });
        fs.copyFileSync(file, destination);
    } catch (error) {
        io.err(`stxt install: cannot write ${destination}: ${(error as Error).message}`);
        return ExitCode.FAILURE;
    }

    io.out(`Installed ${file} to ${destination}`);
    return ExitCode.OK;
}

/** The result of successfully parsing the arguments of `install`. */
interface ParsedArgs {
    file: string;
    scope: Scope;
    force: boolean;
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

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === LOCAL_FLAG || arg === USER_FLAG || arg === SYSTEM_FLAG) {
            if (scope !== undefined) {
                io.err("stxt install: only one of --local, --user, --system, --root may be given");
                return null;
            }
            scope = { kind: arg === LOCAL_FLAG ? "local" : arg === USER_FLAG ? "user" : "system" };
        } else if (arg === ROOT_FLAG) {
            if (scope !== undefined) {
                io.err("stxt install: only one of --local, --user, --system, --root may be given");
                return null;
            }
            const dir = args[++i];
            if (dir === undefined) {
                io.err(`stxt install: ${ROOT_FLAG} requires a directory`);
                return null;
            }
            scope = { kind: "root", dir };
        } else if (arg === FORCE_FLAG) {
            force = true;
        } else if (arg.startsWith("--")) {
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
        io.err("Usage: stxt install <file> [--local|--user|--system|--root <dir>] [--force]");
        return null;
    }

    return { file, scope: scope ?? { kind: "local" }, force };
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
