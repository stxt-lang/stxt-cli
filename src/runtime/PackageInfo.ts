import * as fs from "fs";
import * as path from "path";

/** Reported instead of a version number when a `package.json` cannot be read or has no version. */
const UNKNOWN_VERSION = "unknown";

/**
 * Returns the version of this CLI, read at runtime from its own `package.json`.
 *
 * The version is deliberately not duplicated in the source: `package.json` is the only place
 * where it is written, so `npm version` alone is enough to bump it.
 *
 * @returns the version string, or `"unknown"` if `package.json` cannot be read.
 */
export function getCliVersion(): string {
    // This file is compiled to out/runtime/PackageInfo.js, so package.json is two levels up.
    return readVersion(path.join(__dirname, "..", "..", "package.json"));
}

/**
 * Returns the version of the `@stxt-lang/core` package this CLI is running against.
 *
 * The parser lives in a separate package, so the core version is what actually determines how
 * a document is parsed and validated. Reporting it next to the CLI version makes bug reports
 * unambiguous.
 *
 * @returns the version string, or `"unknown"` if the package cannot be resolved.
 */
export function getCoreVersion(): string {
    try {
        return readVersion(require.resolve("@stxt-lang/core/package.json"));
    } catch {
        // Resolution fails only if the dependency is missing; that is not worth an error here.
        return UNKNOWN_VERSION;
    }
}

/**
 * Reads the `version` field of a `package.json` file.
 *
 * @param packageJsonPath absolute path of the file to read.
 * @returns the version string, or `"unknown"` if the file is missing, unreadable or has no version.
 */
/**
 * Version of the STXT specifications the parser implements (`SPEC_VERSION` of `@stxt-lang/core`).
 *
 * It is the answer to "conformant to what?": two installations with different package versions
 * still read and validate the same STXT as long as this number is the same. Read dynamically so
 * the CLI keeps working (printing `unknown`) against a core older than 0.10.0, which did not
 * export it.
 *
 * @returns the spec version, or `unknown` when the core does not expose it.
 */
export function getSpecVersion(): string {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const core = require("@stxt-lang/core") as { SPEC_VERSION?: unknown };

        return typeof core.SPEC_VERSION === "string" ? core.SPEC_VERSION : UNKNOWN_VERSION;
    } catch {
        return UNKNOWN_VERSION;
    }
}

function readVersion(packageJsonPath: string): string {
    try {
        const raw = fs.readFileSync(packageJsonPath, "utf8");
        const parsed = JSON.parse(raw) as { version?: string };

        return parsed.version ?? UNKNOWN_VERSION;
    } catch {
        return UNKNOWN_VERSION;
    }
}
