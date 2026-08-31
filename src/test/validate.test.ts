import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DiscoveryResolver } from "@stxt-lang/core";
import { run } from "../runtime/Cli";
import { ExitCode } from "../runtime/ExitCode";
import { CapturedIO } from "./TestIO";
import { ValidateDependencies, runValidate } from "../command/Validate";
import { NodeDiscoveryEnvironment, NodeDiscoveryFileSystem } from "../discovery/NodeDiscovery";

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

// A tab immediately followed by a space in the indentation: INDENTATION_MIXED (syntax).
const SYNTAX_INVALID_DOC = [
    "Documento (test.cli):",
    "\t Titulo: Hello",
    "",
].join("\n");

// A @stxt.schema document that is syntactically valid STXT but not a valid schema itself:
// Min greater than Max on the same Child (MIN_GREATER_THAN_MAX).
const BROKEN_SCHEMA_DOC = [
    "Schema (@stxt.schema): test.broken",
    "\tNode: Documento",
    "\t\tChildren:",
    "\t\t\tChild: Titulo",
    "\t\t\t\tMin: 5",
    "\t\t\t\tMax: 1",
    "",
].join("\n");

const VALID_SCHEMA_DOC = [
    "Schema (@stxt.schema): test.valid",
    "\tNode: Documento",
    "\t\tChildren:",
    "\t\t\tChild: Titulo",
    "\t\t\t\tMin: 1",
    "\t\t\t\tMax: 1",
    "\tNode: Titulo",
    "",
].join("\n");

// A @stxt.template missing its required "Structure >>" (TEMPLATE_STRUCTURE_REQUIRED).
const BROKEN_TEMPLATE_DOC = [
    "Template (@stxt.template): test.broken",
    "\tFoo: bar",
    "",
].join("\n");

describe("validate", () => {
    let tempRoot: string;
    let projectDir: string;
    let deps: ValidateDependencies;

    before(() => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stxt-cli-validate-"));
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

            const code = await runValidate([path.join(projectDir, "broken.stxt")], io, deps);

            assert.strictEqual(code, ExitCode.FAILURE);
            assert.ok(io.outLines.some(line => line.includes("INDENTATION_MIXED") && line.includes("(error)")));
        });

        it("still fails on a syntax error with --no-schema", async () => {
            const io = new CapturedIO();

            const code = await runValidate([path.join(projectDir, "broken.stxt"), "--no-schema"], io, deps);

            assert.strictEqual(code, ExitCode.FAILURE);
            assert.ok(io.outLines.some(line => line.includes("INDENTATION_MIXED")));
        });
    });

    describe("schema errors", () => {

        it("fails on a schema error by default", async () => {
            const io = new CapturedIO();

            const code = await runValidate([path.join(projectDir, "invalid.stxt")], io, deps);

            assert.strictEqual(code, ExitCode.FAILURE);
            assert.ok(io.outLines.some(line => line.includes("TOO_FEW_CHILDREN") && line.includes("(error)")));
        });

        it("reports a schema error as a warning and does not fail with --warn-schema", async () => {
            const io = new CapturedIO();

            const code = await runValidate([path.join(projectDir, "invalid.stxt"), "--warn-schema"], io, deps);

            assert.strictEqual(code, ExitCode.OK);
            assert.ok(io.outLines.some(line => line.includes("TOO_FEW_CHILDREN") && line.includes("(warning)")));
        });

        it("does not even look for a schema with --no-schema", async () => {
            const io = new CapturedIO();

            const code = await runValidate([path.join(projectDir, "invalid.stxt"), "--no-schema"], io, deps);

            assert.strictEqual(code, ExitCode.OK);
            assert.strictEqual(io.outLines.length, 0);
        });

        it("passes a document that satisfies its schema", async () => {
            const io = new CapturedIO();

            const code = await runValidate([path.join(projectDir, "valid.stxt")], io, deps);

            assert.strictEqual(code, ExitCode.OK);
            assert.strictEqual(io.outLines.length, 0);
        });

        it("rejects combining --warn-schema and --no-schema", async () => {
            const io = new CapturedIO();

            const code = await runValidate([path.join(projectDir, "valid.stxt"), "--warn-schema", "--no-schema"], io, deps);

            assert.strictEqual(code, ExitCode.USAGE);
            assert.ok(io.errLines[0].includes("cannot be combined"));
        });
    });

    describe("SCHEMA_NOT_FOUND on an empty chain", () => {

        it("fails with SCHEMA_NOT_FOUND when no schema is loaded at all", async () => {
            const orphanDir = fs.mkdtempSync(path.join(tempRoot, "orphan-"));
            const orphanFile = path.join(orphanDir, "post.stxt");
            fs.writeFileSync(orphanFile, "Post (org.example.blog): Hello\n", "utf-8");

            const io = new CapturedIO();
            const code = await runValidate([orphanFile], io, { ...deps, cwd: orphanDir });

            assert.strictEqual(code, ExitCode.FAILURE);
            assert.ok(io.outLines.some(line => line.includes("SCHEMA_NOT_FOUND") && line.includes("(error)")),
                "an unvalidatable document is not a validated one, whatever else the chain holds");
        });

        it("passes a document without namespace when no schema is loaded at all", async () => {
            const orphanDir = fs.mkdtempSync(path.join(tempRoot, "orphan-"));
            const orphanFile = path.join(orphanDir, "note.stxt");
            fs.writeFileSync(orphanFile, "Note: Hello\n\tBody: text\n", "utf-8");

            const io = new CapturedIO();
            const code = await runValidate([orphanFile], io, { ...deps, cwd: orphanDir });

            assert.strictEqual(code, ExitCode.OK);
            assert.strictEqual(io.outLines.length, 0);
        });

        it("only warns with --warn-schema, and says nothing with --no-schema", async () => {
            const orphanDir = fs.mkdtempSync(path.join(tempRoot, "orphan-"));
            const orphanFile = path.join(orphanDir, "post.stxt");
            fs.writeFileSync(orphanFile, "Post (org.example.blog): Hello\n", "utf-8");

            let io = new CapturedIO();
            let code = await runValidate([orphanFile, "--warn-schema"], io, { ...deps, cwd: orphanDir });
            assert.strictEqual(code, ExitCode.OK);
            assert.ok(io.outLines.some(line => line.includes("SCHEMA_NOT_FOUND") && line.includes("(warning)")));

            io = new CapturedIO();
            code = await runValidate([orphanFile, "--no-schema"], io, { ...deps, cwd: orphanDir });
            assert.strictEqual(code, ExitCode.OK);
            assert.strictEqual(io.outLines.length, 0);
        });
    });

    describe("directories and --recursive", () => {

        it("rejects a directory without --recursive", async () => {
            const io = new CapturedIO();

            const code = await runValidate([projectDir], io, deps);

            assert.strictEqual(code, ExitCode.USAGE);
            assert.ok(io.errLines[0].includes("--recursive"));
        });

        it("descends into subdirectories with --recursive, skipping .stxt", async () => {
            const io = new CapturedIO();

            const code = await runValidate([projectDir, "--recursive", "--no-schema"], io, deps);

            // valid.stxt, invalid.stxt, broken.stxt and sub/nested.stxt: only broken.stxt has a
            // syntax error, and --no-schema means invalid.stxt's missing Titulo is not validated.
            assert.strictEqual(code, ExitCode.FAILURE);
            assert.ok(io.outLines.some(line => line.includes("broken.stxt")));
            assert.ok(!io.outLines.some(line => line.includes(`${path.sep}.stxt${path.sep}`)));
        });

        it("accepts -r as an alias for --recursive", async () => {
            const io = new CapturedIO();

            const code = await runValidate([projectDir, "-r", "--no-schema"], io, deps);

            assert.strictEqual(code, ExitCode.FAILURE);
            assert.ok(io.outLines.some(line => line.includes("broken.stxt")));
        });
    });

    describe("missing files", () => {

        it("reports a missing file as a failure without crashing", async () => {
            const io = new CapturedIO();

            const code = await runValidate([path.join(projectDir, "missing.stxt")], io, deps);

            assert.strictEqual(code, ExitCode.FAILURE);
            assert.ok(io.outLines.some(line => line.includes("FILE_NOT_READABLE")));
        });
    });

    describe("standard input (-)", () => {

        it("validates a document read from stdin, reported as <stdin>", async () => {
            const io = new CapturedIO();

            const code = await runValidate(["-"], io, { ...deps, readStdin: () => SYNTAX_INVALID_DOC });

            assert.strictEqual(code, ExitCode.FAILURE);
            assert.ok(io.outLines[0].startsWith("<stdin>:2: [INDENTATION_MIXED]"), io.outLines[0]);
        });

        it("discovers schemas from the working directory, as if the document were a file there", async () => {
            const io = new CapturedIO();

            const code = await runValidate(["-"], io, { ...deps, readStdin: () => SCHEMA_INVALID_DOC });

            assert.strictEqual(code, ExitCode.FAILURE);
            assert.ok(io.outLines.some(line => line.startsWith("<stdin>:") && line.includes("(error)")));
            assert.ok(!io.outLines.some(line => line.includes("INDENTATION_MIXED")));
        });

        it("passes silently on a valid document, and honours --no-schema", async () => {
            for (const args of [["-"], ["-", "--no-schema"]]) {
                const io = new CapturedIO();

                const code = await runValidate(args, io, { ...deps, readStdin: () => VALID_DOC });

                assert.strictEqual(code, ExitCode.OK, args.join(" "));
                assert.strictEqual(io.outLines.length, 0);
            }
        });

        it("names it <stdin> in --format json too", async () => {
            const io = new CapturedIO();

            await runValidate(["-", "--format", "json"], io, { ...deps, readStdin: () => SYNTAX_INVALID_DOC });

            assert.strictEqual(JSON.parse(io.outLines[0])[0].file, "<stdin>");
        });

        it("can be mixed with files, and is validated in the order given", async () => {
            const io = new CapturedIO();

            const code = await runValidate(
                [path.join(projectDir, "broken.stxt"), "-", "--no-schema"], io,
                { ...deps, readStdin: () => SYNTAX_INVALID_DOC }
            );

            assert.strictEqual(code, ExitCode.FAILURE);
            assert.ok(io.outLines[0].includes("broken.stxt"));
            assert.ok(io.outLines[1].startsWith("<stdin>:"));
            assert.strictEqual(io.outLines[2], "2 error(s), 0 warning(s)");
        });

        it("reports a read failure as FILE_NOT_READABLE", async () => {
            const io = new CapturedIO();

            const code = await runValidate(["-"], io, { ...deps, readStdin: () => { throw new Error("EAGAIN"); } });

            assert.strictEqual(code, ExitCode.FAILURE);
            assert.ok(io.outLines[0].startsWith("<stdin>:0: [FILE_NOT_READABLE]"));
        });

        it("rejects - given more than once", async () => {
            const io = new CapturedIO();

            const code = await runValidate(["-", "-"], io, { ...deps, readStdin: () => VALID_DOC });

            assert.strictEqual(code, ExitCode.USAGE);
            assert.ok(io.errLines[0].includes("only once"));
        });
    });

    describe("argument handling", () => {

        it("rejects a missing file or directory", async () => {
            const io = new CapturedIO();

            const code = await runValidate([], io, deps);

            assert.strictEqual(code, ExitCode.USAGE);
            assert.ok(io.errLines[0].includes("missing file or directory"));
        });

        it("rejects an unknown option", async () => {
            const io = new CapturedIO();

            const code = await runValidate([path.join(projectDir, "valid.stxt"), "--nope"], io, deps);

            assert.strictEqual(code, ExitCode.USAGE);
            assert.ok(io.errLines[0].includes("--nope"));
        });

        it("rejects an unknown single-dash option instead of treating it as a path", async () => {
            const io = new CapturedIO();

            const code = await runValidate([path.join(projectDir, "valid.stxt"), "-x"], io, deps);

            assert.strictEqual(code, ExitCode.USAGE);
            assert.ok(io.errLines[0].includes("-x"));
        });

        it("rejects an unknown --format value", async () => {
            const io = new CapturedIO();

            const code = await runValidate([path.join(projectDir, "valid.stxt"), "--format", "xml"], io, deps);

            assert.strictEqual(code, ExitCode.USAGE);
            assert.ok(io.errLines[0].includes("--format"));
        });
    });

    describe("--format json", () => {

        it("prints a well-formed JSON array, even when empty", async () => {
            const io = new CapturedIO();

            const code = await runValidate([path.join(projectDir, "valid.stxt"), "--format", "json"], io, deps);

            assert.strictEqual(code, ExitCode.OK);
            assert.deepStrictEqual(JSON.parse(io.outLines[0]), []);
        });

        it("includes file, line, code, message and severity", async () => {
            const io = new CapturedIO();

            const code = await runValidate([path.join(projectDir, "invalid.stxt"), "--format", "json"], io, deps);

            assert.strictEqual(code, ExitCode.FAILURE);
            const findings = JSON.parse(io.outLines[0]);
            assert.strictEqual(findings.length, 1);
            assert.strictEqual(findings[0].code, "TOO_FEW_CHILDREN");
            assert.strictEqual(findings[0].severity, "error");
            assert.ok(findings[0].file.endsWith("invalid.stxt"));
            assert.strictEqual(typeof findings[0].line, "number");
        });
    });

    describe("self-validating @stxt.schema/@stxt.template documents", () => {
        let defsDir: string;

        before(() => {
            defsDir = fs.mkdtempSync(path.join(tempRoot, "defs-"));
            fs.writeFileSync(path.join(defsDir, "broken-schema.stxt"), BROKEN_SCHEMA_DOC, "utf-8");
            fs.writeFileSync(path.join(defsDir, "valid-schema.stxt"), VALID_SCHEMA_DOC, "utf-8");
            fs.writeFileSync(path.join(defsDir, "broken-template.stxt"), BROKEN_TEMPLATE_DOC, "utf-8");
        });

        it("fails on a @stxt.schema document that is not itself a valid schema", async () => {
            const io = new CapturedIO();

            const code = await runValidate([path.join(defsDir, "broken-schema.stxt")], io, { ...deps, cwd: defsDir });

            assert.strictEqual(code, ExitCode.FAILURE);
            assert.ok(io.outLines.some(line => line.includes("MIN_GREATER_THAN_MAX") && line.includes("(error)")));
        });

        it("fails on a @stxt.template document that is not itself a valid template", async () => {
            const io = new CapturedIO();

            const code = await runValidate([path.join(defsDir, "broken-template.stxt")], io, { ...deps, cwd: defsDir });

            assert.strictEqual(code, ExitCode.FAILURE);
            assert.ok(io.outLines.some(line => line.includes("TEMPLATE_STRUCTURE_REQUIRED")));
        });

        it("passes a @stxt.schema document that is a valid schema", async () => {
            const io = new CapturedIO();

            const code = await runValidate([path.join(defsDir, "valid-schema.stxt")], io, { ...deps, cwd: defsDir });

            assert.strictEqual(code, ExitCode.OK);
        });

        it("downgrades to a warning and does not fail with --warn-schema", async () => {
            const io = new CapturedIO();

            const code = await runValidate(
                [path.join(defsDir, "broken-schema.stxt"), "--warn-schema"], io, { ...deps, cwd: defsDir }
            );

            assert.strictEqual(code, ExitCode.OK);
            assert.ok(io.outLines.some(line => line.includes("MIN_GREATER_THAN_MAX") && line.includes("(warning)")));
        });

        it("is skipped entirely with --no-schema", async () => {
            const io = new CapturedIO();

            const code = await runValidate(
                [path.join(defsDir, "broken-schema.stxt"), "--no-schema"], io, { ...deps, cwd: defsDir }
            );

            assert.strictEqual(code, ExitCode.OK);
            assert.strictEqual(io.outLines.length, 0);
        });
    });

    describe("DiscoveryError reporting", () => {
        let chainDir: string;

        before(() => {
            chainDir = fs.mkdtempSync(path.join(tempRoot, "chain-"));
            fs.mkdirSync(path.join(chainDir, ".stxt"), { recursive: true });
            // Not a @stxt.schema/@stxt.template document: DISCOVERY_NOT_A_DEFINITION.
            fs.writeFileSync(path.join(chainDir, ".stxt", "bad.stxt"), "Post (org.example.blog): Hello\n", "utf-8");
            fs.writeFileSync(path.join(chainDir, "doc.stxt"), "Entry (test.brokenchain): Hello\n", "utf-8");
        });

        it("fails the build and reports the broken definition's own file", async () => {
            const io = new CapturedIO();

            const code = await runValidate([path.join(chainDir, "doc.stxt")], io, { ...deps, cwd: chainDir });

            assert.strictEqual(code, ExitCode.FAILURE);
            assert.ok(io.outLines.some(
                line => line.includes("DISCOVERY_NOT_A_DEFINITION") && line.includes("bad.stxt") && line.includes("(error)")
            ));
        });

        it("downgrades to a warning and does not fail with --warn-schema", async () => {
            const io = new CapturedIO();

            const code = await runValidate(
                [path.join(chainDir, "doc.stxt"), "--warn-schema"], io, { ...deps, cwd: chainDir }
            );

            assert.strictEqual(code, ExitCode.OK);
            assert.ok(io.outLines.some(line => line.includes("DISCOVERY_NOT_A_DEFINITION") && line.includes("(warning)")));
        });

        it("is not looked for at all with --no-schema", async () => {
            const io = new CapturedIO();

            const code = await runValidate([path.join(chainDir, "doc.stxt"), "--no-schema"], io, { ...deps, cwd: chainDir });

            assert.strictEqual(code, ExitCode.OK);
            assert.strictEqual(io.outLines.length, 0);
        });
    });

    describe("parser limits (STXT-SPEC 11.2)", () => {

        /** A document nesting the given number of levels, no namespace so no schema is needed. */
        function nested(levels: number): string {
            let content = "";
            for (let i = 0; i < levels; i++) {
                content += "\t".repeat(i) + "N" + i + ": v\n";
            }
            return content;
        }

        it("fails on a document deeper than the default limit, as the last finding", async () => {
            const deep = path.join(projectDir, "deep.stxt");
            fs.writeFileSync(deep, nested(101), "utf-8");
            const io = new CapturedIO();

            const code = await runValidate([deep, "--no-schema"], io, deps);

            assert.strictEqual(code, ExitCode.FAILURE);
            assert.ok(io.outLines.some(line => line.includes("LIMIT_NESTING_EXCEEDED")));
        });

        it("raises a limit with --max-nesting, and -1 disables it", async () => {
            const deep = path.join(projectDir, "deep.stxt");
            fs.writeFileSync(deep, nested(101), "utf-8");

            for (const value of ["150", "-1"]) {
                const io = new CapturedIO();

                const code = await runValidate(
                    [deep, "--no-schema", "--max-nesting", value], io, deps
                );

                assert.strictEqual(code, ExitCode.OK, value);
                assert.strictEqual(io.outLines.length, 0, value);
            }
        });

        it("lowers a limit with --max-input-size", async () => {
            const io = new CapturedIO();

            const code = await runValidate(
                [path.join(projectDir, "valid.stxt"), "--no-schema", "--max-input-size", "10"],
                io, deps
            );

            assert.strictEqual(code, ExitCode.FAILURE);
            assert.ok(io.outLines.some(line => line.includes("LIMIT_INPUT_SIZE_EXCEEDED")));
        });

        it("rejects a missing or non-integer limit value as a usage error", async () => {
            for (const args of [
                ["valid.stxt", "--max-nesting"],
                ["valid.stxt", "--max-line-length", "many"],
                ["valid.stxt", "--max-input-size", "-2"],
            ]) {
                const io = new CapturedIO();

                const code = await runValidate(args, io, deps);

                assert.strictEqual(code, ExitCode.USAGE, args.join(" "));
                assert.ok(io.errLines[0].includes("-1 disables the limit"), args.join(" "));
            }
        });
    });

    describe("CLI dispatcher", () => {

        it("is reachable through 'stxt validate'", async () => {
            const io = new CapturedIO();
            const cwd = process.cwd();

            try {
                process.chdir(projectDir);
                const code = await run(["validate", "valid.stxt"], io);

                assert.strictEqual(code, ExitCode.OK);
            } finally {
                process.chdir(cwd);
            }
        });
    });
});
