import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    createDiscoveryResolver,
    NodeDiscoveryEnvironment,
    NodeDiscoveryFileSystem,
} from "../discovery/NodeDiscovery";

/**
 * The Node adapters of STXT-DISCOVERY-SPEC over a real temporary directory tree. The
 * spec-conformance suite lives in `stxt-js` (`src/test/discovery.test.ts`, in-memory);
 * what is verified here is only the adapter layer: real `fs` walking, `STXT_PATH`
 * splitting and the per-platform level directories.
 */

const TEMPLATE = [
    "Template (@stxt.template): test.cli",
    "\tStructure >>",
    "\t\tDocumento (test.cli):",
    "\t\t\tTitulo: (1)",
    "",
].join("\n");

const NEARER_TEMPLATE = TEMPLATE.replace("Titulo: (1)", "Titulo: (?)");

describe("NodeDiscovery", () => {
    let tempRoot: string;
    let projectDir: string;
    let subDir: string;

    /**
     * Test tree:
     *
     *     raiz/.stxt/test.stxt        <- farther level
     *     raiz/proyecto/.stxt/test.stxt   <- nearer level, same namespace
     *     raiz/proyecto/sub/          <- where the document would live
     */
    before(() => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stxt-cli-discovery-"));
        projectDir = path.join(tempRoot, "proyecto");
        subDir = path.join(projectDir, "sub");

        fs.mkdirSync(path.join(tempRoot, ".stxt"), { recursive: true });
        fs.mkdirSync(path.join(projectDir, ".stxt"), { recursive: true });
        fs.mkdirSync(subDir, { recursive: true });

        fs.writeFileSync(path.join(tempRoot, ".stxt", "test.stxt"), TEMPLATE, "utf-8");
        fs.writeFileSync(path.join(projectDir, ".stxt", "test.stxt"), NEARER_TEMPLATE, "utf-8");
    });

    after(() => {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    // An environment that cannot see the real machine: no STXT_PATH unless given, and the
    // user/system levels point inside the temp tree (so a real ~/.stxt cannot interfere).
    function isolatedEnv(stxtPath?: string): NodeJS.ProcessEnv {
        const env: NodeJS.ProcessEnv = {};

        if (stxtPath !== undefined) {
            env["STXT_PATH"] = stxtPath;
        }

        return env;
    }

    function isolatedResolver(stxtPath?: string) {
        const fileSystem = new NodeDiscoveryFileSystem();
        const environment = new NodeDiscoveryEnvironment(isolatedEnv(stxtPath), "linux", path.join(tempRoot, "no-home"));

        return { fileSystem, environment };
    }

    describe("NodeDiscoveryFileSystem", () => {

        it("walks a real ancestor chain, nearest first", async () => {
            const { fileSystem, environment } = isolatedResolver();
            const { DiscoveryResolver } = await import("@stxt-lang/core");
            const resolver = new DiscoveryResolver(fileSystem, environment);

            const chain = await resolver.resolveChain(subDir);

            assert.deepStrictEqual(
                chain.filter(dir => dir.startsWith(tempRoot)),
                [path.join(projectDir, ".stxt"), path.join(tempRoot, ".stxt")]);
        });

        it("the nearest level wins for the shared namespace", async () => {
            const { fileSystem, environment } = isolatedResolver();
            const { DiscoveryResolver } = await import("@stxt-lang/core");
            const resolver = new DiscoveryResolver(fileSystem, environment);

            const result = await resolver.resolve(subDir);

            assert.strictEqual(
                result.getDefinition("test.cli")?.file,
                path.join(projectDir, ".stxt", "test.stxt"));
            assert.strictEqual(result.getErrors().length, 0);
        });

        it("parentOf returns null at the file-system root", () => {
            const fileSystem = new NodeDiscoveryFileSystem();
            const root = path.parse(tempRoot).root;

            assert.strictEqual(fileSystem.parentOf(root), null);
        });
    });

    describe("NodeDiscoveryEnvironment", () => {

        it("splits STXT_PATH by the platform delimiter", () => {
            const environment = new NodeDiscoveryEnvironment(
                isolatedEnv(["/uno", "/dos"].join(path.delimiter)), "linux", "/home/x");

            assert.deepStrictEqual(environment.getStxtPath(), ["/uno", "/dos"]);
        });

        it("distinguishes STXT_PATH undefined from defined-but-empty", () => {
            assert.strictEqual(new NodeDiscoveryEnvironment(isolatedEnv(), "linux", "/home/x").getStxtPath(), null);
            assert.deepStrictEqual(new NodeDiscoveryEnvironment(isolatedEnv(""), "linux", "/home/x").getStxtPath(), []);
        });

        it("resolves the Unix level directories", () => {
            const environment = new NodeDiscoveryEnvironment(isolatedEnv(), "linux", "/home/ana");

            assert.strictEqual(environment.getUserLevelDir(), path.join("/home/ana", ".stxt"));
            assert.strictEqual(environment.getSystemLevelDir(), "/etc/stxt");
        });

        it("resolves the Windows system level from ProgramData", () => {
            const env = isolatedEnv();
            env["ProgramData"] = "C:\\ProgramData";
            const environment = new NodeDiscoveryEnvironment(env, "win32", "C:\\Users\\ana");

            assert.strictEqual(environment.getSystemLevelDir(), path.join("C:\\ProgramData", "stxt"));
        });

        it("STXT_PATH pointing at a temp directory replaces the chain", async () => {
            const { fileSystem } = isolatedResolver();
            const environment = new NodeDiscoveryEnvironment(
                isolatedEnv(path.join(tempRoot, ".stxt")), "linux", path.join(tempRoot, "no-home"));
            const { DiscoveryResolver } = await import("@stxt-lang/core");
            const resolver = new DiscoveryResolver(fileSystem, environment);

            const result = await resolver.resolve(subDir);

            // Only the farther level is visible: STXT_PATH ignored the project ascent.
            assert.deepStrictEqual(result.getChain(), [path.join(tempRoot, ".stxt")]);
            assert.strictEqual(
                result.getDefinition("test.cli")?.file,
                path.join(tempRoot, ".stxt", "test.stxt"));
        });
    });

    describe("createDiscoveryResolver", () => {

        it("builds a working resolver from an injected environment", async () => {
            const resolver = createDiscoveryResolver(isolatedEnv(path.join(projectDir, ".stxt")));

            const result = await resolver.resolve(null);

            assert.ok(result.getSchema("test.cli"), "the definition of STXT_PATH is served");
        });
    });
});
