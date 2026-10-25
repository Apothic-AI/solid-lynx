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

/**
 * The probe fixtures, as bytes. Also fixtures, also never device evidence:
 * `test/fixtures/native-probe/README.md` says so beside them.
 */
const PROBE_FIXTURES = path.join(REPO_ROOT, "test", "fixtures", "native-probe");
const probeFixture = (name: string): string =>
  readFileSync(path.join(PROBE_FIXTURES, name), "utf8");

const PROBE_VERIFIER =
  "scripts/verify-native-probe.mjs";
const PARITY_VERIFIER =
  "scripts/verify-native-parity.mjs";

/** The probe verifier's verdict line for a clean stylesheet capture. */
const STYLESHEET_VERDICT =
  "verdict: verified — 6 required stage(s) present across 1 card(s), and nothing in"
  + " the capture contradicts what it records. What the stages mean is still read"
  + " against docs/capabilities.md.";

/** The same line for a clean list capture, which has seven required stages. */
const LIST_VERDICT =
  "verdict: verified — 7 required stage(s) present across 1 card(s), and nothing in"
  + " the capture contradicts what it records. What the stages mean is still read"
  + " against docs/capabilities.md.";

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
function storeCaptureInChange(
  dir: string,
  message: string,
  name = "2026-11-20-smoke",
  options: { capture?: string; captureName?: string; manifest?: Record<string, unknown> } = {},
): string {
  const captureName = options.captureName ?? "lynx_console-smoke-test.log";
  write(dir, `docs/evidence/native/${name}/${captureName}`,
    options.capture ?? GOOD_CAPTURE);
  const recorded = commitAll(dir, message);
  write(dir, `docs/evidence/native/${name}/manifest.json`,
    manifestFor(dir, { capture: captureName, commit: recorded, ...options.manifest }));
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

describe("require-native-evidence: probe captures, verified by their own card", () => {
  /**
   * The evidence contract now accepts a probe capture, because there is a process
   * that can verify one. What these cases keep honest is the pairing: the card in
   * the manifest picks the verifier, so a probe capture cannot back a smoke claim
   * and a smoke capture cannot back a probe claim. Neither direction is allowed to
   * degrade into "whichever verifier understands the bytes".
   */
  it("passes when a stylesheet capture carries every stage its card emits", () => {
    const dir = newRepo();
    const base = gitOutput(dir, "rev-parse", "HEAD");
    write(dir, "src/lynx-host.ts", "export const nativeFacing = true;\n");
    const final = storeCaptureInChange(dir, "native: change the host with a probe capture",
      "2026-11-20-stylesheet", {
        capture: probeFixture("stylesheet-good.log"),
        captureName: "lynx_console-stylesheet-test.log",
        manifest: {
          card: "stylesheet",
          verifier: { exitCode: 0, verdict: STYLESHEET_VERDICT },
        },
      });

    const run = runScript("--repo", dir, "--range", range(base, final));

    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("verdict: satisfied");
    expect(run.stdout).toContain("verified exit 0 by " + PROBE_VERIFIER);
    expect(run.stdout).toContain("docs/evidence/native/2026-11-20-stylesheet");
  });

  it("passes when a list capture answers the recycling question with a zero", () => {
    // The case a weaker contract would reject: the host never called
    // enqueueComponent, which is a measurement, not missing evidence.
    const dir = newRepo();
    const base = gitOutput(dir, "rev-parse", "HEAD");
    write(dir, "src/lynx-host.ts", "export const nativeFacing = true;\n");
    const final = storeCaptureInChange(dir, "native: a list run with a probe capture",
      "2026-11-20-list", {
        capture: probeFixture("list-never-recycled.log"),
        captureName: "lynx_console-list-test.log",
        manifest: {
          card: "list",
          verifier: { exitCode: 0, verdict: LIST_VERDICT },
        },
      });

    const run = runScript("--repo", dir, "--range", range(base, final));

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("verdict: satisfied");
    expect(run.stdout).toContain("list capture from R9WT911JVVH");
  });

  it("fails a list capture whose stages never answer the recycling question", () => {
    const dir = newRepo();
    const base = gitOutput(dir, "rev-parse", "HEAD");
    write(dir, "src/lynx-host.ts", "export const nativeFacing = true;\n");
    const final = storeCaptureInChange(dir, "native: a list capture with no answer",
      "2026-11-20-list", {
        capture: probeFixture("list-no-answer.log"),
        captureName: "lynx_console-list-test.log",
        // The manifest claims a clean run; the stored bytes disagree.
        manifest: {
          card: "list",
          verifier: { exitCode: 0, verdict: LIST_VERDICT },
        },
      });

    const run = runScript("--repo", dir, "--range", range(base, final));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("verdict: missing evidence");
    expect(run.stdout).toContain(PROBE_VERIFIER);
    expect(run.stdout).toContain("as findings (exit 1)");
  });

  it("fails a stylesheet capture that is missing a required stage", () => {
    const dir = newRepo();
    const base = gitOutput(dir, "rev-parse", "HEAD");
    write(dir, "src/lynx-host.ts", "export const nativeFacing = true;\n");
    const final = storeCaptureInChange(dir, "native: a short stylesheet capture",
      "2026-11-20-stylesheet", {
        capture: probeFixture("stylesheet-missing-stage.log"),
        captureName: "lynx_console-stylesheet-test.log",
        manifest: { card: "stylesheet" },
      });

    const run = runScript("--repo", dir, "--range", range(base, final));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain(PROBE_VERIFIER);
    expect(run.stdout).toContain("as findings (exit 1)");
    // The verifier's own finding is quoted, so the report names the stage.
    expect(run.stdout).toContain("[missing-stage]");
    expect(run.stdout).toContain("`load-real-url`");
  });

  it("cannot evaluate a probe capture whose stage line was truncated", () => {
    const dir = newRepo();
    const base = gitOutput(dir, "rev-parse", "HEAD");
    write(dir, "src/lynx-host.ts", "export const nativeFacing = true;\n");
    const final = storeCaptureInChange(dir, "native: an unreadable probe capture",
      "2026-11-20-stylesheet", {
        capture: probeFixture("stylesheet-unparseable.log"),
        captureName: "lynx_console-stylesheet-test.log",
        manifest: { card: "stylesheet" },
      });

    const run = runScript("--repo", dir, "--range", range(base, final));

    // Not "missing evidence": the record exists and cannot be read, which has to
    // keep its own exit code.
    expect(run.status).toBe(2);
    expect(run.stdout).toContain("could not evaluate");
    expect(run.stdout).toContain(PROBE_VERIFIER);
  });

  it("cannot evaluate a probe capture offered as smoke evidence", () => {
    // The card decides the verifier, so the two capture formats are not
    // interchangeable. A `smoke` manifest over stage lines gets exit 2 from the
    // parity verifier rather than passing through the verifier that understands
    // the bytes.
    const dir = newRepo();
    const base = gitOutput(dir, "rev-parse", "HEAD");
    write(dir, "src/lynx-host.ts", "export const nativeFacing = true;\n");
    const final = storeCaptureInChange(dir, "native: a probe capture labelled smoke",
      "2026-11-20-smoke", {
        capture: probeFixture("stylesheet-good.log"),
        manifest: { card: "smoke" },
      });

    const run = runScript("--repo", dir, "--range", range(base, final));

    expect(run.status).toBe(2);
    expect(run.stdout).toContain("could not evaluate");
    expect(run.stdout).toContain(PARITY_VERIFIER);
    expect(run.stdout).toContain("no [solid-lynx parity] line");
  });

  it("cannot evaluate a smoke capture offered as probe evidence", () => {
    const dir = newRepo();
    const base = gitOutput(dir, "rev-parse", "HEAD");
    write(dir, "src/lynx-host.ts", "export const nativeFacing = true;\n");
    const final = storeCaptureInChange(dir, "native: a parity capture labelled stylesheet",
      "2026-11-20-stylesheet", {
        capture: GOOD_CAPTURE,
        captureName: "lynx_console-stylesheet-test.log",
        manifest: { card: "stylesheet" },
      });

    const run = runScript("--repo", dir, "--range", range(base, final));

    expect(run.status).toBe(2);
    expect(run.stdout).toContain("could not evaluate");
    expect(run.stdout).toContain(PROBE_VERIFIER);
    expect(run.stdout).toContain("contains no [solid-lynx ss2], [solid-lynx ss], [solid-lynx lp] line");
  });

  it("still refuses a probe capture whose card is not a card", () => {
    const dir = newRepo();
    const base = gitOutput(dir, "rev-parse", "HEAD");
    write(dir, "src/lynx-host.ts", "export const nativeFacing = true;\n");
    const final = storeCaptureInChange(dir, "native: a manifest with an invented card",
      "2026-11-20-stylesheet", {
        capture: probeFixture("stylesheet-good.log"),
        captureName: "lynx_console-stylesheet-test.log",
        manifest: { card: "stylesheet-probe" },
      });

    const run = runScript("--repo", dir, "--range", range(base, final));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain('"card" must be one of smoke, stylesheet, stylesheet2, list');
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

  it("ships evidence documentation, the template, and only re-verifiable records", () => {
    const root = path.join(REPO_ROOT, "docs/evidence/native");
    expect(existsSync(path.join(root, "README.md"))).toBe(true);

    // This assertion used to read "only pending records", and its comment said
    // it was there to notice the day a real capture landed. That day arrived:
    // the 2026-10-25 emulator runs are stored here. So it now asserts the
    // stronger thing -- not merely that entries exist, but that each one is
    // either a re-verifiable capture+manifest pair or a record form the gate
    // understands -- and it still fails loudly if a bare log is dropped in, or
    // if a manifest stops matching its capture.
    const entries = readdirSync(root).sort();
    const evidence = entries.filter(entry => entry !== "README.md" && entry !== "TEMPLATE");
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence).toEqual([
      "2026-10-25-emulator-api33-list",
      "2026-10-25-emulator-api33-smoke",
      "2026-10-25-emulator-api33-stylesheet",
      "2026-10-25-emulator-api33-stylesheet-v2",
    ]);

    // One directory is deliberately not a record: the v2 stylesheet capture has
    // no manifest, so the gate does not count it and neither does this test. It
    // is named rather than merely skipped, so a record that loses its manifest
    // cannot quietly join it.
    const supportingBytesOnly = "2026-10-25-emulator-api33-stylesheet-v2";

    const recordForms = ["pending.json", "decision.json"];
    for (const entry of evidence) {
      const dir = path.join(root, entry);
      const files = readdirSync(dir).sort();
      if (files.some(file => recordForms.includes(file))) {
        // A pending or decision directory holds that record and nothing that
        // looks like a measurement beside it.
        expect(files).toEqual(files.filter(file => recordForms.includes(file)));
        continue;
      }
      if (entry === supportingBytesOnly) {
        expect(files).toEqual(["capture.log"]);
        continue;
      }
      // Otherwise it is a stored run: a manifest plus the capture it names.
      expect(files).toContain("manifest.json");
      const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
      expect(manifest.kind).toBe("capture");
      expect(files).toContain(manifest.capture);
    }
  });

  it("stores the emulator records as A03-free, verifier-passing evidence", () => {
    // Two properties this repository depends on, asserted against the tree
    // rather than against a fixture: every stored record names the runtime it
    // came from, and its verifier exits 0 on the bytes beside it. Loosening
    // either would let a capture be cited for a device it was not taken on.
    const root = path.join(REPO_ROOT, "docs/evidence/native");
    const dirs = readdirSync(root)
      .filter(entry => entry !== "README.md" && entry !== "TEMPLATE")
      .map(entry => path.join(root, entry));
    expect(dirs.length).toBeGreaterThan(0);

    // A directory with no manifest is supporting bytes, not a record, and the
    // gate does not count it. There is exactly one of those and it is named, so
    // a record that loses its manifest cannot quietly become one of them.
    const withoutManifest = dirs.filter(dir => !existsSync(path.join(dir, "manifest.json")));
    expect(withoutManifest.map(dir => path.basename(dir)))
      .toEqual(["2026-10-25-emulator-api33-stylesheet-v2"]);

    for (const manifestPath of dirs
      .map(dir => path.join(dir, "manifest.json"))
      .filter(existsSync)) {
      const dir = path.dirname(manifestPath);
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      expect(manifest.device.getState).toBe("device");
      expect(manifest.runtime, `${manifestPath} must name its runtime`).toHaveProperty("kind");
      // An emulator run may not be recorded as the A03, and vice versa: the
      // serial and the runtime block have to agree about which one this was.
      const isEmulator = manifest.runtime.kind === "android-emulator";
      expect(manifest.device.serial.includes("emulator")).toBe(isEmulator);

      const verifier = manifest.card === "smoke" ? PARITY_VERIFIER : PROBE_VERIFIER;
      const run = spawnSync(
        process.execPath,
        [path.join(REPO_ROOT, verifier), path.join(dir, manifest.capture)],
        { cwd: REPO_ROOT, encoding: "utf8" },
      );
      expect(run.status, `${verifier} on ${manifest.capture}`).toBe(0);
      expect(manifest.verifier.exitCode).toBe(0);
      expect(run.stdout).toContain(manifest.verifier.verdict);
    }
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
      "3  pending, not a pass",
      "dagr",
      "docs/evidence/native",
      "manifest.json",
      "decision.json",
      "pending.json",
      "TEMPLATE",
      "pnpm build",
      // The per-card verifier pairing has to be in the help text, because a
      // contributor deciding which capture to store reads this first.
      "scripts/verify-native-parity.mjs",
      "scripts/verify-native-probe.mjs",
    ]) {
      expect(run.stdout).toContain(phrase);
    }
  });
});

describe("require-native-evidence: a pending record is not a pass", () => {
  /**
   * The third form, and the reason it exists.
   *
   * The contract used to have two outcomes: a capture verifies, or a decision
   * says no run is needed. A release whose probes are built and unit-tested and
   * waiting on an unattached device fits neither, so it had to either write a
   * decision asserting no run was needed — false — or be reported as having
   * dodged the requirement. Both are wrong in kind, and the first is a lie the
   * whole evidence directory exists to prevent.
   *
   * What these cases pin:
   *
   *  - complete coverage exits 3, never 0: "this release's native behaviour is
   *    unverified" must not look like a pass to a script or a CI green tick;
   *  - one path left out exits 1, because "pending" has to mean the record set
   *    is the complete truth about the range, not that somebody wrote the word;
   *  - a verified capture for the same range still wins with exit 0, because the
   *    measurement is the better answer and a release should not have to delete
   *    its pending record to record the run that finally happened;
   *  - a decision still behaves exactly as before, and the template is still
   *    rejected by name.
   */
  const NATIVE_PATHS = ["src/lynx-host.ts", "src/root.ts"];

  /** The blocker text a real record would carry, short enough to assert on. */
  const BLOCKER = "A03 R9WT911JVVH not attached over adb; work unit ub_y33g9p";

  const pendingRecord = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    kind: "pending",
    card: "stylesheet",
    reason: "The stylesheet probe card is built and its captures are verifiable, but no stage"
      + " line has been emitted on a device, so nothing about the stylesheet globals is measured.",
    blocked_by: BLOCKER,
    paths: [...NATIVE_PATHS],
    author: "@maintainer",
    timestamp: "2026-10-25T03:26:00-04:00",
    commit: "0".repeat(40),
    ...overrides,
  });

  /**
   * A change to two native-facing paths plus a pending record that covers them,
   * committed in that order — the record has to be able to name its own commit.
   * `paths` on the record can be overridden to drop one and test the hole.
   */
  function storePendingInChange(
    dir: string,
    options: { paths?: string[]; record?: Record<string, unknown>; name?: string } = {},
  ): string {
    const name = options.name ?? "2026-10-25-pending";
    write(dir, "src/lynx-host.ts", "export const nativeFacing = true;\n");
    write(dir, "src/root.ts", "export const alsoNativeFacing = true;\n");
    const recorded = commitAll(dir, "native: two files waiting on a device");
    write(dir, `docs/evidence/native/${name}/pending.json`, `${JSON.stringify(
      pendingRecord({ commit: recorded, ...(options.paths ? { paths: options.paths } : {}) }),
      null,
      2,
    )}\n`);
    return commitAll(dir, "evidence: record that the run is pending");
  }

  it("exits 3 and warns when a pending record covers every native path", () => {
    const dir = newRepo();
    const base = gitOutput(dir, "rev-parse", "HEAD");
    const head = storePendingInChange(dir);

    const run = runScript("--repo", dir, "--range", range(base, head));

    // 3, not 0 and not 1. This is the whole point of the change.
    expect(run.status).toBe(3);
    expect(run.stderr).toBe("");

    // The verdict says in as many words that nothing was verified.
    expect(run.stdout).toContain("verdict: pending");
    expect(run.stdout).toContain("nothing was verified as a pass");
    expect(run.stdout).toContain("Exit 3 is not a pass");
    expect(run.stdout).not.toContain("verdict: satisfied");

    // The warning block: unmissable, and it names what is missing rather than
    // only that something is.
    expect(run.stdout).toContain("NATIVE EVIDENCE PENDING — THIS IS NOT A PASS");
    expect(run.stdout).toContain("Card(s) awaiting a run: stylesheet");
    expect(run.stdout).toContain(`Blocker:               ${BLOCKER}`);
    expect(run.stdout).toContain("!! 2 pending native-facing path(s):");
    for (const nativePath of NATIVE_PATHS) {
      expect(run.stdout).toContain(`!!   - ${nativePath}`);
    }
  });

  it("exits 1 when the pending record leaves one native path out", () => {
    // A pending record has to be the complete truth for the range. Naming one of
    // two paths is how "we are honest that this is unverified" stops being true:
    // the second file is then dodge-shaped, and the gate says so.
    const dir = newRepo();
    const base = gitOutput(dir, "rev-parse", "HEAD");
    const head = storePendingInChange(dir, { paths: ["src/lynx-host.ts"] });

    const run = runScript("--repo", dir, "--range", range(base, head));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("verdict: missing evidence");
    expect(run.stdout).not.toContain("verdict: pending");
    // The report names the path nobody accounted for, not just the count.
    expect(run.stdout).toContain("covered by no pending.json and no decision.json");
    expect(run.stdout).toContain("  - src/root.ts");
  });

  it("lets a verifying capture win over a pending record for the same range", () => {
    // The capture supersedes the pending record, and this is the transition a
    // release actually makes: write "pending", attach the tablet, run the card,
    // store the capture. Requiring the pending record to be deleted first would
    // mean a red gate at exactly the moment the measurement arrived.
    const dir = newRepo();
    const base = gitOutput(dir, "rev-parse", "HEAD");
    write(dir, "src/lynx-host.ts", "export const nativeFacing = true;\n");
    write(dir, "src/root.ts", "export const alsoNativeFacing = true;\n");
    const pendingAt = commitAll(dir, "native: two files waiting on a device");
    write(dir, "docs/evidence/native/2026-10-25-pending/pending.json", `${JSON.stringify(
      pendingRecord({ commit: pendingAt }),
      null,
      2,
    )}\n`);
    commitAll(dir, "evidence: record that the run is pending");

    // Now the run happens, at this commit, and its capture is stored beside the
    // pending record — a different directory, because an entry holds one record.
    write(dir, "docs/evidence/native/2026-10-25-smoke/lynx_console-smoke-test.log", GOOD_CAPTURE);
    const recorded = commitAll(dir, "native: the run");
    write(dir, "docs/evidence/native/2026-10-25-smoke/manifest.json",
      manifestFor(dir, { capture: "lynx_console-smoke-test.log", commit: recorded }));
    const head = commitAll(dir, "evidence: store the capture the pending record awaited");

    const run = runScript("--repo", dir, "--range", range(base, head));

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("verdict: satisfied");
    expect(run.stdout).toContain("docs/evidence/native/2026-10-25-smoke");
    expect(run.stdout).toContain("verified exit 0");
    // The superseded pending record is still visible in the report, so a reader
    // knows the two records are connected and one of them can be cleaned up.
    expect(run.stdout).toContain("superseded by the verified capture");
    expect(run.stdout).not.toContain("THIS IS NOT A PASS");
  });

  it("still exits 0 for a decision record, and still 1 for the template", () => {
    // The two forms that existed before are unchanged by the third one. Asserted
    // together so a future edit that loosens the pending path cannot quietly
    // change what a decision or a template does.
    const dir = newRepo();
    const base = gitOutput(dir, "rev-parse", "HEAD");
    write(dir, "src/lynx-host.ts", "export const commentOnly = true;\n");
    write(dir, "docs/evidence/native/2026-10-25-comment/decision.json", `${JSON.stringify({
      kind: "decision",
      decision: "no device run needed for this change",
      reason: "The change only rewrites a doc comment on the host adapter; the emitted Element"
        + " PAPI calls are identical, so a device run would measure the same bundle.",
      author: "@maintainer",
      timestamp: "2026-10-25T03:26:00-04:00",
      paths: ["src/lynx-host.ts"],
    }, null, 2)}\n`);
    const head = commitAll(dir, "native: a comment-only change with a decision");

    const decided = runScript("--repo", dir, "--range", range(base, head));
    expect(decided.status).toBe(0);
    expect(decided.stdout).toContain("verdict: satisfied");
    expect(decided.stdout).toContain("decision recorded by @maintainer");

    // The template, in its own repository, is still rejected by name rather than
    // read as a pending or a capture record.
    const templateRepo = newRepo();
    const templateBase = gitOutput(templateRepo, "rev-parse", "HEAD");
    write(templateRepo, "src/lynx-host.ts", "export const nativeFacing = true;\n");
    write(templateRepo, "docs/evidence/native/TEMPLATE/manifest.json", readFileSync(
      path.join(REPO_ROOT, "docs/evidence/native/TEMPLATE/manifest.json"),
      "utf8",
    ));
    write(templateRepo, "docs/evidence/native/TEMPLATE/lynx_console-smoke-test.log", GOOD_CAPTURE);
    const templateHead = commitAll(templateRepo, "native: the template offered as evidence");

    const template = runScript("--repo", templateRepo, "--range",
      range(templateBase, templateHead));
    expect(template.status).toBe(1);
    expect(template.stdout).toContain("is the template, not evidence");
  });

  it("rejects a pending record that is missing a field, or leaves its blocker a shrug", () => {
    // Each case breaks exactly one field, so a failure names the field that is
    // wrong instead of "the record is bad". A `blocked_by` of "n/a" is the
    // specific shape this refuses: it looks like an answer and names nothing.
    const cases: { field: string; overrides: Record<string, unknown>; expect: string }[] = [
      { field: "card", overrides: { card: "probe" }, expect: '"card" must be one of smoke, stylesheet, stylesheet2, list' },
      { field: "reason", overrides: { reason: "no device" }, expect: "at least 40 characters" },
      { field: "blocked_by", overrides: { blocked_by: "n/a" }, expect: "must name what is actually missing" },
      { field: "blocked_by", overrides: { blocked_by: "tbd" }, expect: "must name what is actually missing" },
      { field: "blocked_by", overrides: { blocked_by: "no device" }, expect: "must name what is actually missing" },
      { field: "paths", overrides: { paths: [] }, expect: '"paths" must be a non-empty array' },
      { field: "author", overrides: { author: "" }, expect: '"author" must name who recorded' },
      { field: "timestamp", overrides: { timestamp: "yesterday" }, expect: '"timestamp" must be an ISO 8601' },
      { field: "commit", overrides: { commit: "HEAD" }, expect: '"commit" must be a git commit sha' },
    ];

    for (const testCase of cases) {
      const dir = newRepo();
      const base = gitOutput(dir, "rev-parse", "HEAD");
      write(dir, "src/lynx-host.ts", "export const nativeFacing = true;\n");
      const recorded = commitAll(dir, "native: a change with a broken pending record");
      write(dir, "docs/evidence/native/2026-10-25-pending/pending.json", `${JSON.stringify(
        pendingRecord({ commit: recorded, ...testCase.overrides }),
        null,
        2,
      )}\n`);
      const head = commitAll(dir, `evidence: pending record with a bad ${testCase.field}`);

      const run = runScript("--repo", dir, "--range", range(base, head));

      expect(run.status, `bad ${testCase.field} should exit 1`).toBe(1);
      expect(run.stdout, `bad ${testCase.field} should name the field`)
        .toContain(testCase.expect);
      // Never 3: an incomplete record is missing evidence, not a scheduled run.
      expect(run.stdout).not.toContain("verdict: pending");
    }
  });

  it("refuses a directory that holds both a pending record and a capture", () => {
    // One directory, one answer. "Was this measured?" has to have exactly one
    // answer, and a record set that says both has not made up its mind.
    const dir = newRepo();
    const base = gitOutput(dir, "rev-parse", "HEAD");
    write(dir, "src/lynx-host.ts", "export const nativeFacing = true;\n");
    const recorded = commitAll(dir, "native: a change with an ambiguous record");
    write(dir, "docs/evidence/native/2026-10-25-both/pending.json", `${JSON.stringify(
      pendingRecord({ commit: recorded, paths: ["src/lynx-host.ts"] }),
      null,
      2,
    )}\n`);
    write(dir, "docs/evidence/native/2026-10-25-both/lynx_console-smoke-test.log", GOOD_CAPTURE);
    write(dir, "docs/evidence/native/2026-10-25-both/manifest.json",
      manifestFor(dir, { commit: recorded }));
    const head = commitAll(dir, "evidence: a directory claiming both");

    const run = runScript("--repo", dir, "--range", range(base, head));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("carries manifest.json and pending.json");
    expect(run.stdout).toContain("a release cannot be both measured and awaiting measurement");
  });

  it("does not let a broken record beside a pending one turn the range into exit 3", () => {
    // "Pending" is supposed to mean the record set is the complete and honest
    // truth about the range. A failed capture in the same range means it is not,
    // and reporting 3 there would bury a real defect under a scheduled one.
    const dir = newRepo();
    const base = gitOutput(dir, "rev-parse", "HEAD");
    write(dir, "src/lynx-host.ts", "export const nativeFacing = true;\n");
    write(dir, "src/root.ts", "export const alsoNativeFacing = true;\n");
    const recorded = commitAll(dir, "native: two files, one measured badly");
    write(dir, "docs/evidence/native/2026-10-25-pending/pending.json", `${JSON.stringify(
      pendingRecord({ commit: recorded }),
      null,
      2,
    )}\n`);
    write(dir, "docs/evidence/native/2026-10-25-smoke/lynx_console-smoke-test.log",
      readFileSync(path.join(FIXTURES, "not-passing.log"), "utf8"));
    write(dir, "docs/evidence/native/2026-10-25-smoke/manifest.json",
      manifestFor(dir, { commit: recorded }));
    const head = commitAll(dir, "evidence: a pending record and a failing capture");

    const run = runScript("--repo", dir, "--range", range(base, head));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("verdict: missing evidence");
    expect(run.stdout).toContain("this is missing evidence rather than a scheduled run");
    expect(run.stdout).not.toContain("verdict: pending");
  });

  it("accepts a block of records, one per card, covering a split change", () => {
    // A release may honestly split its statement: "this file is waiting on the
    // tablet for the stylesheet card; these are waiting for the list card". Each
    // record on its own looks partial, so coverage is judged as a union across
    // the whole record set rather than per directory.
    const dir = newRepo();
    const base = gitOutput(dir, "rev-parse", "HEAD");
    write(dir, "src/lynx-host.ts", "export const nativeFacing = true;\n");
    write(dir, "src/root.ts", "export const alsoNativeFacing = true;\n");
    const recorded = commitAll(dir, "native: two files for two cards");
    write(dir, "docs/evidence/native/2026-10-25-split/pending.json", `${JSON.stringify([
      { ...pendingRecord({ commit: recorded, paths: ["src/lynx-host.ts"] }), card: "stylesheet" },
      { ...pendingRecord({ commit: recorded, paths: ["src/root.ts"] }), card: "list" },
    ], null, 2)}\n`);
    const head = commitAll(dir, "evidence: one pending record per card");

    const run = runScript("--repo", dir, "--range", range(base, head));

    expect(run.status).toBe(3);
    expect(run.stdout).toContain("verdict: pending");
    expect(run.stdout).toContain("Card(s) awaiting a run: stylesheet, list");
    expect(run.stdout).toContain("!! 2 pending native-facing path(s):");
  });

  it("rejects a pending record that speaks for a range it is not in", () => {
    // The same discipline a capture's `commit` gets: a record from outside this
    // range describes a different release, and accepting it would let last
    // release's pending note stand in for this one.
    const dir = newRepo();
    const before = gitOutput(dir, "rev-parse", "HEAD");
    write(dir, "docs/evidence/native/2026-10-24-stale/pending.json", `${JSON.stringify(
      pendingRecord({ commit: before, paths: ["src/lynx-host.ts"] }),
      null,
      2,
    )}\n`);
    const base = commitAll(dir, "evidence: a pending record from before the range");
    write(dir, "src/lynx-host.ts", "export const nativeFacing = true;\n");
    const head = commitAll(dir, "native: a later change with no record of its own");

    const run = runScript("--repo", dir, "--range", range(base, head));

    // Not 3: the only record in this range is from before it, so nothing here
    // says anything about this change.
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("verdict: missing evidence");
    expect(run.stdout).not.toContain("verdict: pending");
  });
});
