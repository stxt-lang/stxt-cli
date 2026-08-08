/**
 * Implementation of `stxt format <file|dir>... [--recursive] [--tabs|--spaces-4] [--write]
 * [--check]`.
 *
 * Re-serializes every given document through `NodeWriter`, using the canonical indentation
 * (STXT-SPEC's own normalization) instead of whatever the document happened to have.
 *
 * Without `--write`, nothing on disk is touched — the reformatted text is only printed to
 * stdout (AGENTS.md's "no destructive defaults": rewriting a file in place needs an explicit
 * flag). `--write`/`-w` is that flag. `--check` is the CI-friendly middle ground: it neither
 * prints nor writes, it only reports which files would change and fails the build if any would,
 * the same way `gofmt -l`/`prettier --check` do.
 *
 * A document with a syntax error cannot be safely reformatted (its tree may be incomplete), so
 * it is reported instead of reformatted, in every mode, and always fails the build.
 */

import * as fs from "fs";
import * as path from "path";
import { IndentStyle, NodeWriter, Parser } from "@stxt-lang/core";
import { CliIO } from "../runtime/Cli";
import { ExitCode } from "../runtime/ExitCode";
import { collectStxtFiles } from "../runtime/StxtFiles";

const RECURSIVE_FLAGS = ["--recursive", "-r"];
const TABS_FLAG = "--tabs";
const SPACES_4_FLAG = "--spaces-4";
const WRITE_FLAGS = ["--write", "-w"];
const CHECK_FLAG = "--check";

/** How `format` treats a document once it is known to reformat cleanly. */
type Mode = "print" | "check" | "write";

/**
 * Dependencies {@link runFormat} needs beyond argument parsing, with a production default so
 * tests can point relative paths at a temporary directory instead of the real one.
 */
export interface FormatDependencies {
    /** Working directory relative paths are resolved against. Defaults to `process.cwd()`. */
    cwd?: string;
}

/**
 * Runs `format`.
 *
 * @param args arguments after `format`: one or more files or directories, `--recursive`, at
 *             most one of `--tabs` (default) / `--spaces-4`, and at most one of `--write`/`-w`
 *             (rewrite in place) / `--check` (report only, write nothing).
 * @param io where to print the reformatted text (no flags), the changed/would-change files
 *           (`--write`/`--check`) and every syntax error found.
 * @param deps injectable dependencies; see {@link FormatDependencies}.
 * @returns `OK` when nothing failed (and, under `--check`, nothing would change), `FAILURE`
 *          when a document has a syntax error or, under `--check` only, would be reformatted,
 *          `USAGE` when the invocation is wrong.
 */
export function runFormat(args: string[], io: CliIO, deps: FormatDependencies = {}): ExitCode {
    const cwd = deps.cwd ?? process.cwd();

    const parsed = parseArgs(args, io);
    if (parsed === null) {
        return ExitCode.USAGE;
    }

    const resolvedTargets = parsed.paths.map(target => path.resolve(cwd, target));
    const files = collectStxtFiles(resolvedTargets, parsed.recursive, "stxt format", io);
    if (files === null) {
        return ExitCode.USAGE;
    }

    let failed = false;
    for (const file of files) {
        if (!formatFile(file, parsed.style, parsed.mode, io)) {
            failed = true;
        }
    }

    return failed ? ExitCode.FAILURE : ExitCode.OK;
}

/** The result of successfully parsing the arguments of `format`. */
interface ParsedArgs {
    paths: string[];
    recursive: boolean;
    style: IndentStyle;
    mode: Mode;
}

/**
 * Parses the arguments of `format`, reporting a usage error on `io`.
 *
 * @param args arguments after `format`.
 * @param io where to report a usage error.
 * @returns the parsed arguments, or null when the invocation is wrong (already reported).
 */
function parseArgs(args: string[], io: CliIO): ParsedArgs | null {
    const paths: string[] = [];
    let recursive = false;
    let tabs = false;
    let spaces4 = false;
    let write = false;
    let check = false;

    for (const arg of args) {
        if (RECURSIVE_FLAGS.includes(arg)) {
            recursive = true;
        } else if (arg === TABS_FLAG) {
            tabs = true;
        } else if (arg === SPACES_4_FLAG) {
            spaces4 = true;
        } else if (WRITE_FLAGS.includes(arg)) {
            write = true;
        } else if (arg === CHECK_FLAG) {
            check = true;
        } else if (arg.startsWith("-")) {
            io.err(`stxt format: unknown option: ${arg}`);
            return null;
        } else {
            paths.push(arg);
        }
    }

    if (paths.length === 0) {
        io.err("stxt format: missing file or directory");
        io.err("Usage: stxt format <file|dir>... [--recursive] [--tabs|--spaces-4] [--write|--check]");
        return null;
    }

    if (tabs && spaces4) {
        io.err(`stxt format: ${TABS_FLAG} and ${SPACES_4_FLAG} cannot be combined`);
        return null;
    }

    if (write && check) {
        io.err(`stxt format: --write and ${CHECK_FLAG} cannot be combined`);
        return null;
    }

    return {
        paths,
        recursive,
        style: spaces4 ? IndentStyle.SPACES_4 : IndentStyle.TABS,
        mode: write ? "write" : check ? "check" : "print",
    };
}

/**
 * Formats one document according to `mode`.
 *
 * @param file absolute path of the document.
 * @param style indentation style to reformat with.
 * @param mode `"print"`: print the reformatted text; `"check"`: report only, write nothing;
 *             `"write"`: rewrite the file in place when it would change.
 * @param io where to report the outcome.
 * @returns false when the file has a syntax error, or (`"check"` only) would be reformatted;
 *          true otherwise.
 */
function formatFile(file: string, style: IndentStyle, mode: Mode, io: CliIO): boolean {
    let content: string;
    try {
        content = fs.readFileSync(file, "utf-8");
    } catch (error) {
        io.out(`${file}: cannot read (${(error as Error).message})`);
        return false;
    }

    const result = new Parser().parseResult(content);
    if (result.hasErrors()) {
        for (const error of result.getErrors()) {
            io.out(`${file}:${error.line}: [${error.code}] ${error.message}`);
        }
        return false;
    }

    const formatted = NodeWriter.toSTXTDocs(result.getNodes(), style);

    if (mode === "print") {
        // One io.out() call per line (CliIO's own contract), not one for the whole block: strip
        // the single trailing newline NodeWriter always produces, since out() adds its own.
        const withoutTrailingNewline = formatted.endsWith("\n") ? formatted.slice(0, -1) : formatted;
        withoutTrailingNewline.split("\n").forEach(line => io.out(line));
        return true;
    }

    if (formatted === content) {
        return true;
    }

    if (mode === "check") {
        io.out(`${file}: would be reformatted`);
        return false;
    }

    fs.writeFileSync(file, formatted, "utf-8");
    io.out(`Formatted ${file}`);
    return true;
}
