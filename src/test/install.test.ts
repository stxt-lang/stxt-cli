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

    beforeEach(() => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stxt-cli-install-"));
        projectDir = path.join(tempRoot, "project");
        userDir = path.join(tempRoot, "home", ".stxt");
        systemDir = path.join(tempRoot, "etc", "stxt");
        fs.mkdirSync(projectDir, { recursive: true });

        sourceFile = path.join(tempRoot, "blog.stxt");
        fs.writeFileSync(sourceFile, "Schema (@stxt.schema): blog\n", "utf-8");

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
        const destination = path.join(projectDir, ".stxt", "blog.stxt");
        assert.ok(fs.existsSync(destination));
        assert.strictEqual(fs.readFileSync(destination, "utf-8"), fs.readFileSync(sourceFile, "utf-8"));
    });

    it("installs into the user-level directory with --user", () => {
        const io = new CapturedIO();

        const code = runInstall([sourceFile, "--user"], io, deps);

        assert.strictEqual(code, ExitCode.OK);
        assert.ok(fs.existsSync(path.join(userDir, "blog.stxt")));
    });

    it("installs into the system-level directory with --system", () => {
        const io = new CapturedIO();

        const code = runInstall([sourceFile, "--system"], io, deps);

        assert.strictEqual(code, ExitCode.OK);
        assert.ok(fs.existsSync(path.join(systemDir, "blog.stxt")));
    });

    it("installs into an explicit directory with --root", () => {
        const io = new CapturedIO();
        const rootDir = path.join(tempRoot, "elsewhere");

        const code = runInstall([sourceFile, "--root", rootDir], io, deps);

        assert.strictEqual(code, ExitCode.OK);
        assert.ok(fs.existsSync(path.join(rootDir, "blog.stxt")));
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
        fs.writeFileSync(sourceFile, "Schema (@stxt.schema): blog\n\tChanged: (1)\n", "utf-8");

        const io = new CapturedIO();
        const code = runInstall([sourceFile, "--force"], io, deps);

        assert.strictEqual(code, ExitCode.OK);
        const destination = path.join(projectDir, ".stxt", "blog.stxt");
        assert.strictEqual(fs.readFileSync(destination, "utf-8"), fs.readFileSync(sourceFile, "utf-8"));
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

        assert.ok(fs.existsSync(path.join(projectDir, ".stxt", "blog.stxt")));
    });
});
