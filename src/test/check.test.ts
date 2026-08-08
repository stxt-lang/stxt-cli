import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DiscoveryResolver } from "@stxt-lang/core";
import { CliIO, run } from "../runtime/Cli";
import { ExitCode } from "../runtime/ExitCode";
import { CheckDependencies, runCheck } from "../command/Check";
import { NodeDiscoveryEnvironment, NodeDiscoveryFileSystem } from "../discovery/NodeDiscovery";

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

// A @stxt.template defining namespace "test.cli": one root node "Documento", requiring
// exactly one "Titulo" child. Reused from discovery.test.ts, already proven to compile.
const TEMPLATE = [
    "Template (@stxt.template): test.cli",
    "\tStructure >>",
    "\t\tDocumento (test.cli):",
    "\t\t\tTitulo: (1)",
    "",
].join("\n");

const VALID_DOC = [
    "Documento (test.cli):",
    "\tTitulo: Hello",
    "",
].join("\n");

// Missing the required "Titulo" child: a schema (validation) error, not a syntax one.
const SCHEMA_INVALID_DOC = [
    "Documento (test.cli):",
    "",
].join("\n");

// A tab immediately followed by a space in the indentation: MIXED_INDENTATION (syntax).
const SYNTAX_INVALID_DOC = [
    "Documento (test.cli):",
    "\t Titulo: Hello",
    "",
].join("\n");

describe("check", () => {
    let tempRoot: string;
    let projectDir: string;
    let deps: CheckDependencies;

    before(() => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stxt-cli-check-"));
        projectDir = path.join(tempRoot, "project");
        fs.mkdirSync(path.join(projectDir, ".stxt"), { recursive: true });
        fs.mkdirSync(path.join(projectDir, "sub"), { recursive: true });
        fs.writeFileSync(path.join(projectDir, ".stxt", "test.stxt"), TEMPLATE, "utf-8");
        fs.writeFileSync(path.join(projectDir, "valid.stxt"), VALID_DOC, "utf-8");
        fs.writeFileSync(path.join(projectDir, "invalid.stxt"), SCHEMA_INVALID_DOC, "utf-8");
        fs.writeFileSync(path.join(projectDir, "broken.stxt"), SYNTAX_INVALID_DOC, "utf-8");
        fs.writeFileSync(path.join(projectDir, "sub", "nested.stxt"), VALID_DOC, "utf-8");

        const environment = new NodeDiscoveryEnvironment({}, "linux", path.join(tempRoot, "no-home"));
        const resolver = new DiscoveryResolver(new NodeDiscoveryFileSystem(), environment);
        deps = { cwd: projectDir, resolver: resolver as Pick<DiscoveryResolver, "resolve"> };
    });

    after(() => {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    describe("syntax errors", () => {

        it("fails on a syntax error regardless of schema mode", async () => {
            const io = new CapturedIO();

            const code = await runCheck([path.join(projectDir, "broken.stxt")], io, deps);

            assert.strictEqual(code, ExitCode.FAILURE);
            assert.ok(io.outLines.some(line => line.includes("MIXED_INDENTATION") && line.includes("(error)")));
        });

        it("still fails on a syntax error with --no-schema", async () => {
            const io = new CapturedIO();

            const code = await runCheck([path.join(projectDir, "broken.stxt"), "--no-schema"], io, deps);

            assert.strictEqual(code, ExitCode.FAILURE);
            assert.ok(io.outLines.some(line => line.includes("MIXED_INDENTATION")));
        });
    });

    describe("schema errors", () => {

        it("fails on a schema error by default", async () => {
            const io = new CapturedIO();

            const code = await runCheck([path.join(projectDir, "invalid.stxt")], io, deps);

            assert.strictEqual(code, ExitCode.FAILURE);
            assert.ok(io.outLines.some(line => line.includes("INVALID_NUMBER") && line.includes("(error)")));
        });

        it("reports a schema error as a warning and does not fail with --warn-schema", async () => {
            const io = new CapturedIO();

            const code = await runCheck([path.join(projectDir, "invalid.stxt"), "--warn-schema"], io, deps);

            assert.strictEqual(code, ExitCode.OK);
            assert.ok(io.outLines.some(line => line.includes("INVALID_NUMBER") && line.includes("(warning)")));
        });

        it("does not even look for a schema with --no-schema", async () => {
            const io = new CapturedIO();

            const code = await runCheck([path.join(projectDir, "invalid.stxt"), "--no-schema"], io, deps);

            assert.strictEqual(code, ExitCode.OK);
            assert.strictEqual(io.outLines.length, 0);
        });

        it("passes a document that satisfies its schema", async () => {
            const io = new CapturedIO();

            const code = await runCheck([path.join(projectDir, "valid.stxt")], io, deps);

            assert.strictEqual(code, ExitCode.OK);
            assert.strictEqual(io.outLines.length, 0);
        });

        it("rejects combining --warn-schema and --no-schema", async () => {
            const io = new CapturedIO();

            const code = await runCheck([path.join(projectDir, "valid.stxt"), "--warn-schema", "--no-schema"], io, deps);

            assert.strictEqual(code, ExitCode.USAGE);
            assert.ok(io.errLines[0].includes("cannot be combined"));
        });
    });

    describe("SCHEMA_NOT_FOUND suppression", () => {

        it("does not report SCHEMA_NOT_FOUND when no schema is loaded at all", async () => {
            const orphanDir = fs.mkdtempSync(path.join(tempRoot, "orphan-"));
            const orphanFile = path.join(orphanDir, "post.stxt");
            fs.writeFileSync(orphanFile, "Post (org.example.blog): Hello\n", "utf-8");

            const io = new CapturedIO();
            const code = await runCheck([orphanFile], io, { ...deps, cwd: orphanDir });

            assert.strictEqual(code, ExitCode.OK);
            assert.strictEqual(io.outLines.length, 0);
        });
    });

    describe("directories and --recursive", () => {

        it("rejects a directory without --recursive", async () => {
            const io = new CapturedIO();

            const code = await runCheck([projectDir], io, deps);

            assert.strictEqual(code, ExitCode.USAGE);
            assert.ok(io.errLines[0].includes("--recursive"));
        });

        it("descends into subdirectories with --recursive, skipping .stxt", async () => {
            const io = new CapturedIO();

            const code = await runCheck([projectDir, "--recursive", "--no-schema"], io, deps);

            // valid.stxt, invalid.stxt, broken.stxt and sub/nested.stxt: only broken.stxt has a
            // syntax error, and --no-schema means invalid.stxt's missing Titulo is not checked.
            assert.strictEqual(code, ExitCode.FAILURE);
            assert.ok(io.outLines.some(line => line.includes("broken.stxt")));
            assert.ok(!io.outLines.some(line => line.includes(`${path.sep}.stxt${path.sep}`)));
        });

        it("accepts -r as an alias for --recursive", async () => {
            const io = new CapturedIO();

            const code = await runCheck([projectDir, "-r", "--no-schema"], io, deps);

            assert.strictEqual(code, ExitCode.FAILURE);
            assert.ok(io.outLines.some(line => line.includes("broken.stxt")));
        });
    });

    describe("missing files", () => {

        it("reports a missing file as a failure without crashing", async () => {
            const io = new CapturedIO();

            const code = await runCheck([path.join(projectDir, "missing.stxt")], io, deps);

            assert.strictEqual(code, ExitCode.FAILURE);
            assert.ok(io.outLines.some(line => line.includes("FILE_NOT_READABLE")));
        });
    });

    describe("argument handling", () => {

        it("rejects a missing file or directory", async () => {
            const io = new CapturedIO();

            const code = await runCheck([], io, deps);

            assert.strictEqual(code, ExitCode.USAGE);
            assert.ok(io.errLines[0].includes("missing file or directory"));
        });

        it("rejects an unknown option", async () => {
            const io = new CapturedIO();

            const code = await runCheck([path.join(projectDir, "valid.stxt"), "--nope"], io, deps);

            assert.strictEqual(code, ExitCode.USAGE);
            assert.ok(io.errLines[0].includes("--nope"));
        });

        it("rejects an unknown single-dash option instead of treating it as a path", async () => {
            const io = new CapturedIO();

            const code = await runCheck([path.join(projectDir, "valid.stxt"), "-x"], io, deps);

            assert.strictEqual(code, ExitCode.USAGE);
            assert.ok(io.errLines[0].includes("-x"));
        });

        it("rejects an unknown --format value", async () => {
            const io = new CapturedIO();

            const code = await runCheck([path.join(projectDir, "valid.stxt"), "--format", "xml"], io, deps);

            assert.strictEqual(code, ExitCode.USAGE);
            assert.ok(io.errLines[0].includes("--format"));
        });
    });

    describe("--format json", () => {

        it("prints a well-formed JSON array, even when empty", async () => {
            const io = new CapturedIO();

            const code = await runCheck([path.join(projectDir, "valid.stxt"), "--format", "json"], io, deps);

            assert.strictEqual(code, ExitCode.OK);
            assert.deepStrictEqual(JSON.parse(io.outLines[0]), []);
        });

        it("includes file, line, code, message and severity", async () => {
            const io = new CapturedIO();

            const code = await runCheck([path.join(projectDir, "invalid.stxt"), "--format", "json"], io, deps);

            assert.strictEqual(code, ExitCode.FAILURE);
            const findings = JSON.parse(io.outLines[0]);
            assert.strictEqual(findings.length, 1);
            assert.strictEqual(findings[0].code, "INVALID_NUMBER");
            assert.strictEqual(findings[0].severity, "error");
            assert.ok(findings[0].file.endsWith("invalid.stxt"));
            assert.strictEqual(typeof findings[0].line, "number");
        });
    });

    describe("CLI dispatcher", () => {

        it("is reachable through 'stxt check'", async () => {
            const io = new CapturedIO();
            const cwd = process.cwd();

            try {
                process.chdir(projectDir);
                const code = await run(["check", "valid.stxt"], io);

                assert.strictEqual(code, ExitCode.OK);
            } finally {
                process.chdir(cwd);
            }
        });
    });
});
