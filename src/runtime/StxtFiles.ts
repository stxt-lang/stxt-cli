/**
 * Expands command-line targets (files, directories, or `-` for the standard input) into a flat
 * list of document sources, shared by every command that processes documents the same way
 * (`validate`, `format`).
 */

import * as fs from "fs";
import * as path from "path";
import { CliIO } from "./Cli";
import { linesOf, readFileLines } from "./LineReader";

/** The command-line target that stands for the standard input, the usual Unix convention. */
export const STDIN_TARGET = "-";

/**
 * How the standard input is named in every report (`<stdin>:3: [CODE] ...`), the convention of
 * gcc/clang/prettier: unambiguous next to a real path, and easy to filter in CI.
 */
export const STDIN_NAME = "<stdin>";

/**
 * A document to process: either a file on disk or the standard input. Commands work on sources
 * rather than on paths so that stdin needs no special case past this point.
 */
export interface DocumentSource {
    /** The name to report findings under: the absolute path, or {@link STDIN_NAME}. */
    name: string;

    /**
     * The directory the document belongs to, where schema discovery starts (STXT-DISCOVERY-SPEC).
     * A document read from stdin has no directory of its own, so it uses the working directory,
     * as if it were a file there — the same as `stxt schemas` without an argument.
     */
    dir: string;

    /** Reads the whole content. Throws when the source cannot be read. */
    read(): string;

    /**
     * The content as a single-use line iterable for {@link Parser.parseStream}: a file is read
     * lazily, chunk by chunk, so its memory is one chunk and one root tree at a time; the
     * standard input is read whole (it cannot be reopened) and split. Throws when the source
     * cannot be opened.
     */
    lines(): Iterable<string>;
}

/**
 * Reads the whole standard input as UTF-8. Synchronous, like reading a file: the commands are
 * built around `readFileSync`, and a document is small.
 *
 * @returns everything up to end of input.
 */
export function readStdin(): string {
    return fs.readFileSync(0, "utf-8");
}

/**
 * Expands the given targets, in order, into a flat list of document sources: a file is kept as-is
 * (even if it turns out not to exist, so that it is reported per-file instead of aborting the
 * whole run), a directory is expanded to the `*.stxt` files under it, recursively, and `-` is the
 * standard input.
 *
 * @param targets targets as given on the command line (relative paths, or `-`).
 * @param cwd working directory relative paths are resolved against, and the directory a stdin
 *            document is taken to belong to.
 * @param recursive whether directories may be descended into at all.
 * @param commandPrefix the calling command's own error prefix (e.g. `"stxt validate"`).
 * @param io where to report a usage error.
 * @param readStdin how the standard input is read (injectable for tests).
 * @returns the sources to process, or null when a directory was given without `--recursive`, or
 *          `-` was given more than once (stdin can be consumed only once) — already reported.
 */
export function collectSources(
    targets: string[],
    cwd: string,
    recursive: boolean,
    commandPrefix: string,
    io: CliIO,
    readStdin: () => string
): DocumentSource[] | null {
    if (targets.filter(target => target === STDIN_TARGET).length > 1) {
        io.err(`${commandPrefix}: ${STDIN_TARGET} (the standard input) can be given only once`);
        return null;
    }

    const sources: DocumentSource[] = [];

    for (const target of targets) {
        if (target === STDIN_TARGET) {
            sources.push({ name: STDIN_NAME, dir: cwd, read: readStdin, lines: () => linesOf(readStdin()) });
            continue;
        }

        const resolved = path.resolve(cwd, target);
        let isDirectory = false;
        try {
            isDirectory = fs.statSync(resolved).isDirectory();
        } catch {
            // Missing or unreadable: kept as a single file, reported once processed.
        }

        if (!isDirectory) {
            sources.push(fileSource(resolved));
        } else if (!recursive) {
            io.err(`${commandPrefix}: ${resolved} is a directory (use --recursive/-r to descend into it)`);
            return null;
        } else {
            sources.push(...walkStxtFiles(resolved).map(fileSource));
        }
    }

    return sources;
}

/**
 * Wraps a file on disk as a {@link DocumentSource}.
 *
 * @param file absolute path of the file.
 * @returns a source that reads the file when asked.
 */
export function fileSource(file: string): DocumentSource {
    return {
        name: file,
        dir: path.dirname(file),
        read: () => fs.readFileSync(file, "utf-8"),
        lines: () => readFileLines(file),
    };
}

/**
 * Lists every `*.stxt` file under a directory, descending into every subdirectory except
 * `.stxt` itself: a resolution directory (STXT-DISCOVERY-SPEC) holds schema and template
 * definitions, not documents to process, and every real project has one.
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
