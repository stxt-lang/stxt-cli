/**
 * Node adapters for the discovery layer of `@stxt-lang/core` (STXT-DISCOVERY-SPEC).
 *
 * The core `DiscoveryResolver` is host-agnostic: it never touches the file system or the
 * environment itself. This module supplies the two adapters a command-line process needs —
 * plain `node:fs` paths and `process.env` — plus {@link createDiscoveryResolver}, the way
 * the rest of the CLI is expected to obtain a resolver.
 *
 * Keeping the adapters injectable (every constructor parameter has a `process`/`os`
 * default) makes the tests deterministic: they pass a fake environment instead of mutating
 * the real one.
 */

import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import {
    Constants,
    DiscoveryEntry,
    DiscoveryEnvironment,
    DiscoveryFileSystem,
    DiscoveryResolver,
} from "@stxt-lang/core";
import { decodeUtf8Strict } from "../runtime/LineReader";

/** Largest definition file a resolution directory loads: the parser's default input limit in characters, times the 4 bytes a character takes at most in UTF-8. */
const MAX_DEFINITION_FILE_BYTES = 4 * Constants.DEFAULT_MAX_INPUT_SIZE;

/** Name of the environment variable that overrides the resolution chain (spec section 6). */
const STXT_PATH_VARIABLE = "STXT_PATH";

/** {@link DiscoveryFileSystem} over the real file system (`node:fs`). */
export class NodeDiscoveryFileSystem implements DiscoveryFileSystem {
    /**
     * Whether a path exists and is a directory.
     *
     * @param dirPath path to check.
     * @returns true for an existing directory; false otherwise, including I/O errors.
     */
    async isDirectory(dirPath: string): Promise<boolean> {
        try {
            return (await fs.stat(dirPath)).isDirectory();
        } catch {
            // The normal case is that the directory does not exist: not an error.
            return false;
        }
    }

    /**
     * Whether a path is a symbolic link: `lstat`, so the link itself is examined, whatever it
     * points to and whether or not the target exists. Only consulted during the project-level
     * ascent (STXT-DISCOVERY-SPEC section 4.1): the `.stxt` of an ancestor that is itself a
     * link forms no level. Node reports a Windows junction as a symbolic link too.
     *
     * @param dirPath path to check.
     * @returns true for a symbolic link; false otherwise, including I/O errors.
     */
    async isSymbolicLink(dirPath: string): Promise<boolean> {
        try {
            return (await fs.lstat(dirPath)).isSymbolicLink();
        } catch {
            // The normal case is that the path does not exist: not an error.
            return false;
        }
    }

    /**
     * Lists the immediate entries of a directory.
     *
     * @param dirPath directory to list.
     * @returns the entries, with full paths.
     */
    async listDirectory(dirPath: string): Promise<DiscoveryEntry[]> {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        // Never follow a symbolic link in a resolution directory (STXT-DISCOVERY-SPEC sections
        // 3 and 10): a directory link could loop the descent, a file link could read a file
        // from outside the .stxt/. With withFileTypes a symlink is reported as a symlink (and
        // isDirectory() is false), so filtering them out omits both kinds.
        // A FIFO, socket or device is neither a file nor a directory: reading it could
        // block forever, so it is omitted too.
        return entries
            .filter(entry => !entry.isSymbolicLink() && (entry.isFile() || entry.isDirectory()))
            .map(entry => ({
                path: path.join(dirPath, entry.name),
                name: entry.name,
                isDirectory: entry.isDirectory(),
            }));
    }

    /**
     * Reads a file as UTF-8 text. The decode is strict (STXT-SPEC 3): a definition that is
     * not valid UTF-8 is a read error, never silently decoded with U+FFFD.
     *
     * @param filePath file to read.
     * @returns the text content.
     */
    async readFile(filePath: string): Promise<string> {
        // A definition is parsed with the default limits (DEFAULT_MAX_INPUT_SIZE characters, at
        // most 4 bytes each in UTF-8): a bigger file cannot be within them, so it is rejected
        // by size before being read whole. The error becomes DISCOVERY_NOT_PARSEABLE.
        const { size } = await fs.stat(filePath);
        if (size > MAX_DEFINITION_FILE_BYTES) {
            throw new Error(`Definition file larger than ${MAX_DEFINITION_FILE_BYTES} bytes: ${filePath}`);
        }
        return decodeUtf8Strict(await fs.readFile(filePath), filePath);
    }

    /**
     * Parent directory of a path, or null at the file-system root.
     *
     * @param dirPath path whose parent is wanted.
     * @returns the parent, or null when `dirPath` is a root (`/`, `C:\`).
     */
    parentOf(dirPath: string): string | null {
        const parent = path.dirname(dirPath);

        return parent === dirPath ? null : parent;
    }

    /**
     * Joins a directory and a child name with the platform separator.
     *
     * @param dirPath base directory.
     * @param name child segment.
     * @returns the joined path.
     */
    join(dirPath: string, name: string): string {
        return path.join(dirPath, name);
    }
}

/**
 * {@link DiscoveryEnvironment} over the real process environment: `STXT_PATH`, the user
 * level at `$HOME/.stxt` (`%USERPROFILE%\.stxt` on Windows) and the system level at
 * `/etc/stxt` (`%ProgramData%\stxt` on Windows), as STXT-DISCOVERY-SPEC section 4.2 fixes.
 */
export class NodeDiscoveryEnvironment implements DiscoveryEnvironment {
    /**
     * Creates the environment. The parameters exist for the tests; production code uses
     * the defaults.
     *
     * @param env environment variables (defaults to `process.env`).
     * @param platform platform identifier (defaults to `process.platform`).
     * @param homeDir user home directory (defaults to `os.homedir()`).
     */
    constructor(
        private readonly env: NodeJS.ProcessEnv = process.env,
        private readonly platform: NodeJS.Platform = process.platform,
        private readonly homeDir: string = os.homedir()
    ) {}

    /**
     * The `STXT_PATH` override, split by the platform path delimiter (`:` or `;`).
     *
     * @returns the entries (empty entries dropped), an empty array when the variable is
     *          defined but empty, or null when it is not defined.
     */
    getStxtPath(): string[] | null {
        const value = this.env[STXT_PATH_VARIABLE];

        if (value === undefined) {
            return null;
        }

        return value.split(path.delimiter).filter(entry => entry !== "");
    }

    /**
     * The user-level directory: `.stxt` inside the user's home.
     *
     * @returns the user-level directory, or null when the home is unknown.
     */
    getUserLevelDir(): string | null {
        return this.homeDir ? path.join(this.homeDir, ".stxt") : null;
    }

    /**
     * The system-level directory: `/etc/stxt`, or `%ProgramData%\stxt` on Windows.
     *
     * @returns the system-level directory, or null when it cannot be determined
     *          (Windows without `ProgramData` defined).
     */
    getSystemLevelDir(): string | null {
        if (this.platform === "win32") {
            const programData = this.env["ProgramData"];

            return programData ? path.join(programData, "stxt") : null;
        }

        return "/etc/stxt";
    }
}

/**
 * The resolver the CLI commands should use: core `DiscoveryResolver` over the real file
 * system and environment.
 *
 * @param env environment variables, injectable for tests (defaults to `process.env`).
 * @returns a ready-to-use resolver.
 */
export function createDiscoveryResolver(env: NodeJS.ProcessEnv = process.env): DiscoveryResolver {
    return new DiscoveryResolver(new NodeDiscoveryFileSystem(), new NodeDiscoveryEnvironment(env));
}
