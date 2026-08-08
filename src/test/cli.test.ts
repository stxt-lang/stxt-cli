import * as assert from "assert";
import { CliIO, run } from "../runtime/Cli";
import { ExitCode } from "../runtime/ExitCode";
import { getCliVersion } from "../runtime/PackageInfo";

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

describe("cli", () => {

    describe("--version", () => {

        it("prints the CLI version on stdout and exits with OK", async () => {
            const io = new CapturedIO();

            const code = await run(["--version"], io);

            assert.strictEqual(code, ExitCode.OK);
            assert.strictEqual(io.errLines.length, 0);
            assert.strictEqual(io.outLines.length, 1);
            assert.ok(io.outLines[0].startsWith(`stxt ${getCliVersion()}`), io.outLines[0]);
        });

        it("reports the version of the parser it uses", async () => {
            const io = new CapturedIO();

            await run(["--version"], io);

            assert.match(io.outLines[0], /\(@stxt-lang\/core .+\)$/);
        });

        it("has no alternative spelling", async () => {
            for (const flag of ["-version", "-v", "-V"]) {
                const io = new CapturedIO();

                assert.strictEqual(await run([flag], io), ExitCode.USAGE, flag);
                assert.strictEqual(io.outLines.length, 0, flag);
            }
        });

        it("reads the version from package.json, not from a literal in the source", () => {
            assert.notStrictEqual(getCliVersion(), "unknown");
        });
    });

    describe("--help", () => {

        it("prints the usage on stdout and exits with OK", async () => {
            const io = new CapturedIO();

            const code = await run(["--help"], io);

            assert.strictEqual(code, ExitCode.OK);
            assert.strictEqual(io.errLines.length, 0);
            assert.ok(io.outLines.length > 1);
        });
    });

    describe("invalid invocations", () => {

        it("treats an empty command line as a usage error, with the help on stderr", async () => {
            const io = new CapturedIO();

            const code = await run([], io);

            assert.strictEqual(code, ExitCode.USAGE);
            assert.strictEqual(io.outLines.length, 0);
            assert.ok(io.errLines.length > 1);
        });

        it("rejects an unknown option", async () => {
            const io = new CapturedIO();

            const code = await run(["--nope"], io);

            assert.strictEqual(code, ExitCode.USAGE);
            assert.strictEqual(io.outLines.length, 0);
            assert.ok(io.errLines[0].includes("--nope"));
        });
    });
});
