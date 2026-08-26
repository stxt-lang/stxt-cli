/**
 * Shared parsing of the parser limit flags of STXT-SPEC §11.2: `--max-nesting`,
 * `--max-line-length` and `--max-input-size`, accepted by `validate` and `describe` — the
 * commands that parse whole documents with their own `Parser`. Each flag takes an integer
 * value; `-1` disables that limit, and the flags left out keep the recommended defaults of
 * the specification (100 levels, 10 000 characters per line, 10 000 000 characters in total).
 *
 * `format` does not take them yet: its line-by-line engine is `Formatter.format()` of
 * `@stxt-lang/core`, which builds its own parser and accepts no parser options for now.
 */

import { ParserOptions } from "@stxt-lang/core";
import { CliIO } from "./Cli";

export const MAX_NESTING_FLAG = "--max-nesting";
export const MAX_LINE_LENGTH_FLAG = "--max-line-length";
export const MAX_INPUT_SIZE_FLAG = "--max-input-size";

const FLAG_OPTIONS: ReadonlyMap<string, keyof ParserOptions> = new Map([
    [MAX_NESTING_FLAG, "maxNesting"],
    [MAX_LINE_LENGTH_FLAG, "maxLineLength"],
    [MAX_INPUT_SIZE_FLAG, "maxInputSize"],
]);

/** The synopsis fragment the three limit flags add to a command's usage line. */
export const LIMIT_FLAGS_USAGE =
    `[${MAX_NESTING_FLAG} N] [${MAX_LINE_LENGTH_FLAG} N] [${MAX_INPUT_SIZE_FLAG} N]`;

/**
 * Tells whether the argument is one of the three limit flags.
 *
 * @param arg one command-line argument.
 * @returns true when it is a limit flag (its value comes as the next argument).
 */
export function isLimitFlag(arg: string): boolean {
    return FLAG_OPTIONS.has(arg);
}

/**
 * Applies one limit flag and its value to the parser options under construction, reporting a
 * usage error on `io` when the value is missing or not an integer greater than or equal to -1.
 *
 * @param limits the {@link ParserOptions} being built by the command's argument parser.
 * @param flag the limit flag found (must satisfy {@link isLimitFlag}).
 * @param value the next argument, taken as the flag's value.
 * @param command the command name for the error message (e.g. `stxt validate`).
 * @param io where to report a usage error.
 * @returns true when the limit was applied; false when the invocation is wrong (already reported).
 */
export function applyLimitFlag(
    limits: ParserOptions,
    flag: string,
    value: string | undefined,
    command: string,
    io: CliIO
): boolean {
    if (value === undefined || !/^-?\d+$/.test(value) || Number(value) < -1) {
        io.err(`${command}: ${flag} requires an integer greater than or equal to -1 (-1 disables the limit)`);
        return false;
    }

    limits[FLAG_OPTIONS.get(flag)!] = Number(value);
    return true;
}
