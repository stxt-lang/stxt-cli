import { ExitCode } from "./ExitCode";
import { getCliVersion, getCoreVersion } from "./PackageInfo";
import { runInstall } from "../command/Install";
import { runSchemas } from "../command/Schemas";
import { runValidate } from "../command/Validate";
import { runFormat } from "../command/Format";
import { runDescribe } from "../command/Describe";

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
 * Every option has one long spelling, the GNU long form. A short alias exists only for the
 * handful of options where a single letter is a near-universal Unix convention (`-v`, `-h`,
 * `-r`, `-w`); nothing else gets one without asking. No single-dash long form (`-version`): a short
 * alias is exactly one letter, or it does not exist.
 */
const VERSION_FLAGS = ["--version", "-v"];
const HELP_FLAGS = ["--help", "-h"];

const USAGE = `stxt - command-line interface for STXT (Semantic Text)

Usage:
    stxt [options]
    stxt install <file> [--local|--user|--system|--root <dir>] [--force] [--ignore-non-definitions]
    stxt schemas [path]
    stxt validate <file|dir|->... [--recursive] [--format text|json] [--warn-schema|--no-schema]
    stxt format <file|dir|->... [--recursive] [--tabs|--spaces] [--write|--check] [--clean]
    stxt describe <file|->

Options:
    --version, -v    print the version of the CLI and of the parser it uses
    --help, -h       print this help

Commands:
    install      validate a schema or template document and install it into the resolution chain
                 each definition is written in canonical form, as
                 <level>/@stxt.schema/<namespace>.stxt (or @stxt.template/)
                 --local:      ./.stxt (current project, default)
                 --user:       ~/.stxt
                 --system:     /etc/stxt (%ProgramData%\\stxt on Windows)
                 --root <dir>: an explicit directory
                 --force:      overwrite a definition already installed for that namespace
                 --ignore-non-definitions:
                               install the definitions of the file and skip the other root nodes
    schemas      list the namespaces resolvable for a document, and where they come from
                 [path]: a document or directory; defaults to the current directory
    validate     parse and validate documents against their discovered schemas
                 -: read one document from stdin, reported as <stdin>; its resolution
                    chain starts at the current directory
                 --recursive, -r: descend into directories, validating every *.stxt file
                 --format:      text (default) or json
                 --warn-schema: report schema errors but do not fail the build
                 --no-schema:   validate only the base-language grammar, no schemas at all
    format       reformat documents in their canonical form, keeping comments
                 -: read one document from stdin and print the result (not with --write)
                 --recursive, -r: descend into directories, formatting every *.stxt file
                 --tabs:        indent with tabs (default)
                 --spaces:      indent with 4 spaces
                 --write, -w:   rewrite each file in place (default: print to stdout, write nothing)
                 --check:       report which files would change, write nothing; fails if any would
                 --clean:       re-serialize the parse tree, dropping comments and blank lines
    describe     parse one document (a file, or - for stdin) and emit its STXT-TREE-SPEC
                 canonical JSON tree

Language reference: https://stxt.dev
Source and issues:  https://github.com/stxt-lang/stxt-cli
`;

/** Document commands, dispatched on the first non-option argument. */
const COMMANDS: Record<string, (args: string[], io: CliIO) => ExitCode | Promise<ExitCode>> = {
    install: runInstall,
    schemas: runSchemas,
    validate: runValidate,
    format: runFormat,
    describe: runDescribe,
};

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
export async function run(args: string[], io: CliIO = consoleIO): Promise<ExitCode> {
    // An option is honoured wherever it appears, so that `stxt <future command> --version` works.
    if (args.some(arg => VERSION_FLAGS.includes(arg))) {
        io.out(versionLine());
        return ExitCode.OK;
    }

    if (args.some(arg => HELP_FLAGS.includes(arg))) {
        USAGE.split('\n').forEach(line => io.out(line));
        return ExitCode.OK;
    }

    // Being invoked with nothing to do is a usage error, not a success: help goes to stderr so
    // that a script piping stdout does not mistake it for a result.
    if (args.length === 0) {
        USAGE.split('\n').forEach(line => io.err(line));
        return ExitCode.USAGE;
    }

    const command = COMMANDS[args[0]];
    if (command !== undefined) {
        return await command(args.slice(1), io);
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
 * @returns a line of the form `stxt 0.6.2 (@stxt-lang/core 0.6.2)`.
 */
function versionLine(): string {
    return `stxt ${getCliVersion()} (@stxt-lang/core ${getCoreVersion()})`;
}
