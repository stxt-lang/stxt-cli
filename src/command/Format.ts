/**
 * Implementation of `stxt format <file|dir|->... [--recursive] [--tabs|--spaces] [--write]
 * [--check] [--clean]`.
 *
 * Formatting rewrites the document line by line: every line that opens a node is re-rendered in
 * its canonical form (canonical indentation, one space after the colon), the text lines of a
 * block — its blank lines included — are re-indented to the level of their block, and every
 * other line — comments, blank lines — is kept, with only its trailing whitespace removed and, for comments, the
 * indentation units at their start converted to the target style (since STXT-SPEC §9 validates
 * the indentation of a comment like a node's, in a document that parses every comment has a
 * whole number of units; they are converted one for one, and the text after them is kept). This is the same
 * line-preserving strategy `../stxt-vscode`'s `FormattingProvider` uses, so the editor and the
 * command line agree on what formatting a document means.
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
import { IndentStyle, InlineNode, Line, Node, NodeWriter, Observer, Parser, StringUtils, TextNode } from "@stxt-lang/core";
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

    const sourceLines = new SourceLines();
    const parser = new Parser();
    parser.registerObserver(sourceLines);
    const result = parser.parseResult(content);

    if (result.hasErrors()) {
        for (const error of result.getErrors()) {
            io.out(`${file}:${error.line}: [${error.code}] ${error.message}`);
        }
        return false;
    }

    const formatted = clean
        ? NodeWriter.toSTXTDocs(result.getNodes(), style)
        : rewriteLines(content, style, sourceLines);

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

/**
 * The parse of a document seen as source lines: which line opened which node, and which line is
 * a text line of which BLOCK node. It is what lets formatting rewrite the lines the parse tree
 * describes and leave every other line — comments and blank lines, which produce no node —
 * exactly as the author wrote it.
 */
class SourceLines implements Observer {
    private readonly nodeByLine = new Map<number, Node>();
    private readonly textByLine = new Map<number, { node: TextNode; line: Line }>();

    /**
     * Records the line that opened a node.
     *
     * @param node node just opened.
     */
    onCreate(node: Node): void {
        this.nodeByLine.set(node.getLine(), node);
    }

    /** Not used: formatting only needs to know where each node started. */
    onFinish(): void {
        // Intentionally empty.
    }

    /** Not used: comment lines are kept verbatim, so they need no bookkeeping. */
    onComment(): void {
        // Intentionally empty.
    }

    /**
     * Records a text line of an open BLOCK node.
     *
     * @param node BLOCK node the line belongs to.
     * @param lineNumber line number of the text line.
     * @param lineString source line, as it appears in the document.
     * @param line the same line already split into indentation and content.
     */
    onTextLine(node: TextNode, lineNumber: number, lineString: string, line: Line): void {
        this.textByLine.set(lineNumber, { node, line });
    }

    /**
     * @param lineNumber line number, 1-indexed as the parser counts them.
     * @returns the node this line opened, or undefined if it opened none.
     */
    nodeAt(lineNumber: number): Node | undefined {
        return this.nodeByLine.get(lineNumber);
    }

    /**
     * @param lineNumber line number, 1-indexed as the parser counts them.
     * @returns the BLOCK node this line is text of and the line already split into indentation
     *          and content, or undefined if the line is not text of a block.
     */
    textAt(lineNumber: number): { node: TextNode; line: Line } | undefined {
        return this.textByLine.get(lineNumber);
    }
}

/**
 * Rewrites a document line by line, keeping every line the parse tree does not describe (a
 * comment only gets its indentation units converted).
 *
 * @param content the document, as read from disk.
 * @param style indentation style to reformat with.
 * @param sourceLines the parse of `content` seen as source lines.
 * @returns the formatted document, with the line ending and the final newline of the original.
 */
function rewriteLines(content: string, style: IndentStyle, sourceLines: SourceLines): string {
    const eol = content.includes("\r\n") ? "\r\n" : "\n";
    const lines = content.split(/\r?\n/);

    return lines
        .map((line, index) => rewriteLine(line, index + 1, style, sourceLines))
        .join(eol);
}

/**
 * Rewrites one source line.
 *
 * @param line the line, without its line ending.
 * @param lineNumber its line number, 1-indexed as the parser counts them.
 * @param style indentation style to reformat with.
 * @param sourceLines the parse of the document seen as source lines.
 * @returns the formatted line.
 */
function rewriteLine(line: string, lineNumber: number, style: IndentStyle, sourceLines: SourceLines): string {

    const node = sourceLines.nodeAt(lineNumber);
    if (node) {
        return renderNode(node, line, style);
    }

    const text = sourceLines.textAt(lineNumber);
    if (text) {
        // A blank line of the block (STXT-SPEC 10.3: "" in the content, whatever it looks like in
        // the source, trailing ones included) gets the indentation of the block too, so the
        // block reads as one piece and, at the end of the file, the line is not lost — an
        // empty last line would be indistinguishable from the final line ending.
        return indent(text.node.getLevel() + 1, style) + text.line.content;
    }

    // A comment or a blank line: the parse tree says nothing about it, so it is kept as it is —
    // except that the indentation units of a comment are converted to the target style, so a
    // document converted between tabs and spaces does not keep comments in the old style.
    return reindentComment(StringUtils.rightTrim(line), style);
}

/**
 * Converts the indentation units at the start of a comment (or of any line without a level of
 * its own) to the target style: every whole unit — a tab or four spaces, in either style — is
 * replaced by one unit of `style`, and the rest of the line, including any remainder of the
 * indentation that is not a whole unit, is kept exactly as it is. This is the rule the playground
 * uses when it re-indents a document.
 *
 * @param line the line, without trailing whitespace.
 * @param style indentation style to convert to.
 * @returns the line with its indentation units converted.
 */
function reindentComment(line: string, style: IndentStyle): string {
    let consumed = 0;
    let units = 0;
    let unit = unitAt(line, consumed);
    while (unit > 0) {
        consumed += unit;
        units++;
        unit = unitAt(line, consumed);
    }
    return units === 0 ? line : indent(units, style) + line.substring(consumed);
}

/**
 * @param line a line.
 * @param position a position in it.
 * @returns the length of the whole indentation unit — a tab or four spaces — that starts at
 *          `position`, or 0 if none does.
 */
function unitAt(line: string, position: number): number {
    if (line.startsWith("\t", position)) {
        return 1;
    }
    return line.startsWith("    ", position) ? 4 : 0;
}

/**
 * Renders the line that opens a node in its canonical form.
 *
 * The namespace is written only where the source wrote it: a child repeating its parent's
 * namespace is redundant but legal, and dropping it would be an edit, not a reformat.
 *
 * @param node the node the line opens.
 * @param line the source line, used only to tell whether it spelled the namespace out.
 * @param style indentation style to reformat with.
 * @returns the formatted line.
 */
function renderNode(node: Node, line: string, style: IndentStyle): string {
    const head = node instanceof InlineNode ? line.substring(0, line.indexOf(":")) : line;
    const name = head.includes("(")
        ? `${node.getName()} (${node.getNamespace()})`
        : node.getName();

    if (!(node instanceof InlineNode)) {
        return `${indent(node.getLevel(), style)}${name} >>`;
    }

    // A node with no value takes no space after the colon: container nodes would otherwise end
    // in a stray trailing space.
    const value = node.getValue();
    const separator = value.length > 0 ? `: ${value}` : ":";

    return `${indent(node.getLevel(), style)}${name}${separator}`;
}

/**
 * @param level indentation level to produce.
 * @param style indentation style to produce it in.
 * @returns the indentation of that level.
 */
function indent(level: number, style: IndentStyle): string {
    return (style === IndentStyle.SPACES_4 ? "    " : "\t").repeat(level);
}
