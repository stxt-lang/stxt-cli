/**
 * Expands command-line targets (files or directories) into a flat list of `*.stxt` files,
 * shared by every command that walks a directory tree the same way (`check`, `format`).
 */

import * as fs from "fs";
import * as path from "path";
import { CliIO } from "./Cli";

/**
 * Expands the given targets into a flat list of document files: a file is kept as-is (even if it
 * turns out not to exist, so that it is reported per-file instead of aborting the whole run), a
 * directory is expanded to the `*.stxt` files under it, recursively.
 *
 * @param targets absolute paths given on the command line.
 * @param recursive whether directories may be descended into at all.
 * @param commandPrefix the calling command's own error prefix (e.g. `"stxt check"`).
 * @param io where to report a usage error.
 * @returns the files to process, or null when a directory was given without `--recursive`
 *          (already reported).
 */
export function collectStxtFiles(
    targets: string[],
    recursive: boolean,
    commandPrefix: string,
    io: CliIO
): string[] | null {
    const files: string[] = [];

    for (const target of targets) {
        let isDirectory = false;
        try {
            isDirectory = fs.statSync(target).isDirectory();
        } catch {
            // Missing or unreadable: kept as a single "file", reported once processed.
        }

        if (!isDirectory) {
            files.push(target);
        } else if (!recursive) {
            io.err(`${commandPrefix}: ${target} is a directory (use --recursive/-r to descend into it)`);
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
