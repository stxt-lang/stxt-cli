#!/usr/bin/env node

/**
 * Executable entry point of the `stxt` command.
 *
 * It does nothing but hand the arguments over to {@link run} and turn its return value into
 * the process exit code. Setting `process.exitCode` instead of calling `process.exit()` lets
 * Node flush stdout before terminating, which matters when the output is piped.
 */

import { run } from "./runtime/Cli";

// `stxt ... | head` closes the pipe early, and writing to a closed pipe raises EPIPE, which Node
// would report as an unhandled 'error' event and a stack trace. Being cut short by a pager is
// normal for a command-line tool, so it is swallowed here; any other stream error is rethrown.
for (const stream of [process.stdout, process.stderr]) {
    stream.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code !== "EPIPE") {
            throw error;
        }
    });
}

process.exitCode = run(process.argv.slice(2));
