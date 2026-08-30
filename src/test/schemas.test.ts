import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { CliIO, run } from "../runtime/Cli";
import { ExitCode } from "../runtime/ExitCode";
import { SchemasDependencies, SchemasResolver, runSchemas } from "../command/Schemas";
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

/** A resolver stub, for the tests that do not need a real file system. */
function stubResolver(result: Awaited<ReturnType<SchemasResolver["resolve"]>>): SchemasResolver {
    return { resolve: async () => result };
}

const NO_ERRORS: Awaited<ReturnType<SchemasResolver["resolve"]>> = {
    getChain: () => ["/project/.stxt"],
    getActiveDefinitions: () => [
        { namespace: "org.example.blog", schema: {} as never, file: "/project/.stxt/blog.stxt", levelDir: "/project/.stxt" },
    ],
    getErrors: () => [],
};

describe("schemas", () => {
    let tempRoot: string;

    before(() => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stxt-cli-schemas-"));
    });

    after(() => {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    describe("formatting", () => {

        it("lists the resolution chain and the active namespaces", async () => {
            const io = new CapturedIO();

            const code = await runSchemas([], io, { cwd: tempRoot, resolver: stubResolver(NO_ERRORS) });

            assert.strictEqual(code, ExitCode.OK);
            assert.ok(io.outLines.some(line => line.includes("/project/.stxt")));
            assert.ok(io.outLines.some(line => line.includes("org.example.blog")));
            assert.strictEqual(io.errLines.length, 0);
        });

        it("reports an empty chain", async () => {
            const io = new CapturedIO();
            const empty = { getChain: () => [], getActiveDefinitions: () => [], getErrors: () => [] };

            const code = await runSchemas([], io, { cwd: tempRoot, resolver: stubResolver(empty), env: {} });

            assert.strictEqual(code, ExitCode.OK);
            assert.ok(io.outLines.some(line => line.includes("no .stxt directory found")));
            assert.ok(io.outLines.some(line => line.includes("No namespaces resolved")));
        });

        it("attributes an empty chain to STXT_PATH when the variable is defined", async () => {
            const io = new CapturedIO();
            const empty = { getChain: () => [], getActiveDefinitions: () => [], getErrors: () => [] };

            const code = await runSchemas([], io,
                { cwd: tempRoot, resolver: stubResolver(empty), env: { STXT_PATH: "" } });

            assert.strictEqual(code, ExitCode.OK);
            assert.ok(io.outLines.some(line => line.includes("STXT_PATH provides no directories")));
        });

        it("reports resolution errors on stderr and fails with FAILURE", async () => {
            const io = new CapturedIO();
            const withErrors: Awaited<ReturnType<SchemasResolver["resolve"]>> = {
                ...NO_ERRORS,
                getErrors: () => [
                    { code: "DISCOVERY_NOT_PARSEABLE", file: "/project/.stxt/broken.stxt", message: "bad indentation" },
                ],
            };

            const code = await runSchemas([], io, { cwd: tempRoot, resolver: stubResolver(withErrors) });

            assert.strictEqual(code, ExitCode.FAILURE);
            assert.ok(io.errLines.some(line => line.includes("DISCOVERY_NOT_PARSEABLE")));
        });
    });

    describe("argument handling", () => {

        let deps: SchemasDependencies;

        beforeEach(() => {
            deps = { cwd: tempRoot, resolver: stubResolver(NO_ERRORS) };
        });

        it("rejects more than one path", async () => {
            const io = new CapturedIO();

            const code = await runSchemas(["a", "b"], io, deps);

            assert.strictEqual(code, ExitCode.USAGE);
            assert.ok(io.errLines[0].includes("only one path"));
        });

        it("rejects an unknown option", async () => {
            const io = new CapturedIO();

            const code = await runSchemas(["--nope"], io, deps);

            assert.strictEqual(code, ExitCode.USAGE);
            assert.ok(io.errLines[0].includes("--nope"));
        });

        it("rejects an unknown single-dash option instead of treating it as a path", async () => {
            const io = new CapturedIO();

            const code = await runSchemas(["-x"], io, deps);

            assert.strictEqual(code, ExitCode.USAGE);
            assert.ok(io.errLines[0].includes("-x"));
        });
    });

    describe("path resolution", () => {
        let projectDir: string;
        let docFile: string;

        beforeEach(() => {
            projectDir = fs.mkdtempSync(path.join(tempRoot, "project-"));
            fs.mkdirSync(path.join(projectDir, ".stxt"), { recursive: true });
            docFile = path.join(projectDir, "post.stxt");
            fs.writeFileSync(docFile, "org.example.blog: Hello\n", "utf-8");
        });

        it("fails with FAILURE when the given path does not exist", async () => {
            const io = new CapturedIO();

            const code = await runSchemas(
                [path.join(tempRoot, "missing")],
                io,
                { cwd: projectDir, resolver: stubResolver(NO_ERRORS) }
            );

            assert.strictEqual(code, ExitCode.FAILURE);
            assert.ok(io.errLines[0].includes("no such file or directory"));
        });

        it("uses a document's directory, not the document itself, as the resolution root", async () => {
            const io = new CapturedIO();
            let seenDir: string | null | undefined;
            const resolver: SchemasResolver = {
                resolve: async documentDir => {
                    seenDir = documentDir;
                    return NO_ERRORS;
                },
            };

            await runSchemas([docFile], io, { cwd: projectDir, resolver });

            assert.strictEqual(seenDir, projectDir);
        });

        it("resolves against the real discovery chain end-to-end", async () => {
            const io = new CapturedIO();
            const { DiscoveryResolver } = await import("@stxt-lang/core");
            const fileSystem = new NodeDiscoveryFileSystem();
            const environment = new NodeDiscoveryEnvironment({}, "linux", path.join(tempRoot, "no-home"));
            const resolver = new DiscoveryResolver(fileSystem, environment);

            const code = await runSchemas([], io, { cwd: projectDir, resolver });

            assert.strictEqual(code, ExitCode.OK);
            assert.ok(io.outLines.some(line => line.includes(path.join(projectDir, ".stxt"))));
        });
    });

    describe("CLI dispatcher", () => {

        it("is reachable through 'stxt schemas'", async () => {
            const io = new CapturedIO();
            const dispatchDir = fs.mkdtempSync(path.join(tempRoot, "dispatch-"));
            const cwd = process.cwd();

            try {
                process.chdir(dispatchDir);
                const code = await run(["schemas"], io);

                assert.strictEqual(code, ExitCode.OK);
                assert.ok(io.outLines.some(line => line.includes("Resolution chain for")));
            } finally {
                process.chdir(cwd);
            }
        });
    });
});
