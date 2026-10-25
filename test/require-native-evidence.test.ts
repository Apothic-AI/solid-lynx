/**
 * Host-free tests for `scripts/require-native-evidence.mjs`.
 *
 * The script answers one question about a git diff: did this change touch
 * native-facing behaviour, and if so is there committed evidence that satisfies
 * the requirement? These tests answer it the way CI will — a real process, a
 * real exit code — against git repositories built from nothing in a temporary
 * directory.
 *
 * Three rules the suite keeps to, because each one is a way a gate like this
 * normally rots:
 *
 *  - **Not this repository's git state.** Every case runs in a fresh `git init`
 *    under `mkdtemp`, with its own identity configured. Nothing here can pass
 *    because of a ref, an index entry, or an uncommitted file in the worktree
 *    the tests happen to be checked out in.
 *  - **No `origin/master`.** The default range has no fallback, so almost every
 *    case passes `--range` explicitly. The one case that exercises the default
 *    asserts the refusal instead of relying on a remote existing.
 *  - **No device, no network.** The script only runs git and the verifier, and
 *    the verifier only reads files; the capture fixtures are the ones beside
 *    `test/fixtures/native-parity/`, copied in as bytes.
 *
 * `dist/parity.js` has to exist for the verifier to read its checklist, exactly
 * as in `test/native-parity-verify.test.ts`; `pnpm test` builds before vitest.
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parityOperationIds } from "../src/parity.js";

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SCRIPT = path.join(REPO_ROOT, "scripts", "require-native-evidence.mjs");
const FIXTURES = path.join(REPO_ROOT, "test", "fixtures", "native-parity");

/** The good capture, as bytes. It is a fixture, never device evidence. */
const GOOD_CAPTURE = readFileSync(path.join(FIXTURES, "good-capture.log"), "utf8");

const VERDICT_ZERO =
  `verdict: verified — ${parityOperationIds.length} operation(s) pass across 1 captured report(s).`;

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

/** A throwaway repository with an initial commit on `master`. */
function newRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "solid-lynx-native-evidence-"));
  execFileSync("git", ["init", "-q", "-b", "master", dir]);
  execFileSync("git", ["-C", dir, "config", "user.email", "test@example.invalid"]);
  execFileSync("git", ["-C", dir, "config", "user.name", "Native Evidence Test"]);
  execFileSync("git", ["-C", dir, "config", "commit.gpgsign", "false"]);
  write(dir, "README.md", "test repository\n");
  commitAll(dir, "initial");
  return dir;
}

function gitOutput(dir: string, ...args: string[]): string {
  return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
}

function write(dir: string, relative: string, contents: string): void {
  const file = path.join(dir, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

function commitAll(dir: string, message: string): string {
  execFileSync("git", ["-C", dir, "add", "--all"]);
  execFileSync("git", ["-C", dir, "commit", "-q", "-m", message]);
  return gitOutput(dir, "rev-parse", "HEAD");
}

function runScript(...args: string[]): Run {
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

const range = (from: string, to: string): string => `${from}..${to}`;

/**
 * A manifest for the capture in `dir`, defaulting to everything the schema
 * requires. Overrides exist so a test can break exactly one field.
 *
 * `commit` defaults to the commit that will carry this manifest, which the
 * caller has to have created already — a manifest can never name the commit it
 * is itself inside. `storeCapture` handles the ordering.
 */
function manifestFor(dir: string, overrides: Record<string, unknown> = {}): string {
  return `${JSON.stringify({
    kind: "capture",
    card: "smoke",
    capture: "lynx_console-smoke-test.log",
    device: { serial: "R9WT911JVVH", getState: "device" },
    timestamp: "2026-11-20T10:04:00Z",
    commit: gitOutput(dir, "rev-parse", "HEAD"),
    verifier: { exitCode: 0, verdict: VERDICT_ZERO },
    note: "synthetic capture from test/fixtures/native-parity; not device evidence",
    ...overrides,
  }, null, 2)}\n`;
}

/**
 * Stores a capture plus a manifest, and commits them.
 *
 * The ordering is the one a contributor faces: the capture is produced by a run
 * at some commit, and the manifest that records it has to name a commit inside
 * the change it backs. So the capture and the source change are committed
 * first, and the manifest — now able to name that commit — follows, inside the
 * same range. Returns the sha of the final commit.
 */
function storeCaptureInChange(dir: string, message: string, name = "2026-11-20-smoke"): string {
  write(dir, `docs/evidence/native/${name}/lynx_console-smoke-test.log`, GOOD_CAPTURE);
  const recorded = commitAll(dir, message);
  write(dir, `docs/evidence/native/${name}/manifest.json`,
    manifestFor(dir, { commit: recorded }));
  return commitAll(dir, "evidence: record the capture's commit");
}

describe("require-native-evidence: the native-facing path list", () => {
  it("classifies every file in src/", () => {
    // The guard against a new source file sitting outside the gate: the list is
    // the whole contract, so a file that is neither runtime, type, or build
    // must appear here first.
    const listed = readdirSync(path.join(REPO_ROOT, "src"))
      .filter(name => /\.tsx?$/.test(name))
      .map(name => `src/${name}`)
      .sort();

    const output = runScript("--print-native-paths");
    expect(output.status).toBe(0);
    const table = JSON.parse(output.stdout) as { path?: string; prefix?: string }[];
    const covered = table
      .map(entry => entry.path)
      .filter((entry): entry is string => typeof entry === "string" && entry.startsWith("src/"))
      .sort();

    expect(covered).toEqual(listed);
  });

  it("covers the native example, its runner, and the workflow", () => {
    const output = runScript("--print-native-paths");
    const table = JSON.parse(output.stdout) as { path?: string; prefix?: string }[];

    expect(table.some(entry => entry.prefix === "examples/lynx-for-native/")).toBe(true);
    expect(table.some(entry => entry.path === ".github/workflows/ci.yml")).toBe(true);
    // rspeedy.ts configures the native build and does not ship inside it; it
    // must still be in the list, because a bad `generate` breaks the bundle.
    expect(table.some(entry => entry.path === "src/rspeedy.ts")).toBe(true);
  });
});

describe("require-native-evidence: what counts as native-facing", () => {
  it("passes when the change touches no native-facing path", () => {
    const dir = newRepo();
    const base = gitOutput(dir, "rev-parse", "HEAD");
    write(dir, "docs/contract.md", "documentation only\n");
    write(dir, "test/renderer.test.ts", "// a test only\n");
    const head = commitAll(dir, "docs: prose and a test");

    const run = runScript("--repo", dir, "--range", range(base, head));

    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("nothing to require");
    expect(run.stdout).toContain("0 native-facing path(s)");
  });

  it("fails a change under src/ with no evidence, naming the path and what it looked for", () => {
    const dir = newRepo();
    const base = gitOutput(dir, "rev-parse", "HEAD");
    write(dir, "src/lynx-host.ts", "export const nativeFacing = true;\n");
    const head = commitAll(dir, "change the host");

    const run = runScript("--repo", dir, "--range", range(base, head));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("src/lynx-host.ts");
    expect(run.stdout).toContain("host adapter over the global Element PAPI");
    expect(run.stdout).toContain("docs/evidence/native/<date-or-id>/manifest.json");
    expect(run.stdout).toContain("verdict: missing evidence");
    expect(run.stdout).not.toContain("verdict: satisfied");
  });

  it("fails a change under examples/lynx-for-native/", () => {
    const dir = newRepo();
    const base = gitOutput(dir, "rev-parse", "HEAD");
    write(dir, "examples/lynx-for-native/src/main-thread.tsx", "// card\n");
    const head = commitAll(dir, "change the card");

    const run = runScript("--repo", dir, "--range", range(base, head));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("examples/lynx-for-native/src/main-thread.tsx");
    expect(run.stdout).toContain("under examples/lynx-for-native/");
  });

  it("fails a change to src/rspeedy.ts, which configures the native build", () => {
    const dir = newRepo();
    const base = gitOutput(dir, "rev-parse", "HEAD");
    write(dir, "src/rspeedy.ts", "export const generate = \"dom\";\n");
    const head = commitAll(dir, "break the native transform");

    const run = runScript("--repo", dir, "--range", range(base, head));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("src/rspeedy.ts");
    expect(run.stdout).toContain("injects the universal JSX transform");
  });
});

describe("require-native-evidence: ci.yml, only inside a native job", () => {
  const workflow = (browserStep: string, nativeStep: string): string => [
    "name: CI",
    "on:",
    "  pull_request:",
    "jobs:",
    "  unit:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - name: Unit tests",
    "        run: pnpm test",
    "  browser:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    `      - name: Browser${browserStep}`,
    "        run: pnpm web:test",
    "  native-build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    `      - name: Native${nativeStep}`,
    "        run: pnpm native:build",
    "",
  ].join("\n");

  it("ignores a change confined to a job that does no native work", () => {
    const dir = newRepo();
    write(dir, ".github/workflows/ci.yml", workflow(" old", " step"));
    const base = commitAll(dir, "add the workflow");

    // Edit the browser job's body only.
    write(dir, ".github/workflows/ci.yml", workflow(" changed", " step"));
    const head = commitAll(dir, "browser: tweak a step");

    const run = runScript("--repo", dir, "--range", range(base, head));

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("0 native-facing path(s)");
  });

  it("requires evidence when the change lands inside the native job", () => {
    const dir = newRepo();
    write(dir, ".github/workflows/ci.yml", workflow(" step", " step"));
    const base = commitAll(dir, "add the workflow");

    write(dir, ".github/workflows/ci.yml", workflow(" step", " build (changed)"));
    const head = commitAll(dir, "native-build: change the step");

    const run = runScript("--repo", dir, "--range", range(base, head));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain(".github/workflows/ci.yml");
    expect(run.stdout).toContain("inside the `native-build` job");
  });

  it("ignores a job APPENDED after native-build (the regression that failed its own install)", () => {
    // Measured on master: `--range 56b402c..HEAD` exited 1 because the appended
    // `native-evidence` job's leading blank and comment lines fell inside
    // `native-build`'s block boundary, which ran to the line before the next
    // job key. Hunk context made it worse: `@@ -339,0 +348,68 @@ jobs:` names the
    // enclosing section, not the job. Appending a job is not an edit to one.
    const dir = newRepo();
    write(dir, ".github/workflows/ci.yml", workflow(" step", " step"));
    const base = commitAll(dir, "add the workflow");

    write(dir, ".github/workflows/ci.yml", `${workflow(" step", " step")}`
      + "  native-evidence:\n"
      + "    # a comment block, as the real job has\n"
      + "    # several lines of it, leading into the key\n"
      + "    runs-on: ubuntu-latest\n"
      + "    steps:\n"
      + "      - name: Require native evidence\n"
      + "        run: node scripts/require-native-evidence.mjs\n");
    const head = commitAll(dir, "ci: append the native-evidence job");

    const run = runScript("--repo", dir, "--range", range(base, head));

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("0 native-facing path(s)");
    expect(run.stdout).toContain("not native-facing");
    expect(run.stdout).toContain("native-evidence");
    expect(run.stdout).toContain("a new job is not an edit to one");
  });

  it("ignores a comment-only edit above the native job", () => {
    // The same defect in its other shape: text added immediately above
    // `native-build:` was inside the previous job's span, never `native-build`'s.
    const dir = newRepo();
    write(dir, ".github/workflows/ci.yml", workflow(" step", " step"));
    const base = commitAll(dir, "add the workflow");

    write(dir, ".github/workflows/ci.yml",
      workflow(" step", " step").replace(
        "  native-build:\n",
        "  # a note added above the native job\n"
          + "  # and another line of it\n"
          + "\n"
          + "  native-build:\n",
      ));
    const head = commitAll(dir, "ci: comment above the native job");

    const run = runScript("--repo", dir, "--range", range(base, head));

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("0 native-facing path(s)");
    expect(run.stdout).toContain("only comment, blank, or whitespace lines changed");
  });

  it("requires evidence for a real run-step change inside native-build", () => {
    // The case the heuristic exists for, and the one the fix must not lose: the
    // native job's own `run:` line moves. This is a body line, so it counts.
    const dir = newRepo();
    write(dir, ".github/workflows/ci.yml", workflow(" step", " step"));
    const base = commitAll(dir, "add the workflow");

    write(dir, ".github/workflows/ci.yml",
      workflow(" step", " step").replace(
        "        run: pnpm native:build",
        "        run: pnpm native:build --mode production",
      ));
    const head = commitAll(dir, "native-build: change what it runs");

    const run = runScript("--repo", dir, "--range", range(base, head));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("native:   1 native-facing path(s)");
    expect(run.stdout).toContain("significant line(s) changed inside the `native-build` job body");
    expect(run.stdout).toContain("not a comment or a");
  });

  it("requires evidence when the native job's own lines are deleted", () => {
    // A removed step is attributed against the base revision, so deleting the
    // native job rather than editing it cannot slip through.
    const dir = newRepo();
    write(dir, ".github/workflows/ci.yml", workflow(" step", " step"));
    const base = commitAll(dir, "add the workflow");

    write(dir, ".github/workflows/ci.yml", [
      "name: CI",
      "on:",
      "  pull_request:",
      "jobs:",
      "  unit:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - name: Unit tests",
      "        run: pnpm test",
      "",
    ].join("\n"));
    const head = commitAll(dir, "ci: drop the native job");

    const run = runScript("--repo", dir, "--range", range(base, head));

    // Removing the job is the case the structural rule must still catch, and it
    // now names it precisely rather than relying on line overlap: a native job
    // that disappeared is itself a change to native CI.
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("removed or renamed by this");
    expect(run.stdout).toContain("native-build");
  });
});

describe("require-native-evidence: a stored capture", () => {
  it("passes when the change carries a capture the verifier accepts", () => {
    const dir = newRepo();
    const base = gitOutput(dir, "rev-parse", "HEAD");
    write(dir, "src/lynx-host.ts", "export const nativeFacing = true;\n");
    const final = storeCaptureInChange(dir, "native: change the host with evidence");

    const run = runScript("--repo", dir, "--range", range(base, final));

    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("verdict: satisfied");
    expect(run.stdout).toContain("verified exit 0");
    expect(run.stdout).toContain("docs/evidence/native/2026-11-20-smoke");
    expect(run.stdout).toContain("remains manual");
  });

  it("fails when the stored capture is findings, not a pass", () => {
    const dir = newRepo();
    const base = gitOutput(dir, "rev-parse", "HEAD");
    write(dir, "src/lynx-host.ts", "export const nativeFacing = true;\n");
    write(dir, "docs/evidence/native/2026-11-20-smoke/lynx_console-smoke-test.log",
      readFileSync(path.join(FIXTURES, "not-passing.log"), "utf8"));
    write(dir, "docs/evidence/native/2026-11-20-smoke/manifest.json",
      manifestFor(dir, { verifier: { exitCode: 0, verdict: VERDICT_ZERO } }));
    const head = commitAll(dir, "native: evidence that does not pass");

    const run = runScript("--repo", dir, "--range", range(base, head));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("verdict: missing evidence");
    expect(run.stdout).toContain("reads");
    expect(run.stdout).toContain("as findings (exit 1)");
  });

  it("cannot evaluate when the stored capture has no parity line", () => {
    // A verifier exit of 2 is "could not read this at all", which the top-level
    // exit code has to preserve: it is not the same result as "not evidenced".
    const dir = newRepo();
    const base = gitOutput(dir, "rev-parse", "HEAD");
    write(dir, "src/lynx-host.ts", "export const nativeFacing = true;\n");
    write(dir, "docs/evidence/native/2026-11-20-smoke/lynx_console-smoke-test.log",
      readFileSync(path.join(FIXTURES, "empty-capture.log"), "utf8"));
    write(dir, "docs/evidence/native/2026-11-20-smoke/manifest.json", manifestFor(dir));
    const head = commitAll(dir, "native: unreadable evidence");

    const run = runScript("--repo", dir, "--range", range(base, head));

    expect(run.status).toBe(2);
    expect(run.stdout).toContain("could not evaluate");
    expect(run.stdout).not.toContain("verdict: satisfied");
  });

  it("fails when the manifest names a capture that is not stored beside it", () => {
    const dir = newRepo();
    const base = gitOutput(dir, "rev-parse", "HEAD");
    write(dir, "src/lynx-host.ts", "export const nativeFacing = true;\n");
    write(dir, "docs/evidence/native/2026-11-20-smoke/manifest.json", manifestFor(dir));
    const head = commitAll(dir, "native: manifest with no capture");

    const run = runScript("--repo", dir, "--range", range(base, head));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("a manifest without its capture is a claim, not evidence");
  });

  it("fails when the recorded verifier verdict disagrees with the stored bytes", () => {
    const dir = newRepo();
    const base = gitOutput(dir, "rev-parse", "HEAD");
    write(dir, "src/lynx-host.ts", "export const nativeFacing = true;\n");
    write(dir, "docs/evidence/native/2026-11-20-smoke/lynx_console-smoke-test.log", GOOD_CAPTURE);
    const recorded = commitAll(dir, "native: a verdict written from a different run");
    write(dir, "docs/evidence/native/2026-11-20-smoke/manifest.json",
      manifestFor(dir, {
        commit: recorded,
        verifier: {
          exitCode: 0,
          // A verdict from a run with a different operation count: the line does
          // not occur in the live output for these bytes.
          verdict: "verdict: verified — 19 operation(s) pass across 1 captured report(s).",
        },
      }));
    const head = commitAll(dir, "evidence: record a stale verdict");

    const run = runScript("--repo", dir, "--range", range(base, head));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("does not appear in today's verifier output");
  });

  it("fails a manifest whose device never reached `device` state", () => {
    const dir = newRepo();
    const base = gitOutput(dir, "rev-parse", "HEAD");
    write(dir, "src/lynx-host.ts", "export const nativeFacing = true;\n");
    write(dir, "docs/evidence/native/2026-11-20-smoke/lynx_console-smoke-test.log", GOOD_CAPTURE);
    write(dir, "docs/evidence/native/2026-11-20-smoke/manifest.json",
      manifestFor(dir, { device: { serial: "R9WT911JVVH", getState: "unauthorized" } }));
    const head = commitAll(dir, "native: evidence from a device that was not usable");

    const run = runScript("--repo", dir, "--range", range(base, head));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain('"device.getState" must be "device"');
  });

  it("fails a manifest that is missing required fields", () => {
    const dir = newRepo();
    const base = gitOutput(dir, "rev-parse", "HEAD");
    write(dir, "src/lynx-host.ts", "export const nativeFacing = true;\n");
    write(dir, "docs/evidence/native/2026-11-20-smoke/lynx_console-smoke-test.log", GOOD_CAPTURE);
    write(dir, "docs/evidence/native/2026-11-20-smoke/manifest.json",
      `${JSON.stringify({ kind: "capture", card: "not-a-card" }, null, 2)}\n`);
    const head = commitAll(dir, "native: an incomplete manifest");

    const run = runScript("--repo", dir, "--range", range(base, head));

    expect(run.status).toBe(1);
    for (const field of ["card", "capture", "device", "timestamp", "commit", "verifier"]) {
      expect(run.stdout).toContain(field);
    }
  });

  it("fails a capture when native code changed after the run that produced it", () => {
    // The reuse hole, and the reason the range edge is not enough on its own: a
    // good capture committed in this range verifies clean, so it would back any
    // later native change in the same branch. What separates the two is that a
    // native-facing file moved again after the commit the record names.
    const dir = newRepo();
    const base = gitOutput(dir, "rev-parse", "HEAD");
    write(dir, "src/lynx-host.ts", "export const nativeFacing = true;\n");
    storeCaptureInChange(dir, "native: the capture and its change");
    write(dir, "src/lynx-host.ts", "export const nativeFacing = \"changed again\";\n");
    const head = commitAll(dir, "native: change the behaviour after the run");

    const run = runScript("--repo", dir, "--range", range(base, head));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("changed after the recorded run");
    expect(run.stdout).toContain("src/lynx-host.ts");
    expect(run.stdout).toContain("Run the card again");
  });

  it("fails a manifest recording a commit this repository does not have", () => {
    const dir = newRepo();
    const base = gitOutput(dir, "rev-parse", "HEAD");
    write(dir, "src/lynx-host.ts", "export const nativeFacing = true;\n");
    write(dir, "docs/evidence/native/2026-11-20-smoke/lynx_console-smoke-test.log", GOOD_CAPTURE);
    write(dir, "docs/evidence/native/2026-11-20-smoke/manifest.json",
      manifestFor(dir, { commit: "0123456789abcdef0123456789abcdef01234567" }));
    const head = commitAll(dir, "native: a manifest from another repository");

    const run = runScript("--repo", dir, "--range", range(base, head));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("does not have");
  });
});

describe("require-native-evidence: the state of this repository", () => {
  it("rejects docs/evidence/native/TEMPLATE when it is offered as evidence", () => {
    // The template ships a manifest and no capture. If it could satisfy the
    // gate, the gate would be satisfiable by copying a file.
    const dir = newRepo();
    const base = gitOutput(dir, "rev-parse", "HEAD");
    write(dir, "src/lynx-host.ts", "export const nativeFacing = true;\n");
    const templateManifest = readFileSync(
      path.join(REPO_ROOT, "docs/evidence/native/TEMPLATE/manifest.json"),
      "utf8",
    );
    // Copied verbatim, so the test fails if the template alone could ever pass.
    write(dir, "docs/evidence/native/TEMPLATE/manifest.json", templateManifest);
    write(dir, "docs/evidence/native/TEMPLATE/lynx_console-smoke-test.log", GOOD_CAPTURE);
    const head = commitAll(dir, "native: the template, offered as evidence");

    const run = runScript("--repo", dir, "--range", range(base, head));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("is the template, not evidence");
  });

  it("ships a template manifest with every required field and no capture", () => {
    const templateDir = path.join(REPO_ROOT, "docs/evidence/native/TEMPLATE");
    const entries = readdirSync(templateDir);

    // Only the manifest: a template directory that carried a capture would be a
    // fake device run sitting in the tree.
    expect(entries).toEqual(["manifest.json"]);

    const manifest = JSON.parse(readFileSync(path.join(templateDir, "manifest.json"), "utf8"));
    for (const field of ["kind", "card", "capture", "device", "timestamp", "commit", "verifier"]) {
      expect(manifest, `template manifest needs ${field}`).toHaveProperty(field);
    }
    expect(manifest.kind).toBe("capture");
    expect(manifest.device.getState).toBe("device");
    expect(manifest.verifier.exitCode).toBe(0);
  });

  it("ships evidence documentation and no stored captures yet", () => {
    const root = path.join(REPO_ROOT, "docs/evidence/native");
    expect(existsSync(path.join(root, "README.md"))).toBe(true);

    // Everything else under the root is the template. When the first real
    // capture lands this assertion changes with it, deliberately.
    const entries = readdirSync(root).sort();
    expect(entries).toEqual(["README.md", "TEMPLATE"]);
  });
});

describe("require-native-evidence: a recorded decision instead of a run", () => {
  it("passes when a decision record covers the changed native path", () => {
    const dir = newRepo();
    const base = gitOutput(dir, "rev-parse", "HEAD");
    write(dir, "src/lynx-host.ts", "export const commentOnly = true;\n");
    write(dir, "docs/evidence/native/2026-11-20-comment/decision.json", `${JSON.stringify({
      kind: "decision",
      decision: "no device run needed for this change",
      reason: "The change only rewrites a doc comment on the host adapter; the emitted"
        + " Element PAPI calls are unchanged, so a device run would measure the same bundle.",
      author: "@maintainer",
      timestamp: "2026-11-20T10:04:00Z",
      paths: ["src/lynx-host.ts"],
    }, null, 2)}\n`);
    const head = commitAll(dir, "native: comment-only change with a recorded decision");

    const run = runScript("--repo", dir, "--range", range(base, head));

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("verdict: satisfied");
    expect(run.stdout).toContain("decision recorded by @maintainer");
  });

  it("fails a decision record with a reason too thin to weigh", () => {
    const dir = newRepo();
    const base = gitOutput(dir, "rev-parse", "HEAD");
    write(dir, "src/lynx-host.ts", "export const nativeFacing = true;\n");
    write(dir, "docs/evidence/native/2026-11-20-comment/decision.json", `${JSON.stringify({
      kind: "decision",
      decision: "not needed",
      reason: "trivial",
      author: "@maintainer",
      timestamp: "2026-11-20T10:04:00Z",
      paths: ["src/lynx-host.ts"],
    }, null, 2)}\n`);
    const head = commitAll(dir, "native: a decision with no reason");

    const run = runScript("--repo", dir, "--range", range(base, head));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("at least 40 characters");
  });

  it("fails a decision record that names only some of the changed native paths", () => {
    // A decision has to account for the change, not one file in it. Otherwise a
    // record naming a single path rubber-stamps everything that rode along.
    const dir = newRepo();
    const base = gitOutput(dir, "rev-parse", "HEAD");
    write(dir, "src/lynx-host.ts", "export const nativeFacing = true;\n");
    write(dir, "src/root.ts", "export const alsoNativeFacing = true;\n");
    write(dir, "docs/evidence/native/2026-11-20-comment/decision.json", `${JSON.stringify({
      kind: "decision",
      decision: "no device run needed for this change",
      reason: "The host adapter change only rewrites a doc comment, and this record was"
        + " written before the second file was added to the branch.",
      author: "@maintainer",
      timestamp: "2026-11-20T10:04:00Z",
      paths: ["src/lynx-host.ts"],
    }, null, 2)}\n`);
    const head = commitAll(dir, "native: a decision that names one of two paths");

    const run = runScript("--repo", dir, "--range", range(base, head));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("covers 1 of 2 native-facing path(s)");
    expect(run.stdout).toContain("does not name `src/root.ts`");
  });

  it("fails a decision record that covers none of the changed native paths", () => {
    const dir = newRepo();
    const base = gitOutput(dir, "rev-parse", "HEAD");
    write(dir, "src/lynx-host.ts", "export const nativeFacing = true;\n");
    write(dir, "docs/evidence/native/2026-11-20-comment/decision.json", `${JSON.stringify({
      kind: "decision",
      decision: "no device run needed for this change",
      reason: "The decision is about the list probe only, which this change does not touch"
        + " at all, so it was recorded against the wrong file.",
      author: "@maintainer",
      timestamp: "2026-11-20T10:04:00Z",
      paths: ["examples/lynx-for-native/src/list-probe.ts"],
    }, null, 2)}\n`);
    const head = commitAll(dir, "native: a decision about something else");

    const run = runScript("--repo", dir, "--range", range(base, head));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("covers none of the native-facing paths in this change");
  });
});

describe("require-native-evidence: refusing to guess", () => {
  it("cannot evaluate without a range when origin/master does not exist", () => {
    // The default is the merge base against origin/master, and there is
    // deliberately no fallback: a guessed base would report "nothing to require"
    // for every change forever.
    const dir = newRepo();
    write(dir, "src/lynx-host.ts", "export const nativeFacing = true;\n");
    commitAll(dir, "change the host");

    const run = runScript("--repo", dir);

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("origin/master");
    expect(run.stderr).toContain("--range origin/master..HEAD");
    expect(run.stdout).toContain("could not evaluate");
  });

  it("cannot evaluate a range whose revision does not resolve", () => {
    const dir = newRepo();
    const head = gitOutput(dir, "rev-parse", "HEAD");

    const run = runScript("--repo", dir, "--range", `deadbeef..${head}`);

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("cannot resolve `deadbeef`");
  });

  it("cannot evaluate outside a git repository", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "solid-lynx-no-git-"));

    const run = runScript("--repo", dir, "--range", "HEAD..HEAD");

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("is not inside a git repository");
  });

  it("rejects a malformed --range as usage, not as a pass", () => {
    const dir = newRepo();

    for (const bad of ["HEAD", "..HEAD", "HEAD.."]) {
      const run = runScript("--repo", dir, "--range", bad);
      expect(run.status, `--range ${bad}`).toBe(2);
      expect(run.stderr).toContain("--range expects");
    }

    // A three-dot form is explicitly refused rather than silently treated as a
    // two-dot range, which is how `A...B` ends up diffing the wrong thing.
    const threeDot = runScript("--repo", dir, "--range", "HEAD...HEAD");
    expect(threeDot.status).toBe(2);
    expect(threeDot.stderr).toContain("two-dot range");
  });

  it("documents its exit codes, the evidence contract, and the dagr discipline in --help", () => {
    const run = runScript("--help");

    expect(run.status).toBe(0);
    for (const phrase of [
      "0  satisfied",
      "1  missing evidence",
      "2  could not evaluate",
      "dagr",
      "docs/evidence/native",
      "manifest.json",
      "decision.json",
      "TEMPLATE",
      "pnpm build",
    ]) {
      expect(run.stdout).toContain(phrase);
    }
  });
});
