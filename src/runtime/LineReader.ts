/**
 * Line sources for `Parser.parseStream`: the lines of a string, and the lines of a file read
 * lazily, chunk by chunk, so that validating a document does not require holding it whole in
 * memory. Both follow the parser's own line contract: lines are split on LF or CRLF, each line
 * is handed over without its line break, and the final line break terminates the last line
 * instead of adding an empty one (STXT-SPEC 10.3 — otherwise a `>>` block at EOF would gain a
 * spurious blank line).
 */

import * as fs from "fs";
import { StringDecoder } from "string_decoder";

/** How much of a file is read per syscall; memory holds one chunk and one line at a time. */
const CHUNK_SIZE = 64 * 1024;

/**
 * The lines of a whole string, the way the parser counts them.
 *
 * @param content the document text.
 * @returns its lines, without line breaks and without a spurious final empty line.
 */
export function linesOf(content: string): string[] {
    const lines = content.split(/\r?\n/);
    if (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.pop();
    }
    return lines;
}

/**
 * Reads a file line by line without loading it whole. The file is opened eagerly — a missing
 * file throws here, not midway through the parse — and closed when the iteration ends, also
 * when the parser abandons it early on a limit error (the generator's `finally` runs when the
 * `for..of` of the parser returns).
 *
 * @param file absolute path of the file.
 * @returns a single-use iterable over its lines.
 */
export function readFileLines(file: string): Iterable<string> {
    const fd = fs.openSync(file, "r");
    return {
        [Symbol.iterator]: () => readLines(fd),
    };
}

/** Reads the open file chunk by chunk, decoding UTF-8 across chunk boundaries. */
function* readLines(fd: number): Generator<string> {
    try {
        const decoder = new StringDecoder("utf8");
        const buffer = Buffer.alloc(CHUNK_SIZE);
        let pending = "";

        for (;;) {
            const bytes = fs.readSync(fd, buffer, 0, CHUNK_SIZE, null);
            if (bytes === 0) {
                break;
            }

            pending += decoder.write(buffer.subarray(0, bytes));
            const parts = pending.split("\n");
            pending = parts.pop() ?? "";
            for (const part of parts) {
                yield part.endsWith("\r") ? part.slice(0, -1) : part;
            }
        }

        pending += decoder.end();
        if (pending !== "") {
            // A last line without a line break; a bare trailing "\r" is content, as in linesOf
            yield pending;
        }
    } finally {
        fs.closeSync(fd);
    }
}
