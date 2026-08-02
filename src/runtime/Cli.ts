import { ExitCode } from "./ExitCode";
import { getCliVersion, getCoreVersion } from "./PackageInfo";

/**
 * Where the CLI writes its output.
 *
 * Everything the CLI prints goes through this interface rather than through `console`, so that
 * tests can capture the output instead of polluting the test run.
 */
export interface CliIO {
    /** Writes a line to standard output (the result of the command). */
    out(line: string): void;

    /** Writes a line to standard error (diagnostics and usage errors). */
    err(line: string): void;
}

/** The default {@link CliIO}: the real standard output and standard error of the process. */
export const consoleIO: CliIO = {
    out: (line: string) => process.stdout.write(line + "\n"),
    err: (line: string) => process.stderr.write(line + "\n"),
};

/**
 * Options accepted anywhere in the command line.
 *
 * Every option has exactly one spelling, the GNU long form, which is what users of Node tooling
 * expect. No single-dash long form, no short aliases: one way of writing each option.
 */
const VERSION_FLAG = "--version";
const HELP_FLAG = "--help";

const USAGE = [
    "stxt - command-line interface for STXT (Semantic Text)",
    "",
    "Usage:",
    "    stxt [options]",
    "",
    "Options:",
    "    --version    print the version of the CLI and of the parser it uses",
    "    --help       print this help",
    "",
    "No document command is available yet. See ROADMAP.md for what is coming.",
    "Language reference: https://stxt.dev",
];

/**
 * Runs the CLI over an argument list.
 *
 * This is the whole command dispatch, kept out of the executable entry point so that it can be
 * called from tests with captured output and inspected exit codes.
 *
 * @param args command-line arguments, without the node binary and the script path.
 * @param io where to write the output; defaults to the real process streams.
 * @returns the exit code the process should report.
 */
export function run(args: string[], io: CliIO = consoleIO): ExitCode {
    // An option is honoured wherever it appears, so that `stxt <future command> --version` works.
    if (args.includes(VERSION_FLAG)) {
        io.out(versionLine());
        return ExitCode.OK;
    }

    if (args.includes(HELP_FLAG)) {
        USAGE.forEach(line => io.out(line));
        return ExitCode.OK;
    }

    // Being invoked with nothing to do is a usage error, not a success: help goes to stderr so
    // that a script piping stdout does not mistake it for a result.
    if (args.length === 0) {
        USAGE.forEach(line => io.err(line));
        return ExitCode.USAGE;
    }

    io.err(`stxt: unknown option or command: ${args[0]}`);
    io.err("Run 'stxt --help' to see the available options.");

    return ExitCode.USAGE;
}

/**
 * Builds the single line printed by `--version`.
 *
 * It carries the version of the parser as well, because that is what determines how documents
 * are actually parsed and validated.
 *
 * @returns a line of the form `stxt 0.1.0 (@stxt-lang/core 0.5.3)`.
 */
function versionLine(): string {
    return `stxt ${getCliVersion()} (@stxt-lang/core ${getCoreVersion()})`;
}
