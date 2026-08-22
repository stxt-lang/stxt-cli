/**
 * Implementation of `stxt format <file|dir|->... [--recursive] [--tabs|--spaces] [--write]
 * [--check] [--clean]`.
 *
 * Formatting is `Formatter.format()` of `@stxt-lang/core`: the document is rewritten line by
 * line over the original text, so that comments, blank lines and the content of text blocks
 * survive (the rules are documented there; the VS Code extension and the playground call the
 * same formatter, so every tool agrees on what formatting a document means). This command only
 * adds the policy: which files, which mode, and what to do with a document that does not parse.
 *
 * `--clean` is the other, destructive reading of "format": re-serialize the parse tree through
 * `NodeWriter`, which gives the canonical document but keeps only what the tree holds — every
 * comment and every blank line is gone.
 *
 * Without `--write`, nothing on disk is touched — the reformatted text is only printed to
 * stdout (AGENTS.md's "no destructive defaults": rewriting a file in place needs an explicit
 * flag). `--write`/`-w` is that flag. `--check` is the CI-friendly middle ground: it neither
 * prints nor writes, it only reports which files would change and fails the build if any would,
 * the same way `gofmt -l`/`prettier --check` do.
 *
 * A document with a syntax error cannot be safely reformatted (its tree may be incomplete), so
 * it is reported instead of reformatted, in every mode, and always fails the build.
 *
 * `-` reads one document from the standard input (for pipes and editors), reported as `<stdin>`.
 * Its result is printed to stdout, or checked with `--check`; `--write` with `-` is a usage
 * error, since there is no file to write back to.
 */

import * as fs from "fs";
import { Formatter, IndentStyle, NodeWriter, ParseException, Parser } from "@stxt-lang/core";
import { CliIO } from "../runtime/Cli";
import { ExitCode } from "../runtime/ExitCode";
import { collectSources, DocumentSource, readStdin, STDIN_TARGET } from "../runtime/StxtFiles";

const RECURSIVE_FLAGS = ["--recursive", "-r"];
const TABS_FLAG = "--tabs";
const SPACES_FLAG = "--spaces";
const WRITE_FLAGS = ["--write", "-w"];
const CHECK_FLAG = "--check";
const CLEAN_FLAG = "--clean";

/** How `format` treats a document once it is known to reformat cleanly. */
type Mode = "print" | "check" | "write";

/**
 * Dependencies {@link runFormat} needs beyond argument parsing, with a production default so
 * tests can point relative paths at a temporary directory instead of the real one.
 */
export interface FormatDependencies {
    /** Working directory relative paths are resolved against. Defaults to `process.cwd()`. */
    cwd?: string;

    /** How `-` reads the standard input. Defaults to reading the real one. */
    readStdin?: () => string;
}

/**
 * Runs `format`.
 *
 * @param args arguments after `format`: one or more files, directories or `-` (stdin, at most
 *             once, and not with `--write`), `--recursive`, at
 *             most one of `--tabs` (default) / `--spaces`, at most one of `--write`/`-w`
 *             (rewrite in place) / `--check` (report only, write nothing), and `--clean` to
 *             re-serialize the parse tree instead of rewriting the document line by line.
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

    const sources = collectSources(
        parsed.paths, cwd, parsed.recursive, "stxt format", io, deps.readStdin ?? readStdin
    );
    if (sources === null) {
        return ExitCode.USAGE;
    }

    let failed = false;
    for (const source of sources) {
        if (!formatSource(source, parsed.style, parsed.mode, parsed.clean, io)) {
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
    clean: boolean;
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
    let spaces = false;
    let write = false;
    let check = false;
    let clean = false;

    for (const arg of args) {
        if (RECURSIVE_FLAGS.includes(arg)) {
            recursive = true;
        } else if (arg === TABS_FLAG) {
            tabs = true;
        } else if (arg === SPACES_FLAG) {
            spaces = true;
        } else if (WRITE_FLAGS.includes(arg)) {
            write = true;
        } else if (arg === CHECK_FLAG) {
            check = true;
        } else if (arg === CLEAN_FLAG) {
            clean = true;
        } else if (arg === STDIN_TARGET) {
            paths.push(arg);
        } else if (arg.startsWith("-")) {
            io.err(`stxt format: unknown option: ${arg}`);
            return null;
        } else {
            paths.push(arg);
        }
    }

    if (paths.length === 0) {
        io.err("stxt format: missing file or directory");
        io.err("Usage: stxt format <file|dir|->... [--recursive] [--tabs|--spaces] [--write|--check] [--clean]");
        return null;
    }

    if (tabs && spaces) {
        io.err(`stxt format: ${TABS_FLAG} and ${SPACES_FLAG} cannot be combined`);
        return null;
    }

    if (write && check) {
        io.err(`stxt format: --write and ${CHECK_FLAG} cannot be combined`);
        return null;
    }

    if (write && paths.includes(STDIN_TARGET)) {
        io.err(`stxt format: --write cannot be used with ${STDIN_TARGET} (the standard input); the result is printed to stdout`);
        return null;
    }

    return {
        paths,
        recursive,
        style: spaces ? IndentStyle.SPACES_4 : IndentStyle.TABS,
        mode: write ? "write" : check ? "check" : "print",
        clean,
    };
}

/**
 * Formats one document according to `mode`.
 *
 * @param source the document, a file or the standard input (never the latter under `"write"`).
 * @param style indentation style to reformat with.
 * @param mode `"print"`: print the reformatted text; `"check"`: report only, write nothing;
 *             `"write"`: rewrite the file in place when it would change.
 * @param clean true to re-serialize the parse tree (dropping comments and blank lines) instead
 *              of rewriting the document line by line.
 * @param io where to report the outcome.
 * @returns false when the file has a syntax error, or (`"check"` only) would be reformatted;
 *          true otherwise.
 */
function formatSource(source: DocumentSource, style: IndentStyle, mode: Mode, clean: boolean, io: CliIO): boolean {
    const file = source.name;
    let content: string;
    try {
        content = source.read();
    } catch (error) {
        io.out(`${file}: cannot read (${(error as Error).message})`);
        return false;
    }

    let formatted: string;
    let errors: readonly ParseException[];
    if (clean) {
        const result = new Parser().parseResult(content);
        errors = result.getErrors();
        formatted = NodeWriter.toSTXTDocs(result.getNodes(), style);
    } else {
        const result = Formatter.format(content, style);
        errors = result.errors;
        formatted = result.text;
    }

    if (errors.length > 0) {
        for (const error of errors) {
            io.out(`${file}:${error.line}: [${error.code}] ${error.message}`);
        }
        return false;
    }

    if (mode === "print") {
        // One io.out() call per line (CliIO's own contract), not one for the whole block: strip
        // the single trailing newline the formatted text ends with, since out() adds its own.
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
