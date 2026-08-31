import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runDescribe } from "../command/Describe";
import { run } from "../runtime/Cli";
import { ExitCode } from "../runtime/ExitCode";
import { CapturedIO } from "./TestIO";

describe("describe", () => {
    let tempRoot: string;
    let document: string;

    before(() => {
        tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stxt-cli-describe-"));
        document = path.join(tempRoot, "document.stxt");
        fs.writeFileSync(document, [
            "# Discarded comment",
            "Document (EXAMPLE.DOCS):",
            "\tTitle: Report",
            "\tBody >>",
            "\t\tFirst line",
            "\t\t",
            "\t\t# Literal text",
            "",
        ].join("\n"), "utf-8");
    });

    after(() => {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    it("writes the canonical tree to stdout without schema validation", () => {
        const io = new CapturedIO();

        const code = runDescribe(["document.stxt"], io, { cwd: tempRoot });

        assert.strictEqual(code, ExitCode.OK);
        assert.strictEqual(io.errLines.length, 0);
        assert.strictEqual(io.outLines.length, 1);
        assert.deepStrictEqual(JSON.parse(io.outLines[0]), [{
            name: "Document",
            canonicalName: "document",
            namespace: "example.docs",
            form: "inline",
            value: "",
            children: [{
                name: "Title",
                canonicalName: "title",
                namespace: "example.docs",
                form: "inline",
                value: "Report",
                children: [],
            }, {
                name: "Body",
                canonicalName: "body",
                namespace: "example.docs",
                form: "block",
                lines: ["First line", "", "# Literal text"],
            }],
        }]);
    });

    it("reports every syntax error on stderr and emits no partial tree", () => {
        const broken = path.join(tempRoot, "broken.stxt");
        fs.writeFileSync(broken, "Document:\n\t Title: mixed indentation\n", "utf-8");
        const io = new CapturedIO();

        const code = runDescribe([broken], io);

        assert.strictEqual(code, ExitCode.FAILURE);
        assert.strictEqual(io.outLines.length, 0);
        assert.ok(io.errLines.some(line => line.includes("INDENTATION_MIXED")));
    });

    it("reports an unreadable file as a document failure", () => {
        const io = new CapturedIO();

        const code = runDescribe(["missing.stxt"], io, { cwd: tempRoot });

        assert.strictEqual(code, ExitCode.FAILURE);
        assert.strictEqual(io.outLines.length, 0);
        assert.ok(io.errLines[0].includes("cannot read"));
    });

    it("rejects missing, multiple and option arguments", () => {
        for (const args of [[], ["one.stxt", "two.stxt"], ["--nope"], ["one.stxt", "-x"]]) {
            const io = new CapturedIO();

            assert.strictEqual(runDescribe(args, io, { cwd: tempRoot }), ExitCode.USAGE, args.join(" "));
            assert.strictEqual(io.outLines.length, 0);
            assert.ok(io.errLines.length > 0);
        }
    });

    it("reads the document from stdin given -", () => {
        const io = new CapturedIO();

        const code = runDescribe(["-"], io, { cwd: tempRoot, readStdin: () => "Root: value\n" });

        assert.strictEqual(code, ExitCode.OK);
        assert.strictEqual(io.errLines.length, 0);
        assert.deepStrictEqual(JSON.parse(io.outLines[0]), [{
            name: "Root",
            canonicalName: "root",
            namespace: "",
            form: "inline",
            value: "value",
            children: [],
        }]);
    });

    it("reports stdin errors as <stdin>", () => {
        const io = new CapturedIO();

        const code = runDescribe(["-"], io, { cwd: tempRoot, readStdin: () => "Document:\n\t Title: x\n" });

        assert.strictEqual(code, ExitCode.FAILURE);
        assert.strictEqual(io.outLines.length, 0);
        assert.ok(io.errLines[0].startsWith("<stdin>:2: [INDENTATION_MIXED]"), io.errLines[0]);
    });

    it("rejects - next to a file: still exactly one document", () => {
        const io = new CapturedIO();

        const code = runDescribe(["one.stxt", "-"], io, { cwd: tempRoot, readStdin: () => "" });

        assert.strictEqual(code, ExitCode.USAGE);
        assert.ok(io.errLines[0].includes("exactly one file"));
    });

    it("honours the parser limit flags, and -1 disables a limit", () => {
        const deep = path.join(tempRoot, "deep.stxt");
        fs.writeFileSync(deep, "A: 1\n\tB: 2\n\t\tC: 3\n", "utf-8");

        const failing = new CapturedIO();
        assert.strictEqual(
            runDescribe(["deep.stxt", "--max-nesting", "2"], failing, { cwd: tempRoot }),
            ExitCode.FAILURE
        );
        assert.ok(failing.errLines[0].includes("LIMIT_NESTING_EXCEEDED"), failing.errLines[0]);

        const passing = new CapturedIO();
        assert.strictEqual(
            runDescribe(["deep.stxt", "--max-nesting", "-1"], passing, { cwd: tempRoot }),
            ExitCode.OK
        );
        assert.strictEqual(passing.errLines.length, 0);
    });

    it("rejects a bad limit value as a usage error", () => {
        const io = new CapturedIO();

        const code = runDescribe(["document.stxt", "--max-input-size", "big"], io, { cwd: tempRoot });

        assert.strictEqual(code, ExitCode.USAGE);
        assert.ok(io.errLines[0].includes("-1 disables the limit"));
    });

    it("is reachable through 'stxt describe'", async () => {
        const io = new CapturedIO();

        const code = await run(["describe", document], io);

        assert.strictEqual(code, ExitCode.OK);
        assert.strictEqual(io.errLines.length, 0);
        assert.strictEqual(JSON.parse(io.outLines[0])[0].canonicalName, "document");
    });
});
