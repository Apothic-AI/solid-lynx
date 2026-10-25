import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parityOperationIds } from "../src/parity.js";

/**
 * Host-free tests for `scripts/verify-native-parity.mjs`.
 *
 * The script is what turns a captured native log into something a release can
 * cite, so it is driven the way a reviewer drives it: a real process, a real
 * capture file, and the real exit code. No device, no adb, no network — the
 * fixtures under `test/fixtures/native-parity/` are synthetic captures, and the
 * README beside them says so.
 *
 * The script reads its checklist from the built package (`dist/parity.js`), so
 * these tests need `pnpm build` first. `pnpm test` runs the build before vitest;
 * the expectations below import `src/parity.ts` directly, so the test and the
 * script reach the same operation list by different routes.
 */

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SCRIPT = path.join(REPO_ROOT, "scripts", "verify-native-parity.mjs");
const FIXTURES = path.join(REPO_ROOT, "test", "fixtures", "native-parity");

const fixture = (name: string): string => path.join(FIXTURES, name);

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function runVerifier(...args: string[]): Run {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** A one-off capture file, for inputs that are not worth keeping as fixtures. */
function writeCapture(text: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "solid-lynx-parity-"));
  const file = path.join(dir, "capture.log");
  writeFileSync(file, text);
  return file;
}

const truthyJson = (value: unknown): string => JSON.stringify(value);

/** A report with every operation passing, in checklist order. */
function passingReport(): Record<string, unknown> {
  const operations = parityOperationIds.map(operation => ({
    operation,
    papi: [],
    status: "pass" as const,
    expected: "expected",
    observed: "expected",
  }));
  return {
    label: "native",
    operations,
    failures: [],
    summary: { pass: operations.length, fail: 0, unsupported: 0 },
  };
}

const captureOf = (report: unknown): string =>
  `I lynx_console: [solid-lynx parity] ${truthyJson(report)}\n`;

/**
 * The framing a real capture carries, exactly as Lynx Explorer writes it.
 *
 * `smoke.log` line 182 is the source of this shape: logcat columns, the console
 * bridge's opening double quote, the thread tag, the card's own message prefix,
 * the marker, the JSON, then the bridge's closing quote. The payload has no
 * escaped quotes in it, which is why the closing quote is the last character.
 */
const realLine = (
  report: unknown,
  thread: "main-thread" | "background" = "main-thread",
  messagePrefix = "[main-thread.js] ",
): string =>
  "10-25 08:41:39.887  5650  5685 I lynx    :"
  + ` [715D09544CF0:INFO:lynx_console.cc(230)] "${messagePrefix}[solid-lynx parity] `
  + `${truthyJson(report)}"\n`;

describe("verify-native-parity", () => {
  it("verifies a real capture, wrapped in the console bridge's framing", () => {
    // The fixture is the real smoke.log trimmed to its report line plus three
    // surrounding logcat lines, copied byte for byte. It is the shape the
    // synthetic fixtures never had, and the shape that used to be rejected as
    // truncated because the trailing bridge quote was parsed as JSON.
    const run = runVerifier(fixture("real-format-smoke.log"));

    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("verdict: verified");
    expect(run.stdout).toContain(`${parityOperationIds.length} operation(s) pass`);
    expect(run.stdout).toContain("thread main-thread.js");
  });

  it("parses the payload between the first `{` and the last `}`, and treats the rest as framing", () => {
    // Same report, three framings: bare (the old fixture shape), and the real
    // bridge shape from either thread. All three must reach exit 0, because a
    // report is the JSON span and nothing about the wrapper changes its meaning.
    const report = passingReport();
    const shapes = [
      captureOf(report),
      realLine(report),
      realLine(report, "background", "[background.js] "),
    ];

    for (const shape of shapes) {
      const run = runVerifier(writeCapture(shape));
      expect(run.status, `framing should not matter: ${shape.slice(0, 90)}`).toBe(0);
      expect(run.stdout).toContain("verdict: verified");
    }
  });

  it("names the thread that logged the report, so a background log is not read as the main one", () => {
    const background = runVerifier(writeCapture(
      realLine(passingReport(), "background", "[background.js] "),
    ));

    expect(background.status).toBe(0);
    expect(background.stdout).toContain("thread background.js");
    expect(background.stdout).not.toContain("thread main-thread.js");
  });

  it("reports a duplicated marker from the two threads as two reports, not one", () => {
    // A card can log from the main thread and again from the background thread.
    // Both lines carry a self-contained report, so the capture holds two and the
    // verifier must evaluate both. Silently keeping the last would let a clean
    // background report hide a failing main-thread one.
    const good = passingReport();
    const short = passingReport() as {
      operations: Record<string, unknown>[];
      summary: Record<string, number>;
    };
    short.operations.pop();
    short.summary = { pass: short.operations.length, fail: 0, unsupported: 0 };

    const run = runVerifier(writeCapture(
      realLine(good, "main-thread", "[main-thread.js] ")
        + realLine(short, "background", "[background.js] "),
    ));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("reports:    2");
    expect(run.stdout).toContain("report 1 of 2");
    expect(run.stdout).toContain("report 2 of 2");
    expect(run.stdout).toContain("thread main-thread.js");
    expect(run.stdout).toContain("thread background.js");
    // The short background report is the finding, and the clean main-thread
    // report does not excuse it.
    expect(run.stdout).toContain("missing-operation");
  });

  it("verifies two complete reports from the two threads as two verified reports", () => {
    // The other half of the rule: two lines is two reports even when both are
    // clean, so the count is visible rather than collapsing to 1.
    const run = runVerifier(writeCapture(
      realLine(passingReport(), "main-thread", "[main-thread.js] ")
        + realLine(passingReport(), "background", "[background.js] "),
    ));

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("reports:    2");
    expect(run.stdout).toContain(`verdict: verified — ${parityOperationIds.length * 2}`);
    expect(run.stdout).toContain("none is dropped in favour of the last");
  });

  it("still calls a real capture cut mid-JSON truncated, not mis-framed", () => {
    // The load-bearing case the framing fix could have broken: the braces are
    // unbalanced, so this is truncation. It must not be reported as a framing
    // problem, and the bridge's closing quote must not make a cut line look
    // complete.
    const whole = realLine(passingReport());
    // Drop the final `}` but keep the bridge's closing quote: the line still
    // ends with a quote, so only a balance scan can see that it is cut.
    const cut = whole.replace(/\}(?="\n$)/, "");
    expect(cut).not.toBe(whole);
    expect(cut.endsWith('"\n')).toBe(true);
    const run = runVerifier(writeCapture(cut));

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("truncated");
    expect(run.stderr).toMatch(/never closed|still open/);
    // Never a framing complaint about the wrapper quote.
    expect(run.stderr).not.toContain("no JSON follows it");
    expect(run.stdout).toContain("could not evaluate");
  });

  it("cuts a real fixture mid-JSON and still reports truncation", () => {
    // The same case against the stored real-format fixture, by byte count, so
    // the demo in the task can be reproduced from a test.
    const whole = readFileSync(fixture("real-format-smoke.log"), "utf8");
    const line = whole.split("\n").find(entry => entry.includes("[solid-lynx parity]")) ?? "";
    const cutAt = line.indexOf('"summary"');
    expect(cutAt).toBeGreaterThan(0);
    const run = runVerifier(writeCapture(`${line.slice(0, cutAt)}\n`));

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("truncated");
    expect(run.stderr).toMatch(/never closed|still open/);
  });

  it("fails a line that carries the marker but no `{`, and says which", () => {
    const run = runVerifier(writeCapture(
      "10-25 08:41:39.887  5650  5685 I lynx    :"
        + " [715D09544CF0:INFO:lynx_console.cc(230)] \"[main-thread.js] [solid-lynx parity]\"\n",
    ));

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("no JSON follows it");
    expect(run.stderr).toContain("no `{` after the marker");
    expect(run.stdout).toContain("could not evaluate");
  });

  it("keeps framing apart from malformed JSON: a balanced span is not called truncated", () => {
    // Braces balance, so JSON.parse is what rejects it. Reporting that as
    // truncation would blame the bridge for a capture that is simply wrong.
    const run = runVerifier(writeCapture(
      "10-25 08:41:39.887  5650  5685 I lynx    :"
        + " [715D09544CF0:INFO:lynx_console.cc(230)] \"[main-thread.js] [solid-lynx parity]"
        + " {\"label\" native}\"\n",
    ));

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("does not parse");
    expect(run.stderr).toContain("not a truncation");
    expect(run.stderr).not.toContain("never closed");
  });

  it("verifies a good capture and prints every operation in checklist order", () => {
    const run = runVerifier(fixture("good-capture.log"));

    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("verdict: verified");
    expect(run.stdout).toContain(`${parityOperationIds.length} operation(s) pass`);

    // The table is the reviewer's whole view, so every operation has to be in
    // it, in the order the checklist declares, with its status.
    const table = run.stdout.split("\n");
    const reported = parityOperationIds.map(operation => {
      const row = table.find(line => line.startsWith(`  ${operation} `));
      expect(row, `${operation} should appear in the table`).toBeDefined();
      return operation;
    });
    expect(reported).toEqual([...parityOperationIds]);

    const positions = parityOperationIds.map(operation =>
      run.stdout.indexOf(`  ${operation} `));
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it("accepts an unsupported operation that records its reason", () => {
    const run = runVerifier(fixture("unsupported-with-reason.log"));

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("1 unsupported with a recorded reason");
    expect(run.stdout).toContain("inline-styles");
  });

  it("reports a missing operation as a finding, even when every row passes", () => {
    const run = runVerifier(fixture("missing-operation.log"));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("verdict: findings");
    expect(run.stdout).toContain("missing-operation");
    expect(run.stdout).toContain("`renderer-dispose`");
  });

  it("reports a fail and an unsupported row with no reason", () => {
    const run = runVerifier(fixture("not-passing.log"));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("[fail] `classes` failed");
    expect(run.stdout).toContain('observed "alpha, beta"');
    expect(run.stdout).toContain("[unsupported-without-reason] `dataset`");
    expect(run.stdout).toContain("verdict: findings");
  });

  it("cannot evaluate a capture whose report line is truncated", () => {
    const run = runVerifier(fixture("unparseable.log"));

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("does not parse");
    expect(run.stderr).toContain("truncated");
    // A capture that cannot be read must say so on stdout too, because that is
    // what gets pasted into an issue.
    expect(run.stdout).toContain("could not evaluate");
    expect(run.stdout).not.toContain("verdict: verified");
  });

  it("cannot evaluate a capture with console output but no parity line", () => {
    const run = runVerifier(fixture("empty-capture.log"));

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("contains no [solid-lynx parity] line");
    expect(run.stdout).toContain("could not evaluate");
  });

  it("cannot evaluate a zero-byte capture", () => {
    const run = runVerifier(fixture("no-lines.log"));

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("contains no [solid-lynx parity] line");
  });

  it("cannot evaluate a capture path that does not exist", () => {
    const run = runVerifier(path.join(FIXTURES, "not-a-file.log"));

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("cannot read the capture");
    expect(run.stderr).toContain("Nothing was verified");
  });

  it("cannot evaluate a marker with no JSON after it", () => {
    const run = runVerifier(writeCapture("I lynx_console: [solid-lynx parity]\n"));

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("no JSON");
  });

  it("cannot evaluate JSON that parses but is not a parity report", () => {
    const run = runVerifier(writeCapture(captureOf({ label: "native", operations: 3 })));

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("is not a parity report");
  });

  it("flags an operation the built checklist does not know", () => {
    const report = passingReport() as { operations: Record<string, unknown>[] };
    report.operations.push({
      operation: "invented-operation",
      papi: [],
      status: "pass",
      expected: "anything",
      observed: "anything",
    });

    const run = runVerifier(writeCapture(captureOf(report)));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("unrecognised-operation");
    expect(run.stdout).toContain("`invented-operation`");
  });

  it("flags a summary that disagrees with its own rows", () => {
    const report = passingReport() as { summary: { pass: number } };
    report.summary.pass = 19;

    const run = runVerifier(writeCapture(captureOf(report)));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("summary-mismatch");
    expect(run.stdout).toContain("claims 19");
  });

  it("verifies a report whose rows arrive out of checklist order", () => {
    const report = passingReport() as { operations: Record<string, unknown>[] };
    report.operations.reverse();

    const run = runVerifier(writeCapture(captureOf(report)));

    expect(run.status).toBe(0);
    const positions = parityOperationIds.map(operation =>
      run.stdout.indexOf(`  ${operation} `));
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it("evaluates every report in a capture that holds more than one", () => {
    const good = captureOf(passingReport());
    const report = passingReport() as {
      operations: Record<string, unknown>[];
      summary: Record<string, number>;
    };
    report.operations.pop();
    report.summary = { pass: report.operations.length, fail: 0, unsupported: 0 };

    const run = runVerifier(writeCapture(good + captureOf(report)));

    // Two reports, one clean and one short: the capture as a whole is a finding.
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("reports:    2");
    expect(run.stdout).toContain("report 1 of 2");
    expect(run.stdout).toContain("report 2 of 2");
    expect(run.stdout).toContain("missing-operation");
  });

  it("cannot evaluate anything when the built package is missing", () => {
    // The script resolves its checklist relative to its own location, so a copy
    // in a directory with no dist/ is the missing-build case without touching
    // this worktree's dist.
    const dir = mkdtempSync(path.join(tmpdir(), "solid-lynx-verify-"));
    copyFileSync(SCRIPT, path.join(dir, "verify-native-parity.mjs"));

    const result = spawnSync(
      process.execPath,
      [path.join(dir, "verify-native-parity.mjs"), fixture("good-capture.log")],
      { encoding: "utf8", cwd: dir },
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("dist/parity.js is missing");
    expect(result.stderr).toContain("pnpm build");
  });

  it("treats a missing argument as unusable rather than as a pass", () => {
    const run = runVerifier();

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("no capture file given");
  });

  it("refuses more than one capture at a time", () => {
    const run = runVerifier(fixture("good-capture.log"), fixture("good-capture.log"));

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("exactly one capture file");
  });

  it("documents its exit codes and the dagr discipline in --help", () => {
    const run = runVerifier("--help");

    expect(run.status).toBe(0);
    for (const phrase of [
      "0  verified",
      "1  findings",
      "2  could not evaluate",
      "dagr",
      "solid-lynx parity",
      "pnpm build",
    ]) {
      expect(run.stdout).toContain(phrase);
    }
  });

  it("reads a text file and nothing else, so it can never need a device", () => {
    const source = readFileSync(SCRIPT, "utf8");
    const imports = [...source.matchAll(/^import .* from "([^"]+)";$/gm)]
      .map(match => match[1]);

    // Only the filesystem, a path helper, and URL plumbing. Any process,
    // network, or adb import would make this a host-dependent check.
    expect(imports.sort()).toEqual(["node:fs", "node:path", "node:url"]);
    expect(source).not.toMatch(/\bchild_process\b/);
    expect(source).not.toMatch(/\bexecFile|\bspawn\(|\bfetch\(/);
  });
});
