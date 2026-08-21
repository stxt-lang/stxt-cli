import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { CliIO, run } from "../runtime/Cli";
import { ExitCode } from "../runtime/ExitCode";
import { InstallDependencies, runInstall } from "../command/Install";

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

describe("install", () => {
    let tempRoot: string;
    let projectDir: string;
    let sourceFile: string;
    let userDir: string;
    let systemDir: string;
    let deps: InstallDependencies;

    // Minimal documents that validate against their meta-schema, already in canonical form:
    // installing them must leave exactly this text.
    const SCHEMA_DOC = "Schema (@stxt.schema): test.blog\n\tNode: Article\n";
    const SCHEMA_DESTINATION = path.join("@stxt.schema", "test.blog.stxt");
    const TEMPLATE_DOC =
        "Template (@stxt.template): test.note\n\tStructure >>\n\t\tNote (test.note):\n\t\t\tTitle: (1) TEXT\n";
    const TEMPLATE_DESTINATION = path.join("@stxt.template", "test.note.stxt");

    beforeEach(() => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stxt-cli-install-"));
        projectDir = path.join(tempRoot, "project");
        userDir = path.join(tempRoot, "home", ".stxt");
        systemDir = path.join(tempRoot, "etc", "stxt");
        fs.mkdirSync(projectDir, { recursive: true });

        sourceFile = path.join(tempRoot, "blog.stxt");
        fs.writeFileSync(sourceFile, SCHEMA_DOC, "utf-8");

        deps = {
            cwd: projectDir,
            environment: {
                getUserLevelDir: () => userDir,
                getSystemLevelDir: () => systemDir,
            },
        };
    });

    after(() => {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    it("installs into the local project directory by default", () => {
        const io = new CapturedIO();

        const code = runInstall([sourceFile], io, deps);

        assert.strictEqual(code, ExitCode.OK);
        assert.strictEqual(io.errLines.length, 0);
        const destination = path.join(projectDir, ".stxt", SCHEMA_DESTINATION);
        assert.ok(fs.existsSync(destination));
        assert.strictEqual(fs.readFileSync(destination, "utf-8"), SCHEMA_DOC);
    });

    it("installs into the user-level directory with --user", () => {
        const io = new CapturedIO();

        const code = runInstall([sourceFile, "--user"], io, deps);

        assert.strictEqual(code, ExitCode.OK);
        assert.ok(fs.existsSync(path.join(userDir, SCHEMA_DESTINATION)));
    });

    it("installs into the system-level directory with --system", () => {
        const io = new CapturedIO();

        const code = runInstall([sourceFile, "--system"], io, deps);

        assert.strictEqual(code, ExitCode.OK);
        assert.ok(fs.existsSync(path.join(systemDir, SCHEMA_DESTINATION)));
    });

    it("installs into an explicit directory with --root", () => {
        const io = new CapturedIO();
        const rootDir = path.join(tempRoot, "elsewhere");

        const code = runInstall([sourceFile, "--root", rootDir], io, deps);

        assert.strictEqual(code, ExitCode.OK);
        assert.ok(fs.existsSync(path.join(rootDir, SCHEMA_DESTINATION)));
    });

    it("puts a template under its own directory", () => {
        const templateFile = path.join(tempRoot, "note.stxt");
        fs.writeFileSync(templateFile, TEMPLATE_DOC, "utf-8");
        const io = new CapturedIO();

        const code = runInstall([templateFile], io, deps);

        assert.strictEqual(code, ExitCode.OK);
        assert.ok(fs.existsSync(path.join(projectDir, ".stxt", TEMPLATE_DESTINATION)));
    });

    it("names the file after the target namespace, not after the source file", () => {
        const oddlyNamed = path.join(tempRoot, "whatever-i-called-it.stxt");
        fs.writeFileSync(oddlyNamed, SCHEMA_DOC, "utf-8");
        const io = new CapturedIO();

        const code = runInstall([oddlyNamed], io, deps);

        assert.strictEqual(code, ExitCode.OK);
        assert.ok(fs.existsSync(path.join(projectDir, ".stxt", SCHEMA_DESTINATION)));
        assert.ok(io.outLines[0].includes("test.blog"));
    });

    it("writes the definition in canonical form, without comments", () => {
        const messy = path.join(tempRoot, "messy.stxt");
        fs.writeFileSync(messy, "# a comment\nSchema (@stxt.schema): test.blog\n\n    Node:Article\n", "utf-8");
        const io = new CapturedIO();

        const code = runInstall([messy], io, deps);

        assert.strictEqual(code, ExitCode.OK);
        assert.strictEqual(fs.readFileSync(path.join(projectDir, ".stxt", SCHEMA_DESTINATION), "utf-8"), SCHEMA_DOC);
    });

    it("splits a file holding several definitions, one file each", () => {
        const both = path.join(tempRoot, "both.stxt");
        fs.writeFileSync(both, SCHEMA_DOC + TEMPLATE_DOC, "utf-8");
        const io = new CapturedIO();

        const code = runInstall([both], io, deps);

        assert.strictEqual(code, ExitCode.OK);
        assert.strictEqual(io.outLines.length, 2);
        assert.ok(fs.existsSync(path.join(projectDir, ".stxt", SCHEMA_DESTINATION)));
        assert.ok(fs.existsSync(path.join(projectDir, ".stxt", TEMPLATE_DESTINATION)));
    });

    describe("what it refuses to install", () => {

        it("a file that is not an STXT document", () => {
            const notStxt = path.join(tempRoot, "blog.txt");
            fs.writeFileSync(notStxt, SCHEMA_DOC, "utf-8");
            const io = new CapturedIO();

            const code = runInstall([notStxt], io, deps);

            assert.strictEqual(code, ExitCode.FAILURE);
            assert.ok(io.errLines[0].includes(".stxt"));
        });

        it("a document with a syntax error, writing nothing", () => {
            const broken = path.join(tempRoot, "broken.stxt");
            fs.writeFileSync(broken, "Schema (@stxt.schema): test.blog\n\t Node: Article\n", "utf-8");
            const io = new CapturedIO();

            const code = runInstall([broken], io, deps);

            assert.strictEqual(code, ExitCode.FAILURE);
            assert.ok(io.errLines.some(line => line.includes("INDENTATION_MIXED")));
            assert.ok(!fs.existsSync(path.join(projectDir, ".stxt")));
        });

        it("a definition that does not validate against its meta-schema", () => {
            const invalid = path.join(tempRoot, "invalid.stxt");
            fs.writeFileSync(invalid, "Schema (@stxt.schema): test.blog\n", "utf-8");
            const io = new CapturedIO();

            const code = runInstall([invalid], io, deps);

            assert.strictEqual(code, ExitCode.FAILURE);
            assert.ok(!fs.existsSync(path.join(projectDir, ".stxt")));
        });

        it("a root node that is neither a schema nor a template", () => {
            const document = path.join(tempRoot, "document.stxt");
            fs.writeFileSync(document, "Article (test.blog):\n\tTitle: Hello\n", "utf-8");
            const io = new CapturedIO();

            const code = runInstall([document], io, deps);

            assert.strictEqual(code, ExitCode.FAILURE);
            assert.ok(io.errLines[0].includes("--ignore-non-definitions"));
            assert.ok(!fs.existsSync(path.join(projectDir, ".stxt")));
        });

        it("but installs the definitions of such a file with --ignore-non-definitions", () => {
            const mixed = path.join(tempRoot, "mixed.stxt");
            fs.writeFileSync(mixed, "Article (test.blog):\n\tTitle: Hello\n" + SCHEMA_DOC, "utf-8");
            const io = new CapturedIO();

            const code = runInstall([mixed, "--ignore-non-definitions"], io, deps);

            assert.strictEqual(code, ExitCode.OK);
            assert.strictEqual(io.outLines.length, 1);
            assert.ok(fs.existsSync(path.join(projectDir, ".stxt", SCHEMA_DESTINATION)));
        });

        it("a file with no definition at all, even with --ignore-non-definitions", () => {
            const document = path.join(tempRoot, "document.stxt");
            fs.writeFileSync(document, "Article (test.blog):\n\tTitle: Hello\n", "utf-8");
            const io = new CapturedIO();

            const code = runInstall([document, "--ignore-non-definitions"], io, deps);

            assert.strictEqual(code, ExitCode.FAILURE);
            assert.ok(io.errLines[0].includes("defines no"));
        });

        it("a namespace already defined at that level by another file", () => {
            const level = path.join(projectDir, ".stxt");
            fs.mkdirSync(level, { recursive: true });
            fs.writeFileSync(path.join(level, "hand-placed.stxt"), SCHEMA_DOC, "utf-8");
            const io = new CapturedIO();

            const code = runInstall([sourceFile], io, deps);

            assert.strictEqual(code, ExitCode.FAILURE);
            assert.ok(io.errLines[0].includes("already defined"));
            assert.ok(!fs.existsSync(path.join(level, SCHEMA_DESTINATION)));
        });

        it("unless --force is given", () => {
            const level = path.join(projectDir, ".stxt");
            fs.mkdirSync(level, { recursive: true });
            fs.writeFileSync(path.join(level, "hand-placed.stxt"), SCHEMA_DOC, "utf-8");
            const io = new CapturedIO();

            const code = runInstall([sourceFile, "--force"], io, deps);

            assert.strictEqual(code, ExitCode.OK);
            assert.ok(fs.existsSync(path.join(level, SCHEMA_DESTINATION)));
        });
    });

    it("fails with FAILURE when the system directory cannot be determined", () => {
        const io = new CapturedIO();
        deps.environment = { getUserLevelDir: () => userDir, getSystemLevelDir: () => null };

        const code = runInstall([sourceFile, "--system"], io, deps);

        assert.strictEqual(code, ExitCode.FAILURE);
        assert.ok(io.errLines[0].includes("ProgramData"));
    });

    it("fails with FAILURE when the source file does not exist", () => {
        const io = new CapturedIO();

        const code = runInstall([path.join(tempRoot, "missing.stxt")], io, deps);

        assert.strictEqual(code, ExitCode.FAILURE);
        assert.ok(io.errLines[0].includes("not a file"));
    });

    it("refuses to overwrite an existing destination without --force", () => {
        const io = new CapturedIO();
        runInstall([sourceFile], io, deps);

        const io2 = new CapturedIO();
        const code = runInstall([sourceFile], io2, deps);

        assert.strictEqual(code, ExitCode.FAILURE);
        assert.ok(io2.errLines[0].includes("--force"));
    });

    it("overwrites an existing destination with --force", () => {
        runInstall([sourceFile], new CapturedIO(), deps);
        const changed = "Schema (@stxt.schema): test.blog\n\tNode: Post\n";
        fs.writeFileSync(sourceFile, changed, "utf-8");

        const io = new CapturedIO();
        const code = runInstall([sourceFile, "--force"], io, deps);

        assert.strictEqual(code, ExitCode.OK);
        const destination = path.join(projectDir, ".stxt", SCHEMA_DESTINATION);
        assert.strictEqual(fs.readFileSync(destination, "utf-8"), changed);
    });

    it("rejects a missing file argument", () => {
        const io = new CapturedIO();

        const code = runInstall([], io, deps);

        assert.strictEqual(code, ExitCode.USAGE);
        assert.ok(io.errLines[0].includes("missing file"));
    });

    it("rejects combining two scope flags", () => {
        const io = new CapturedIO();

        const code = runInstall([sourceFile, "--user", "--system"], io, deps);

        assert.strictEqual(code, ExitCode.USAGE);
        assert.ok(io.errLines[0].includes("only one of"));
    });

    it("rejects --root without a directory", () => {
        const io = new CapturedIO();

        const code = runInstall([sourceFile, "--root"], io, deps);

        assert.strictEqual(code, ExitCode.USAGE);
        assert.ok(io.errLines[0].includes("--root"));
    });

    it("rejects an unknown option", () => {
        const io = new CapturedIO();

        const code = runInstall([sourceFile, "--nope"], io, deps);

        assert.strictEqual(code, ExitCode.USAGE);
        assert.ok(io.errLines[0].includes("--nope"));
    });

    it("rejects an unknown single-dash option instead of treating it as a file", () => {
        const io = new CapturedIO();

        const code = runInstall([sourceFile, "-x"], io, deps);

        assert.strictEqual(code, ExitCode.USAGE);
        assert.ok(io.errLines[0].includes("-x"));
    });

    it("rejects more than one file", () => {
        const io = new CapturedIO();

        const code = runInstall([sourceFile, sourceFile], io, deps);

        assert.strictEqual(code, ExitCode.USAGE);
        assert.ok(io.errLines[0].includes("only one file"));
    });

    it("is reachable through the CLI dispatcher", async () => {
        const cwd = process.cwd();

        try {
            process.chdir(projectDir);
            const code = await run(["install", sourceFile]);

            assert.strictEqual(code, ExitCode.OK);
        } finally {
            process.chdir(cwd);
        }

        assert.ok(fs.existsSync(path.join(projectDir, ".stxt", SCHEMA_DESTINATION)));
    });
});
