import { CliIO } from "../runtime/Cli";

/** A {@link CliIO} that captures the lines written to each stream, for assertions. */
export class CapturedIO implements CliIO {
    readonly outLines: string[] = [];
    readonly errLines: string[] = [];

    out(line: string): void {
        this.outLines.push(line);
    }

    err(line: string): void {
        this.errLines.push(line);
    }
}
