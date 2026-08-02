/**
 * Exit codes returned by the `stxt` command.
 *
 * The distinction that matters in a CI pipeline is between {@link ExitCode.FAILURE} — the tool
 * ran fine and the documents are wrong — and {@link ExitCode.USAGE} — the tool was invoked
 * wrong and nothing was checked at all.
 */
export enum ExitCode {
    /** Everything the command was asked to do succeeded. */
    OK = 0,

    /** The command ran, but the documents did not pass (parse errors, validation errors, ...). */
    FAILURE = 1,

    /** The command line itself was wrong: unknown option, missing argument, no arguments. */
    USAGE = 2,
}
