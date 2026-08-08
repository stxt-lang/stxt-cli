import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { CliIO, run } from "../runtime/Cli";
import { ExitCode } from "../runtime/ExitCode";
import { FormatDependencies, runFormat } from "../command/Format";

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

// A tab immediately followed by a space in the indentation: MIXED_INDENTATION (syntax error),
// so it cannot be safely reformatted.
const SYNTAX_INVALID_DOC = [
    "Documento (test.cli):",
    "\t Titulo: Hello",
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

        it("prints with 4 spaces given --spaces-4", async () => {
            const io = new CapturedIO();

            const code = await runFormat([path.join(projectDir, "messy.stxt"), "--spaces-4"], io, deps);

            assert.strictEqual(code, ExitCode.OK);
            assert.strictEqual(io.outLines.join("\n") + "\n", CANONICAL_SPACES_4);
        });

        it("reports a syntax error instead of reformatting, and fails the build", async () => {
            const io = new CapturedIO();

            const code = await runFormat([path.join(projectDir, "broken.stxt")], io, deps);

            assert.strictEqual(code, ExitCode.FAILURE);
            assert.ok(io.outLines.some(line => line.includes("MIXED_INDENTATION")));
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
            assert.ok(io.outLines.some(line => line.includes("MIXED_INDENTATION")));
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

        it("rejects combining --tabs and --spaces-4", async () => {
            const io = new CapturedIO();

            const code = await runFormat([path.join(projectDir, "messy.stxt"), "--tabs", "--spaces-4"], io, deps);

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
