import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { CliIO, run } from "../runtime/Cli";
import { ExitCode } from "../runtime/ExitCode";
import { FormatDependencies, runFormat } from "../command/Format";
import { InlineNode, Parser, TextNode } from "@stxt-lang/core";

/** A {@link CliIO} that records every line instead of printing it. */
class CapturedIO implements CliIO {
    readonly outLines: string[] = [];
    readonly errLines: string[] = [];

    out(line: string): void {
        this.outLines.push(line);
    }

    err(line: string): void {
        this.errLines.push(line);
    }
}

// Mixes a 4-space and a tab indentation, both valid on their own, so reformatting to a single
// canonical style always changes the text.
const MESSY_DOC = [
    "Documento (test.cli):",
    "    Titulo: Hello",
    "\tExtra: value",
    "",
].join("\n");

const CANONICAL_TABS = [
    "Documento (test.cli):",
    "\tTitulo: Hello",
    "\tExtra: value",
    "",
].join("\n");

const CANONICAL_SPACES_4 = [
    "Documento (test.cli):",
    "    Titulo: Hello",
    "    Extra: value",
    "",
].join("\n");

// A tab immediately followed by a space in the indentation: INDENTATION_MIXED (syntax error),
// so it cannot be safely reformatted.
const SYNTAX_INVALID_DOC = [
    "Documento (test.cli):",
    "\t Titulo: Hello",
    "",
].join("\n");

// Everything formatting must not lose: comments (at the margin and indented), blank lines, and
// the content of a text block, all of it around node lines that do need reindenting. The
// indented comment is written with spaces so that formatting to tabs has to convert it, and the
// blank line inside the block is written empty so that formatting has to indent it.
const COMMENTED_DOC = [
    "# top comment",
    "Documento (test.cli):",
    "    # indented comment",
    "    Titulo:Hello",
    "",
    "\tCuerpo >>",
    "\t\tfirst line",
    "",
    "\t\t    indented content",
    "",
].join("\n");

const COMMENTED_TABS = [
    "# top comment",
    "Documento (test.cli):",
    "\t# indented comment",
    "\tTitulo: Hello",
    "",
    "\tCuerpo >>",
    "\t\tfirst line",
    "\t\t",
    "\t\t    indented content",
    "",
].join("\n");

describe("format", () => {
    let tempRoot: string;
    let projectDir: string;
    let deps: FormatDependencies;

    beforeEach(() => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stxt-cli-format-"));
        projectDir = path.join(tempRoot, "project");
        fs.mkdirSync(path.join(projectDir, ".stxt"), { recursive: true });
        fs.writeFileSync(path.join(projectDir, ".stxt", "ignored.stxt"), MESSY_DOC, "utf-8");
        fs.writeFileSync(path.join(projectDir, "messy.stxt"), MESSY_DOC, "utf-8");
        fs.writeFileSync(path.join(projectDir, "broken.stxt"), SYNTAX_INVALID_DOC, "utf-8");
        fs.writeFileSync(path.join(projectDir, "commented.stxt"), COMMENTED_DOC, "utf-8");
        deps = { cwd: projectDir };
    });

    afterEach(() => {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    describe("default (print, no flags)", () => {

        it("prints the reformatted text with tabs by default, without touching the file", async () => {
            const io = new CapturedIO();

            const code = await runFormat([path.join(projectDir, "messy.stxt")], io, deps);

            assert.strictEqual(code, ExitCode.OK);
            assert.strictEqual(io.outLines.join("\n") + "\n", CANONICAL_TABS);
            assert.strictEqual(fs.readFileSync(path.join(projectDir, "messy.stxt"), "utf-8"), MESSY_DOC);
        });

        it("prints with 4 spaces given --spaces", async () => {
            const io = new CapturedIO();

            const code = await runFormat([path.join(projectDir, "messy.stxt"), "--spaces"], io, deps);

            assert.strictEqual(code, ExitCode.OK);
            assert.strictEqual(io.outLines.join("\n") + "\n", CANONICAL_SPACES_4);
        });

        it("reports a syntax error instead of reformatting, and fails the build", async () => {
            const io = new CapturedIO();

            const code = await runFormat([path.join(projectDir, "broken.stxt")], io, deps);

            assert.strictEqual(code, ExitCode.FAILURE);
            assert.ok(io.outLines.some(line => line.includes("INDENTATION_MIXED")));
        });
    });

    describe("comments, blank lines and text blocks", () => {

        it("keeps them while reindenting the node lines", async () => {
            const io = new CapturedIO();

            const code = await runFormat([path.join(projectDir, "commented.stxt")], io, deps);

            assert.strictEqual(code, ExitCode.OK);
            assert.strictEqual(io.outLines.join("\n") + "\n", COMMENTED_TABS);
        });

        it("leaves an already canonical document untouched under --write", async () => {
            fs.writeFileSync(path.join(projectDir, "commented.stxt"), COMMENTED_TABS, "utf-8");
            const io = new CapturedIO();

            const code = await runFormat([path.join(projectDir, "commented.stxt"), "--write"], io, deps);

            assert.strictEqual(code, ExitCode.OK);
            assert.strictEqual(io.outLines.length, 0);
            assert.strictEqual(fs.readFileSync(path.join(projectDir, "commented.stxt"), "utf-8"), COMMENTED_TABS);
        });

        it("keeps comments when writing the file in place", async () => {
            const io = new CapturedIO();

            const code = await runFormat([path.join(projectDir, "commented.stxt"), "--write"], io, deps);

            assert.strictEqual(code, ExitCode.OK);
            assert.strictEqual(fs.readFileSync(path.join(projectDir, "commented.stxt"), "utf-8"), COMMENTED_TABS);
        });

        // A blank line that precedes more block text is "" in the content whatever it looks
        // like in the source (STXT-SPEC 10.3), so formatting writes it with the indentation of
        // the block: the block reads as one piece. The final blank lines of a block are not
        // content (the parser drops them when the block closes), so they stay plain, like
        // blank lines outside blocks, which have no level and stay empty.
        describe("blank lines of a text block", () => {

            const DOC = [
                "Documento (test.cli):",
                "",
                "\tCuerpo >>",
                "\t\tfirst",
                "",
                "\t",
                "\t\t\t\t",
                "\t\tlast",
                "\t\t\t",
            ].join("\n");

            it("indents them with tabs to the level of the block; the final one stays plain", async () => {
                fs.writeFileSync(path.join(projectDir, "blank.stxt"), DOC, "utf-8");
                const io = new CapturedIO();

                const code = await runFormat([path.join(projectDir, "blank.stxt")], io, deps);

                assert.strictEqual(code, ExitCode.OK);
                assert.deepStrictEqual(io.outLines, [
                    "Documento (test.cli):",
                    "",
                    "\tCuerpo >>",
                    "\t\tfirst",
                    "\t\t",
                    "\t\t",
                    "\t\t",
                    "\t\tlast",
                ]);
            });

            it("indents them with spaces given --spaces", async () => {
                fs.writeFileSync(path.join(projectDir, "blank.stxt"), DOC, "utf-8");
                const io = new CapturedIO();

                const code = await runFormat([path.join(projectDir, "blank.stxt"), "--spaces"], io, deps);

                assert.strictEqual(code, ExitCode.OK);
                assert.deepStrictEqual(io.outLines.slice(3), [
                    "        first",
                    "        ",
                    "        ",
                    "        ",
                    "        last",
                ]);
            });

            it("keeps the block content; the final blank line is not content", async () => {
                fs.writeFileSync(path.join(projectDir, "blank.stxt"), DOC, "utf-8");
                const io = new CapturedIO();
                await runFormat([path.join(projectDir, "blank.stxt")], io, deps);

                const blockOf = (text: string): string => {
                    const root = new Parser().parse(text)[0] as InlineNode;
                    return (root.getChildren()[0] as TextNode).getText();
                };
                assert.strictEqual(blockOf(io.outLines.join("\n")), blockOf(DOC));
                assert.strictEqual(blockOf(DOC), "first\n\n\n\nlast");
            });
        });

        // A comment has no level of its own (STXT-SPEC does not validate its indentation), so
        // formatting converts as many whole indentation units as it has, one for one, and keeps
        // whatever follows them: the comment does not stay in the old style, and its own extra
        // spacing is not touched.
        describe("comment indentation", () => {

            // STXT-SPEC §9: the indentation of a comment is validated like a node's, so every
            // comment of a document that parses has a whole number of units, at most one level
            // deeper than the last node.
            const DOC = [
                "# top comment",
                "Documento (test.cli):",
                "\t# tab comment",
                "    # spaces comment",
                "\tTitulo: Hello",
                "\t\t# two units, after a childless node",
                "",
            ].join("\n");

            it("converts the units of every comment to tabs", async () => {
                fs.writeFileSync(path.join(projectDir, "comments.stxt"), DOC, "utf-8");
                const io = new CapturedIO();

                const code = await runFormat([path.join(projectDir, "comments.stxt")], io, deps);

                assert.strictEqual(code, ExitCode.OK);
                assert.deepStrictEqual(io.outLines, [
                    "# top comment",
                    "Documento (test.cli):",
                    "\t# tab comment",
                    "\t# spaces comment",
                    "\tTitulo: Hello",
                    "\t\t# two units, after a childless node",
                ]);
            });

            it("converts the units of every comment to spaces", async () => {
                fs.writeFileSync(path.join(projectDir, "comments.stxt"), DOC, "utf-8");
                const io = new CapturedIO();

                const code = await runFormat([path.join(projectDir, "comments.stxt"), "--spaces"], io, deps);

                assert.strictEqual(code, ExitCode.OK);
                assert.deepStrictEqual(io.outLines, [
                    "# top comment",
                    "Documento (test.cli):",
                    "    # tab comment",
                    "    # spaces comment",
                    "    Titulo: Hello",
                    "        # two units, after a childless node",
                ]);
            });

            it("reports a comment with invalid indentation as a syntax error, like a node", async () => {
                const doc = "Documento (test.cli):\n\t\t  # mixed\n  # two spaces\n\t\t# level 2 after level 0\n";
                fs.writeFileSync(path.join(projectDir, "comments.stxt"), doc, "utf-8");
                const io = new CapturedIO();

                const code = await runFormat([path.join(projectDir, "comments.stxt")], io, deps);

                assert.strictEqual(code, ExitCode.FAILURE);
                assert.deepStrictEqual(io.outLines.map((l) => l.replace(projectDir, "<dir>")), [
                    "<dir>/comments.stxt:2: [INDENTATION_MIXED] Mixed tabs and spaces in indentation",
                    "<dir>/comments.stxt:3: [INDENTATION_SPACES_NOT_VALID] There are 2 spaces before node",
                    "<dir>/comments.stxt:4: [INDENTATION_LEVEL_NOT_VALID] Level of indent incorrect: 2",
                ]);
            });

            it("is idempotent and round-trips between tabs and spaces", async () => {
                fs.writeFileSync(path.join(projectDir, "comments.stxt"), DOC, "utf-8");
                const toSpaces = new CapturedIO();
                await runFormat([path.join(projectDir, "comments.stxt"), "--spaces"], toSpaces, deps);
                fs.writeFileSync(path.join(projectDir, "spaced.stxt"), toSpaces.outLines.join("\n") + "\n", "utf-8");

                const again = new CapturedIO();
                await runFormat([path.join(projectDir, "spaced.stxt"), "--spaces"], again, deps);
                assert.deepStrictEqual(again.outLines, toSpaces.outLines);

                const backToTabs = new CapturedIO();
                await runFormat([path.join(projectDir, "spaced.stxt")], backToTabs, deps);
                const tabs = new CapturedIO();
                await runFormat([path.join(projectDir, "comments.stxt")], tabs, deps);
                assert.deepStrictEqual(backToTabs.outLines, tabs.outLines);
            });
        });
    });

    describe("--clean", () => {

        it("drops comments and blank lines, keeping the nodes", async () => {
            const io = new CapturedIO();

            const code = await runFormat([path.join(projectDir, "commented.stxt"), "--clean"], io, deps);

            assert.strictEqual(code, ExitCode.OK);
            assert.ok(!io.outLines.some(line => line.includes("comment")));
            assert.ok(io.outLines.includes("Documento (test.cli):"));
            assert.ok(io.outLines.includes("\tTitulo: Hello"));
            assert.ok(io.outLines.includes("\t\tfirst line"));
        });

        it("is what actually rewrites the file, given --write", async () => {
            const io = new CapturedIO();

            const code = await runFormat([path.join(projectDir, "commented.stxt"), "--clean", "--write"], io, deps);

            assert.strictEqual(code, ExitCode.OK);
            const written = fs.readFileSync(path.join(projectDir, "commented.stxt"), "utf-8");
            assert.ok(!written.includes("comment"));
            assert.ok(written.includes("\tTitulo: Hello"));
        });

        it("still reports a syntax error instead of reformatting", async () => {
            const io = new CapturedIO();

            const code = await runFormat([path.join(projectDir, "broken.stxt"), "--clean"], io, deps);

            assert.strictEqual(code, ExitCode.FAILURE);
            assert.ok(io.outLines.some(line => line.includes("INDENTATION_MIXED")));
        });
    });

    describe("--check", () => {

        it("reports a file that would be reformatted and fails the build", async () => {
            const io = new CapturedIO();

            const code = await runFormat([path.join(projectDir, "messy.stxt"), "--check"], io, deps);

            assert.strictEqual(code, ExitCode.FAILURE);
            assert.ok(io.outLines.some(line => line.includes("would be reformatted")));
            assert.strictEqual(fs.readFileSync(path.join(projectDir, "messy.stxt"), "utf-8"), MESSY_DOC);
        });

        it("passes silently when the file is already canonical", async () => {
            fs.writeFileSync(path.join(projectDir, "clean.stxt"), CANONICAL_TABS, "utf-8");
            const io = new CapturedIO();

            const code = await runFormat([path.join(projectDir, "clean.stxt"), "--check"], io, deps);

            assert.strictEqual(code, ExitCode.OK);
            assert.strictEqual(io.outLines.length, 0);
        });

        it("still fails on a syntax error", async () => {
            const io = new CapturedIO();

            const code = await runFormat([path.join(projectDir, "broken.stxt"), "--check"], io, deps);

            assert.strictEqual(code, ExitCode.FAILURE);
            assert.ok(io.outLines.some(line => line.includes("INDENTATION_MIXED")));
        });
    });

    describe("--write", () => {

        it("rewrites the file in place and reports it", async () => {
            const io = new CapturedIO();

            const code = await runFormat([path.join(projectDir, "messy.stxt"), "--write"], io, deps);

            assert.strictEqual(code, ExitCode.OK);
            assert.ok(io.outLines.some(line => line.includes("Formatted")));
            assert.strictEqual(fs.readFileSync(path.join(projectDir, "messy.stxt"), "utf-8"), CANONICAL_TABS);
        });

        it("does nothing and reports nothing when already canonical", async () => {
            fs.writeFileSync(path.join(projectDir, "clean.stxt"), CANONICAL_TABS, "utf-8");
            const io = new CapturedIO();

            const code = await runFormat([path.join(projectDir, "clean.stxt"), "--write"], io, deps);

            assert.strictEqual(code, ExitCode.OK);
            assert.strictEqual(io.outLines.length, 0);
        });

        it("accepts -w as an alias", async () => {
            const io = new CapturedIO();

            const code = await runFormat([path.join(projectDir, "messy.stxt"), "-w"], io, deps);

            assert.strictEqual(code, ExitCode.OK);
            assert.strictEqual(fs.readFileSync(path.join(projectDir, "messy.stxt"), "utf-8"), CANONICAL_TABS);
        });

        it("does not write a file with a syntax error, and fails the build", async () => {
            const io = new CapturedIO();

            const code = await runFormat([path.join(projectDir, "broken.stxt"), "--write"], io, deps);

            assert.strictEqual(code, ExitCode.FAILURE);
            assert.strictEqual(fs.readFileSync(path.join(projectDir, "broken.stxt"), "utf-8"), SYNTAX_INVALID_DOC);
        });
    });

    describe("directories and --recursive", () => {

        it("rejects a directory without --recursive", async () => {
            const io = new CapturedIO();

            const code = await runFormat([projectDir], io, deps);

            assert.strictEqual(code, ExitCode.USAGE);
            assert.ok(io.errLines[0].includes("--recursive"));
        });

        it("descends into subdirectories with --recursive, skipping .stxt", async () => {
            const io = new CapturedIO();

            const code = await runFormat([projectDir, "--recursive", "--check"], io, deps);

            assert.strictEqual(code, ExitCode.FAILURE);
            assert.ok(io.outLines.some(line => line.includes("messy.stxt")));
            assert.ok(!io.outLines.some(line => line.includes(`${path.sep}.stxt${path.sep}`)));
        });

        it("accepts -r as an alias for --recursive", async () => {
            const io = new CapturedIO();

            const code = await runFormat([projectDir, "-r", "--check"], io, deps);

            assert.strictEqual(code, ExitCode.FAILURE);
            assert.ok(io.outLines.some(line => line.includes("messy.stxt")));
        });
    });

    describe("standard input (-)", () => {

        it("prints the reformatted text read from stdin", async () => {
            const io = new CapturedIO();

            const code = await runFormat(["-"], io, { ...deps, readStdin: () => MESSY_DOC });

            assert.strictEqual(code, ExitCode.OK);
            assert.strictEqual(io.outLines.join("\n") + "\n", CANONICAL_TABS);
        });

        it("honours --spaces and --clean", async () => {
            const io = new CapturedIO();

            const code = await runFormat(["-", "--spaces", "--clean"], io, { ...deps, readStdin: () => COMMENTED_DOC });

            assert.strictEqual(code, ExitCode.OK);
            assert.ok(io.outLines.every(line => !line.includes("#")));
            assert.ok(io.outLines[1].startsWith("    Titulo: Hello"));
        });

        it("reports a syntax error as <stdin> and fails the build", async () => {
            const io = new CapturedIO();

            const code = await runFormat(["-"], io, { ...deps, readStdin: () => SYNTAX_INVALID_DOC });

            assert.strictEqual(code, ExitCode.FAILURE);
            assert.ok(io.outLines[0].startsWith("<stdin>:2: [INDENTATION_MIXED]"), io.outLines[0]);
        });

        it("under --check, reports <stdin> when it would change and passes when canonical", async () => {
            const changed = new CapturedIO();
            const same = new CapturedIO();

            const changedCode = await runFormat(["-", "--check"], changed, { ...deps, readStdin: () => MESSY_DOC });
            const sameCode = await runFormat(["-", "--check"], same, { ...deps, readStdin: () => CANONICAL_TABS });

            assert.strictEqual(changedCode, ExitCode.FAILURE);
            assert.deepStrictEqual(changed.outLines, ["<stdin>: would be reformatted"]);
            assert.strictEqual(sameCode, ExitCode.OK);
            assert.strictEqual(same.outLines.length, 0);
        });

        it("rejects --write and -w with -, since there is no file to write back to", async () => {
            for (const flag of ["--write", "-w"]) {
                const io = new CapturedIO();

                const code = await runFormat(["-", flag], io, { ...deps, readStdin: () => MESSY_DOC });

                assert.strictEqual(code, ExitCode.USAGE, flag);
                assert.ok(io.errLines[0].includes("--write cannot be used with -"));
            }
        });

        it("rejects - given more than once", async () => {
            const io = new CapturedIO();

            const code = await runFormat(["-", "-"], io, { ...deps, readStdin: () => MESSY_DOC });

            assert.strictEqual(code, ExitCode.USAGE);
            assert.ok(io.errLines[0].includes("only once"));
        });
    });

    describe("argument handling", () => {

        it("rejects a missing file or directory", async () => {
            const io = new CapturedIO();

            const code = await runFormat([], io, deps);

            assert.strictEqual(code, ExitCode.USAGE);
            assert.ok(io.errLines[0].includes("missing file or directory"));
        });

        it("rejects an unknown option", async () => {
            const io = new CapturedIO();

            const code = await runFormat([path.join(projectDir, "messy.stxt"), "--nope"], io, deps);

            assert.strictEqual(code, ExitCode.USAGE);
            assert.ok(io.errLines[0].includes("--nope"));
        });

        it("rejects an unknown single-dash option instead of treating it as a path", async () => {
            const io = new CapturedIO();

            const code = await runFormat([path.join(projectDir, "messy.stxt"), "-x"], io, deps);

            assert.strictEqual(code, ExitCode.USAGE);
            assert.ok(io.errLines[0].includes("-x"));
        });

        it("rejects the former --spaces-4 option", async () => {
            const io = new CapturedIO();

            const code = await runFormat([path.join(projectDir, "messy.stxt"), "--spaces-4"], io, deps);

            assert.strictEqual(code, ExitCode.USAGE);
            assert.ok(io.errLines[0].includes("unknown option"));
        });

        it("rejects combining --tabs and --spaces", async () => {
            const io = new CapturedIO();

            const code = await runFormat([path.join(projectDir, "messy.stxt"), "--tabs", "--spaces"], io, deps);

            assert.strictEqual(code, ExitCode.USAGE);
            assert.ok(io.errLines[0].includes("cannot be combined"));
        });

        it("rejects combining --write and --check", async () => {
            const io = new CapturedIO();

            const code = await runFormat([path.join(projectDir, "messy.stxt"), "--write", "--check"], io, deps);

            assert.strictEqual(code, ExitCode.USAGE);
            assert.ok(io.errLines[0].includes("cannot be combined"));
        });
    });

    describe("CLI dispatcher", () => {

        it("is reachable through 'stxt format'", async () => {
            const io = new CapturedIO();
            const cwd = process.cwd();

            try {
                process.chdir(projectDir);
                const code = await run(["format", "messy.stxt", "--check"], io);

                assert.strictEqual(code, ExitCode.FAILURE);
            } finally {
                process.chdir(cwd);
            }
        });
    });
});

describe("format parser limits (STXT-SPEC 11.2)", () => {
    let tempRoot: string;

    before(() => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stxt-cli-format-limits-"));
        fs.writeFileSync(path.join(tempRoot, "long.stxt"), "Name: " + "x".repeat(50) + "\n", "utf-8");
    });

    after(() => {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    it("reports a limit error like any syntax error and does not reformat", () => {
        const io = new CapturedIO();

        const code = runFormat(["long.stxt", "--max-line-length", "20"], io, { cwd: tempRoot });

        assert.strictEqual(code, ExitCode.FAILURE);
        assert.ok(io.outLines.some(line => line.includes("LIMIT_LINE_LENGTH_EXCEEDED")), io.outLines.join("\n"));
    });

    it("-1 disables the limit in the line-by-line engine and in --clean", () => {
        for (const args of [
            ["long.stxt", "--max-line-length", "-1"],
            ["long.stxt", "--clean", "--max-line-length", "-1"],
        ]) {
            const io = new CapturedIO();

            const code = runFormat([...args, "--max-line-length", "-1"], io, { cwd: tempRoot });

            assert.strictEqual(code, ExitCode.OK, args.join(" "));
            assert.strictEqual(io.outLines[0], "Name: " + "x".repeat(50), args.join(" "));
        }
    });

    it("rejects a bad limit value as a usage error", () => {
        const io = new CapturedIO();

        const code = runFormat(["long.stxt", "--max-nesting", "deep"], io, { cwd: tempRoot });

        assert.strictEqual(code, ExitCode.USAGE);
        assert.ok(io.errLines[0].includes("-1 disables the limit"));
    });
});
