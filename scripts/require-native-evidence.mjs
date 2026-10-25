#!/usr/bin/env node
/**
 * Require native evidence for a change that touches native-facing behaviour.
 *
 * `scripts/verify-native-parity.mjs` turns a captured native log into an exit
 * code, and `docs/parity-checklist.md` says how to record the run. Both were
 * convention: the verifier is a command someone has to remember to run on a
 * capture someone has to keep, so a pull request that changed native behaviour
 * and ticked nothing merged and no check went red. This script is the check that
 * closes that hole. It answers one question about a git diff:
 *
 *   does this change touch native-facing behaviour, and if so, is there a
 *   stored evidence artifact committed with it that satisfies the requirement?
 *
 * The requirement has exactly two satisfying forms, both of which have to be
 * *committed by the change itself*:
 *
 *   1. `docs/evidence/native/<id>/manifest.json` plus the capture it names.
 *      This script runs `verify-native-parity.mjs` against the stored bytes and
 *      requires exit 0, cross-checking the manifest's recorded exit code and
 *      verdict line against the live run. The manifest's `commit` must fall
 *      inside the evaluated range, so a capture taken before the change cannot
 *      be reused for it.
 *   2. `docs/evidence/native/<id>/decision.json`: an explicit recorded
 *      decision that this native-facing change needs no device run, with a
 *      reason, an author, a timestamp, and the paths it covers.
 *
 * A native-facing change with neither is exit 1. `.github/workflows/ci.yml`
 * runs this over the pull-request range as the `native-evidence` job.
 *
 * What this cannot do, and does not claim: no device runs here. The manifest's
 * `device.getState` is a record written by whoever ran the capture, not a
 * measurement made by this process. What is machine-checked is that the capture
 * the manifest names parses, covers every operation in `parityOperationIds`,
 * and passes — plus that the paperwork around it is complete and committed
 * here. Whether a human actually held the A03 is a reviewer's question.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Exit codes, the same discipline the verifier and dagr use. */
const EXIT_SATISFIED = 0;
const EXIT_MISSING = 1;
const EXIT_COULD_NOT_EVALUATE = 2;

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const VERIFIER_PATH = path.join(SCRIPT_DIR, "verify-native-parity.mjs");
const NODE_LABEL = path.posix.join("scripts", "require-native-evidence.mjs");

/**
 * Where stored evidence lives. One directory per run, named by date or by any
 * stable id. The directories themselves are the unit: a manifest alone is not
 * evidence, and the capture alone cannot be verified without one.
 */
export const EVIDENCE_ROOT = "docs/evidence/native";

/** The directory name reserved for the template, which is never evidence. */
export const TEMPLATE_DIR_NAME = "TEMPLATE";

/** The capture file a manifest names, and the fields that manifest must carry. */
export const CAPTURE_MANIFEST = "manifest.json";
/** The alternative: an explicit recorded decision instead of a device run. */
export const DECISION_RECORD = "decision.json";

/** Cards `examples/lynx-for-native/scripts/run-native-probe.sh` accepts. */
export const NATIVE_CARDS = Object.freeze(["smoke", "stylesheet", "list"]);

/**
 * The native-facing surface, as an explicit, testable list.
 *
 * Every entry below was established by reading the code, not assumed:
 *
 *   - The native bundle's own entries are `examples/lynx-for-native/lynx.config.ts`
 *     → `src/main-thread.tsx`, `src/stylesheet-probe.ts`, `src/list-probe.ts`.
 *     Each imports `solid-lynx` (→ `src/index.ts`) and the smoke card also
 *     imports `solid-lynx/parity` (→ `src/parity.ts`).
 *   - `pluginSolidLynx` sets `moduleName: "solid-lynx"` with
 *     `generate: "universal"`, so the Solid JSX transform emits calls into
 *     `solid-lynx/jsx-runtime` (→ `src/jsx-runtime.ts`, and
 *     `src/jsx-dev-runtime.ts` for dev builds). Those import
 *     `src/universal.ts`, which is the renderer half the bundle runs on.
 *   - Following that import graph (runtime imports, not `import type`) reaches
 *     `events`, `index`, `jsx-dev-runtime`, `jsx-runtime`, `list`, `lynx-host`,
 *     `parity`, `refs`, `render-context`, `renderer`, `root`, and `universal`.
 *   - `host.ts` and `jsx-types.ts` are reached as types only, but they are the
 *     contract the native card is compiled against: a change there changes what
 *     the native bundle is allowed to emit, which is native-facing even though
 *     no JavaScript from them ships.
 *   - `rspeedy.ts` is not in the bundle. It is included deliberately, as its own
 *     group: it is what makes the native bundle native (it injects the universal
 *     JSX transform into the Lynx build), so a change to it — flipping
 *     `generate` to `"dom"`, dropping `delegateEvents: []` — produces a bundle
 *     that builds and then renders nothing. That is the failure mode this gate
 *     exists for.
 *   - `examples/lynx-for-native/` is the card, its runner, and its config: the
 *     thing a device actually loads.
 *   - `ci.yml` only when the change lands inside a job that runs native work.
 *     A comment fix in the `unit` job is not a native change; editing the
 *     `native-build` step is.
 *
 * `test/require-native-evidence.test.ts` asserts this list covers every file in
 * `src/`, so adding one forces a decision here instead of silently sitting
 * outside the gate.
 */
export const NATIVE_FACING_PATHS = Object.freeze([
  // Reached at runtime by the bundle, directly.
  { path: "src/index.ts", group: "runtime", why: "package entry the native cards import" },
  { path: "src/jsx-runtime.ts", group: "runtime", why: "JSX runtime the native transform emits into" },
  { path: "src/jsx-dev-runtime.ts", group: "runtime", why: "development JSX runtime for the same transform" },
  { path: "src/parity.ts", group: "runtime", why: "the harness the smoke card runs on a device" },
  { path: "src/universal.ts", group: "runtime", why: "universal renderer primitives the JSX runtime calls" },
  { path: "src/renderer.ts", group: "runtime", why: "Element PAPI renderer the native host drives" },
  { path: "src/root.ts", group: "runtime", why: "root lifecycle the cards call" },
  { path: "src/lynx-host.ts", group: "runtime", why: "host adapter over the global Element PAPI" },
  { path: "src/list.ts", group: "runtime", why: "list row model, reached from root" },
  { path: "src/refs.ts", group: "runtime", why: "ref handling exported by the entry" },
  { path: "src/events.ts", group: "runtime", why: "event prop parsing and dispatch" },
  { path: "src/render-context.ts", group: "runtime", why: "renderer scoping used by renderer and universal" },
  // Compiled against, not shipped.
  { path: "src/host.ts", group: "type", why: "LynxHost/LynxNode contract the native card compiles against" },
  { path: "src/jsx-types.ts", group: "type", why: "JSX attribute surface the native card compiles against" },
  // Configures the native build rather than running in it.
  { path: "src/rspeedy.ts", group: "build", why: "injects the universal JSX transform into the native build" },
  // The native app itself.
  {
    prefix: "examples/lynx-for-native/",
    group: "example",
    why: "the card, runner, and build config a device loads",
  },
  // The workflow, but only the jobs that run native work.
  {
    path: ".github/workflows/ci.yml",
    group: "ci",
    why: "only when the change lands inside one of the native jobs below",
  },
]);

/** Jobs in `.github/workflows/ci.yml` whose bodies count as a native change. */
export const NATIVE_CI_JOBS = Object.freeze(["native-build", "native-evidence"]);

const CI_WORKFLOW = ".github/workflows/ci.yml";

const USAGE = `require-native-evidence — require stored evidence for native changes

Usage:
  node ${NODE_LABEL} [--range A..B] [--repo <path>] [--print-native-paths]
  node ${NODE_LABEL} --help

What it decides
  It reads one git diff and asks: does this change touch native-facing
  behaviour, and if so is there committed evidence that satisfies the
  requirement?

  Native-facing means any path in NATIVE_FACING_PATHS (\`--print-native-paths\`
  prints it as JSON): every file under \`src/\` the native bundle reaches at
  runtime, the type surface it compiles against, \`src/rspeedy.ts\` because it
  configures the native build, everything under \`examples/lynx-for-native/\`,
  and \`.github/workflows/ci.yml\` only when the changed lines fall inside the
  \`native-build\` or \`native-evidence\` job.

  When nothing native-facing changed, nothing is required. When something did,
  one of these must be committed by the change itself:

    1. ${EVIDENCE_ROOT}/<date-or-id>/${CAPTURE_MANIFEST} plus the capture it names.
       The script runs ${path.posix.join("scripts", "verify-native-parity.mjs")} against that capture and requires
       exit 0, and checks the manifest's recorded exit code and verdict line
       agree with the live run. The manifest's \`commit\` must be inside the
       evaluated range, so an older capture cannot be re-used for a new change.
    2. ${EVIDENCE_ROOT}/<date-or-id>/${DECISION_RECORD}: an explicit recorded decision
       that this change needs no device run — a reason, an author, a timestamp,
       and the native-facing paths it covers.

  ${EVIDENCE_ROOT}/${TEMPLATE_DIR_NAME}/ is a template, never evidence.

Range
  --range A..B    evaluate \`git diff --name-only A B\`. Both sides are resolved
                  to commits.
  (default)       the merge base of HEAD and origin/master, up to HEAD. There is
                  deliberately no fallback: without origin/master this exits 2
                  and says to pass --range, because guessing a base is how a
                  check quietly stops covering anything.

Exit codes
  0  satisfied          nothing native-facing changed, or it did and a committed
                        capture verified (exit 0) or a decision record covers it
  1  missing evidence   something native-facing changed and no committed evidence
                        satisfies it: none present, a failed or mismatched
                        verifier run, a manifest missing a field, a capture taken
                        outside this range, or a decision with no reason
  2  could not evaluate git failed, the range would not resolve, or a stored
                        capture could not be verified at all (a 2 from the
                        verifier, e.g. a missing \`dist/\` — run \`pnpm build\`).
                        Never a pass.

  These follow the same discipline as dagr: 0 means the artefact is clean, 1
  means it was read and is insufficient, 2 means it could not be read. A 2 must
  never be cited as a pass.

No device, no adb, no network: this reads git and the filesystem only.
`;

class CannotEvaluate extends Error {}

function usageError(message) {
  return new CannotEvaluate(`${message}\n\nRun \`node ${NODE_LABEL} --help\` for usage.`);
}

/**
 * Runs git and returns its result without throwing, so a failure can be turned
 * into a message that names the command and its own stderr.
 */
function git(repoDir, args) {
  const result = spawnSync("git", ["-C", repoDir, ...args], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function gitOrThrow(repoDir, args, what) {
  const result = git(repoDir, args);
  if (result.status !== 0) {
    throw new CannotEvaluate(
      `${what}: \`git ${args.join(" ")}\` exited ${result.status}`
        + `${result.stderr.trim() ? ` — ${result.stderr.trim()}` : ""}.`,
    );
  }
  return result.stdout;
}

function parseArguments(argv) {
  const options = { range: undefined, repo: undefined, help: false, printPaths: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--print-native-paths") {
      options.printPaths = true;
      continue;
    }
    if (arg === "--range" || arg === "--repo") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("-")) {
        throw usageError(`${arg} needs a value.`);
      }
      if (arg === "--range") options.range = value;
      else options.repo = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--range=")) {
      options.range = arg.slice("--range=".length);
      continue;
    }
    if (arg.startsWith("--repo=")) {
      options.repo = arg.slice("--repo=".length);
      continue;
    }
    throw usageError(`unknown argument: ${arg}`);
  }

  if (options.range !== undefined) {
    if (options.range.includes("...")) {
      throw usageError(
        `--range expects a two-dot range \`A..B\` (a three-dot diff is not a range),`
          + ` got: ${options.range}`,
      );
    }
    const parts = options.range.split("..");
    if (parts.length !== 2 || parts[0] === "" || parts[1] === "") {
      throw usageError(
        `--range expects \`A..B\` with both sides filled in, got: ${options.range}`,
      );
    }
  }

  return options;
}

/** The git toplevel of `start`, or a message naming what failed. */
function findRepoRoot(start) {
  const result = git(start, ["rev-parse", "--show-toplevel"]);
  if (result.status !== 0) {
    throw new CannotEvaluate(
      `${start} is not inside a git repository (or git is not installed):`
        + ` ${result.stderr.trim() || "no output"}. Nothing was evaluated.`,
    );
  }
  return result.stdout.trim();
}

/** One revision as a full commit sha, or a message naming the revision. */
function resolveCommit(repoRoot, revision) {
  const result = git(repoRoot, ["rev-parse", "--verify", "--quiet", `${revision}^{commit}`]);
  if (result.status !== 0) {
    throw new CannotEvaluate(
      `cannot resolve \`${revision}\` to a commit in ${repoRoot}.`,
    );
  }
  return result.stdout.trim();
}

function resolveRange(repoRoot, options) {
  if (options.range !== undefined) {
    const [from, to] = options.range.split("..");
    return {
      from: resolveCommit(repoRoot, from),
      to: resolveCommit(repoRoot, to),
      label: options.range,
      source: "--range",
    };
  }

  const head = git(repoRoot, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
  if (head.status !== 0) {
    throw new CannotEvaluate(`HEAD does not resolve to a commit in ${repoRoot}.`);
  }

  const mergeBase = git(repoRoot, ["merge-base", "origin/master", "HEAD"]);
  if (mergeBase.status !== 0) {
    throw new CannotEvaluate(
      "could not work out the merge base against `origin/master`"
        + ` (${mergeBase.stderr.trim() || "no such ref"}), so there is no default range`
        + " to evaluate. Pass one explicitly, e.g. `--range origin/master..HEAD`. This"
        + " refuses instead of guessing, because a guessed or empty range would report"
        + " `nothing to require` for every change.",
    );
  }
  const from = mergeBase.stdout.trim();
  return {
    from,
    to: head.stdout.trim(),
    label: `${from}..${head.stdout.trim()}`,
    source: "merge base against origin/master",
  };
}

/** Changed paths in the range, `/`-separated as git reports them. */
function changedPaths(repoRoot, from, to) {
  const output = gitOrThrow(
    repoRoot,
    ["diff", "--name-only", "-z", "--no-color", from, to],
    "could not read the diff",
  );
  return output.split("\0").filter(entry => entry !== "");
}

/**
 * Job name → its line span, so a change can be attributed to the job it lands
 * in. Returns `null` when the file has no parseable `jobs:` block.
 */
function parseJobBlocks(text) {
  const lines = text.split("\n");
  const jobsAt = lines.findIndex(line => /^jobs:\s*(#.*)?$/.test(line));
  if (jobsAt < 0) return null;

  // The jobs section ends at the next top-level key, if the workflow has one
  // after `jobs:` (ci.yml does not, but a future one might).
  let sectionEnd = lines.length;
  for (let index = jobsAt + 1; index < lines.length; index += 1) {
    if (/^\S/.test(lines[index]) && lines[index].trim() !== "") {
      sectionEnd = index;
      break;
    }
  }

  const keys = [];
  for (let index = jobsAt + 1; index < sectionEnd; index += 1) {
    const match = /^ {2}([A-Za-z0-9_.-]+):\s*(#.*)?$/.exec(lines[index]);
    if (match) keys.push({ name: match[1], line: index + 1 });
  }

  const blocks = new Map();
  keys.forEach((key, index) => {
    const end = index + 1 < keys.length ? keys[index + 1].line - 1 : sectionEnd;
    blocks.set(key.name, { start: key.line, end });
  });
  return blocks;
}

/** `@@ -a,b +c,d @@` hunks as inclusive 1-based line spans on each side. */
function changedLineSpans(repoRoot, from, to, file) {
  const output = gitOrThrow(
    repoRoot,
    ["diff", "-U0", "--no-color", from, to, "--", file],
    `could not read the diff for ${file}`,
  );
  const removed = [];
  const added = [];
  for (const line of output.split("\n")) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!match) continue;
    const fromStart = Number(match[1]);
    const fromCount = match[2] === undefined ? 1 : Number(match[2]);
    const toStart = Number(match[3]);
    const toCount = match[4] === undefined ? 1 : Number(match[4]);
    if (fromCount > 0) removed.push([fromStart, fromStart + fromCount - 1]);
    if (toCount > 0) added.push([toStart, toStart + toCount - 1]);
  }
  return { removed, added };
}

/** `true` when any of `spans` overlaps any of `blocks`. */
function overlapsAny(spans, blocks) {
  for (const span of spans) {
    for (const block of blocks) {
      if (span[0] <= block.end && span[1] >= block.start) return true;
    }
  }
  return false;
}

/** The workflow file at one revision, or `undefined` when it did not exist. */
function workflowAt(repoRoot, revision) {
  const result = git(repoRoot, ["show", `${revision}:${CI_WORKFLOW}`]);
  return result.status === 0 ? result.stdout : undefined;
}

/**
 * Whether a `ci.yml` change lands inside a job that runs native work.
 *
 * Removed lines are attributed against the `from` revision and added lines
 * against the `to` revision, so deleting or renaming a native job counts. An
 * unparseable workflow counts as native-facing: requiring evidence for a
 * workflow nobody can read is the safe direction, and the message says why.
 */
function touchesNativeJob(repoRoot, from, to) {
  const { removed, added } = changedLineSpans(repoRoot, from, to, CI_WORKFLOW);
  if (removed.length === 0 && added.length === 0) {
    return { native: false, why: "changed lines are outside every job body" };
  }

  const sides = [
    { spans: removed, text: workflowAt(repoRoot, from), revision: from, side: "removed" },
    { spans: added, text: workflowAt(repoRoot, to), revision: to, side: "added" },
  ];

  for (const side of sides) {
    if (side.spans.length === 0) continue;
    if (side.text === undefined) continue; // the file did not exist on that side
    const blocks = parseJobBlocks(side.text);
    if (blocks === null) {
      return {
        native: true,
        why: `the workflow at ${side.revision.slice(0, 7)} has no parseable \`jobs:\` block,`
          + " so a change to it cannot be shown to avoid the native jobs",
      };
    }
    const nativeBlocks = NATIVE_CI_JOBS
      .filter(name => blocks.has(name))
      .map(name => ({ name, ...blocks.get(name) }));
    const hit = nativeBlocks.find(block => overlapsAny(side.spans, [block]));
    if (hit) {
      return {
        native: true,
        why: `changed ${side.side} line(s) fall inside the \`${hit.name}\` job`,
      };
    }
  }

  const names = NATIVE_CI_JOBS.join("` or `");
  return { native: false, why: `changed lines are outside the \`${names}\` job bodies` };
}

/** Every native-facing path in the diff, with the reason it counts. */
function nativeFacingChanges(repoRoot, from, to, paths) {
  const prefixRules = NATIVE_FACING_PATHS.filter(rule => rule.prefix !== undefined);
  const exactRules = new Map(
    NATIVE_FACING_PATHS.filter(rule => rule.path !== undefined).map(rule => [rule.path, rule]),
  );

  const found = [];
  for (const file of paths) {
    const exact = exactRules.get(file);
    if (exact !== undefined && exact.group !== "ci") {
      found.push({ path: file, why: exact.why });
      continue;
    }
    const prefix = prefixRules.find(rule => file.startsWith(rule.prefix));
    if (prefix !== undefined) {
      found.push({ path: file, why: `${prefix.why} (under ${prefix.prefix})` });
      continue;
    }
    if (exact !== undefined) {
      const verdict = touchesNativeJob(repoRoot, from, to);
      found.push({ path: file, why: verdict.why });
      if (!verdict.native) found.pop();
    }
  }
  return found;
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeValue(value) {
  if (typeof value === "undefined") return "undefined";
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function isText(value) {
  return typeof value === "string" && value.trim() !== "";
}

/** ISO 8601 or nothing; `Date.parse` alone accepts far too much. */
function isTimestamp(value) {
  return isText(value) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)
    && Number.isFinite(Date.parse(value));
}

function readJson(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { problems: [`cannot read ${file}: ${message}`] };
  }
  try {
    return { value: JSON.parse(text) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { problems: [`${file} is not valid JSON: ${message}`] };
  }
}

/** The fields a capture manifest must carry, checked for type and value. */
function validateCaptureManifest(manifest, dir) {
  const problems = [];
  const add = message => problems.push(message);

  if (!isPlainObject(manifest)) return ["manifest.json is not a JSON object"];

  if (manifest.kind !== "capture") {
    add(`"kind" must be "capture", got ${describeValue(manifest.kind)}`);
  }

  if (!isText(manifest.capture)) {
    add(`"capture" must name the capture file inside ${dir}, got ${describeValue(manifest.capture)}`);
  } else if (path.isAbsolute(manifest.capture) || manifest.capture.split(/[\\/]/).includes("..")) {
    add(`"capture" must be a relative path inside ${dir}, got ${describeValue(manifest.capture)}`);
  }

  if (!NATIVE_CARDS.includes(manifest.card)) {
    add(`"card" must be one of ${NATIVE_CARDS.join(", ")}, got ${describeValue(manifest.card)}`);
  }

  if (!isPlainObject(manifest.device)) {
    add(`"device" must be an object with "serial" and "getState"`);
  } else {
    if (!isText(manifest.device.serial)) {
      add(`"device.serial" must be the serial the run was pinned to, got ${describeValue(manifest.device.serial)}`);
    }
    // The one value that separates a run from an attempt: `adb get-state`
    // printing anything else means the device was not usable.
    if (manifest.device.getState !== "device") {
      add(`"device.getState" must be "device" (the \`adb get-state\` output), got`
        + ` ${describeValue(manifest.device.getState)}`);
    }
  }

  if (!isTimestamp(manifest.timestamp)) {
    add(`"timestamp" must be an ISO 8601 timestamp, got ${describeValue(manifest.timestamp)}`);
  }

  if (!isText(manifest.commit) || !/^[0-9a-f]{7,40}$/.test(manifest.commit)) {
    add(`"commit" must be a git commit sha, got ${describeValue(manifest.commit)}`);
  }

  if (!isPlainObject(manifest.verifier)) {
    add(`"verifier" must be an object with "exitCode" and "verdict"`);
  } else {
    if (manifest.verifier.exitCode !== 0) {
      add(`"verifier.exitCode" must be 0 (the only code that may be cited as a pass),`
        + ` got ${describeValue(manifest.verifier.exitCode)}`);
    }
    if (!isText(manifest.verifier.verdict)) {
      add(`"verifier.verdict" must be the verifier's verdict line, got`
        + ` ${describeValue(manifest.verifier.verdict)}`);
    }
  }

  return problems;
}

/** The decision record: an explicit "no device run" with its reason. */
function validateDecisionRecord(record, dir) {
  const problems = [];
  const add = message => problems.push(message);

  if (!isPlainObject(record)) return ["decision.json is not a JSON object"];

  if (record.kind !== "decision") {
    add(`"kind" must be "decision", got ${describeValue(record.kind)}`);
  }
  if (!isText(record.decision)) {
    add(`"decision" must state what was decided, got ${describeValue(record.decision)}`);
  }
  // Long enough to be a reason a reviewer can weigh, not a shrug.
  if (!isText(record.reason) || record.reason.trim().length < 40) {
    add(`"reason" must be at least 40 characters explaining why this native-facing`
      + ` change needs no device run, got ${describeValue(record.reason)}`);
  }
  if (!isText(record.author)) {
    add(`"author" must name who decided, got ${describeValue(record.author)}`);
  }
  if (!isTimestamp(record.timestamp)) {
    add(`"timestamp" must be an ISO 8601 timestamp, got ${describeValue(record.timestamp)}`);
  }
  if (!Array.isArray(record.paths) || record.paths.length === 0
    || record.paths.some(entry => !isText(entry))) {
    add(`"paths" must be a non-empty array of the native-facing paths it covers, got`
      + ` ${describeValue(record.paths)}`);
  }

  return problems;
}

/**
 * One evidence directory, judged. Returns `{ satisfied, problems, note, exit }`
 * — `exit` is the exit code this directory implies if nothing else satisfies
 * the requirement, so a missing `dist/` cannot be reported as missing evidence.
 */
function judgeEvidenceDir(repoRoot, from, to, nativeChanges, dirName) {
  const dir = path.join(repoRoot, EVIDENCE_ROOT, dirName);
  const manifestPath = path.join(dir, CAPTURE_MANIFEST);
  const decisionPath = path.join(dir, DECISION_RECORD);
  const hasManifest = existsSync(manifestPath);
  const hasDecision = existsSync(decisionPath);
  const label = `${EVIDENCE_ROOT}/${dirName}`;

  if (dirName === TEMPLATE_DIR_NAME) {
    return {
      satisfied: false,
      exit: EXIT_MISSING,
      note: `${label} is the template, not evidence: copy it to a new directory and`
        + " fill it in with a real run (see the README beside it)",
      problems: [],
    };
  }
  if (!hasManifest && !hasDecision) {
    return {
      satisfied: false,
      exit: EXIT_MISSING,
      note: `${label} has neither ${CAPTURE_MANIFEST} nor ${DECISION_RECORD}`,
      problems: [],
    };
  }
  if (hasManifest && hasDecision) {
    return {
      satisfied: false,
      exit: EXIT_MISSING,
      note: `${label} carries both ${CAPTURE_MANIFEST} and ${DECISION_RECORD}; an entry`
        + " is a capture or a decision, not both",
      problems: [],
    };
  }

  if (hasDecision) {
    const { value, problems: readProblems } = readJson(decisionPath);
    if (readProblems) return { satisfied: false, exit: EXIT_MISSING, note: label, problems: readProblems };

    const problems = validateDecisionRecord(value, dir);
    if (problems.length > 0) {
      return { satisfied: false, exit: EXIT_MISSING, note: `${label}/${DECISION_RECORD}`, problems };
    }

    // A decision has to account for the change, not a file in it: naming one
    // path out of several is how a decision record becomes a rubber stamp on
    // everything else that rode along with it.
    const nativePaths = new Set(nativeChanges.map(change => change.path));
    const covered = value.paths.filter(entry => nativePaths.has(entry));
    const unaccounted = [...nativePaths].filter(entry => !value.paths.includes(entry));
    if (covered.length === 0) {
      return {
        satisfied: false,
        exit: EXIT_MISSING,
        note: `${label}/${DECISION_RECORD} covers none of the native-facing paths in this`
          + ` change (it names ${value.paths.map(entry => `\`${entry}\``).join(", ")})`,
        problems: [],
      };
    }
    if (unaccounted.length > 0) {
      return {
        satisfied: false,
        exit: EXIT_MISSING,
        note: `${label}/${DECISION_RECORD} covers ${covered.length} of`
          + ` ${nativePaths.size} native-facing path(s) in this change`,
        problems: [
          `the decision does not name ${unaccounted.map(entry => `\`${entry}\``).join(", ")}`,
        ],
      };
    }
    const ignored = value.paths.filter(entry => !nativePaths.has(entry));
    return {
      satisfied: true,
      exit: EXIT_SATISFIED,
      note: `${label}/${DECISION_RECORD}: decision recorded by ${value.author} —`
        + ` "${value.decision}" (covers ${covered.map(entry => `\`${entry}\``).join(", ")})`
        + (ignored.length > 0
          ? `; ignores non-native ${ignored.map(entry => `\`${entry}\``).join(", ")}`
          : ""),
      problems: [],
    };
  }

  // A capture manifest: the real check. Every problem is collected rather than
  // returned one at a time, so a manifest with a stale commit *and* a capture
  // the verifier rejects says both things in one run instead of sending the
  // author round the loop twice.
  const { value: manifest, problems: readProblems } = readJson(manifestPath);
  if (readProblems) return { satisfied: false, exit: EXIT_MISSING, note: label, problems: readProblems };

  const problems = [];
  const couldNotEvaluate = [];
  const structural = validateCaptureManifest(manifest, dir);
  problems.push(...structural);

  const capturePath = structural.some(problem => problem.startsWith('"capture"'))
    ? undefined
    : path.resolve(dir, manifest.capture);

  if (capturePath !== undefined) {
    if (!capturePath.startsWith(dir + path.sep)) {
      problems.push(`"capture" escapes ${label}: ${manifest.capture}`);
    } else if (!existsSync(capturePath) || !statSync(capturePath).isFile()) {
      problems.push(
        `the manifest names ${manifest.capture}, but that file is not in ${label}`
          + " — a manifest without its capture is a claim, not evidence",
      );
    }
  }

  // The commit the capture was taken at has to fall inside the range: reachable
  // from the tip, and not already true at the base. `at the base` and `before the
  // base` are the same defect — the run predates the change it would back.
  const recordedCommit = typeof manifest.commit === "string"
    && /^[0-9a-f]{7,40}$/.test(manifest.commit)
    ? resolveEvidenceCommit(repoRoot, manifest.commit)
    : undefined;
  if (recordedCommit !== undefined) {
    if (recordedCommit.problem !== undefined) {
      problems.push(recordedCommit.problem);
    } else if (git(repoRoot, ["merge-base", "--is-ancestor", recordedCommit.sha, from]).status === 0) {
      problems.push(
        `the manifest records the capture at ${recordedCommit.sha.slice(0, 7)}, which is at`
          + " or before the base of this range — a run from before the change cannot show"
          + " the change",
      );
    } else if (git(repoRoot, ["merge-base", "--is-ancestor", recordedCommit.sha, to]).status !== 0) {
      problems.push(
        `the manifest records the capture at ${recordedCommit.sha.slice(0, 7)}, which is`
          + " not in this range's history — commit the capture with the change it backs",
      );
    } else {
      // The capture describes the bundle at `recordedCommit`, and nothing later.
      // A native-facing file touched again after that commit means the stored
      // capture no longer covers the tip, which is how an old run gets reused
      // for a change it never measured.
      const since = changedPaths(repoRoot, recordedCommit.sha, to);
      const after = nativeFacingChanges(repoRoot, recordedCommit.sha, to, since);
      if (after.length > 0) {
        problems.push(
          `native-facing path(s) changed after the recorded run at`
            + ` ${recordedCommit.sha.slice(0, 7)}: ${after.map(change => change.path).join(", ")}`
            + " — that capture describes the bundle before those changes, so it cannot"
            + " back them. Run the card again, or record a decision for this change.",
        );
      }
    }
  }

  // The point of the whole check: read the stored bytes, not the claim about them.
  let verifierVerdict = "";
  if (capturePath !== undefined && existsSync(capturePath) && statSync(capturePath).isFile()) {
    const run = spawnSync(process.execPath, [VERIFIER_PATH, capturePath], {
      encoding: "utf8",
      cwd: SCRIPT_DIR,
    });
    if (run.error) {
      throw new CannotEvaluate(
        `could not run ${path.posix.join("scripts", "verify-native-parity.mjs")}:`
          + ` ${run.error.message}`,
      );
    }
    const verifierExit = run.status ?? -1;
    verifierVerdict = (run.stdout ?? "")
      .split("\n")
      .find(line => line.startsWith("verdict:")) ?? "";

    if (verifierExit === 2) {
      // "Nothing was evaluated" is a different result from "not evidenced", and
      // the exit code has to keep them apart.
      couldNotEvaluate.push(
        `the verifier could not evaluate ${manifest.capture} (exit 2), so the stored`
          + ` capture proves nothing: ${(run.stderr ?? "").trim() || "no detail"}`,
      );
    } else if (verifierExit !== 0) {
      problems.push(
        `the verifier reads ${manifest.capture} as findings (exit ${verifierExit}), not a`
          + ` pass: ${verifierVerdict || "no verdict line"}`,
      );
    } else {
      if (manifest.verifier !== undefined && manifest.verifier.exitCode !== verifierExit) {
        problems.push(
          `the manifest records verifier exit ${manifest.verifier.exitCode}, but the stored`
            + ` capture verifies as exit ${verifierExit} today — the record is stale`,
        );
      }
      const recordedVerdict = manifest.verifier === undefined ? undefined : manifest.verifier.verdict;
      if (typeof recordedVerdict === "string"
        && !(run.stdout ?? "").includes(recordedVerdict.trim())) {
        problems.push(
          "the manifest's verdict line does not appear in today's verifier output"
            + ` (recorded: ${describeValue(recordedVerdict)}, live:`
            + ` ${describeValue(verifierVerdict)}) — it was written from a different run`,
        );
      }
    }
  }

  const allProblems = [...problems, ...couldNotEvaluate];
  if (allProblems.length > 0) {
    return {
      satisfied: false,
      exit: couldNotEvaluate.length > 0 ? EXIT_COULD_NOT_EVALUATE : EXIT_MISSING,
      note: `${label}/${CAPTURE_MANIFEST}`,
      problems: allProblems,
    };
  }

  return {
    satisfied: true,
    exit: EXIT_SATISFIED,
    note: `${label}: ${manifest.card} capture from ${manifest.device.serial}`
      + ` (${manifest.device.getState}) at ${recordedCommit.sha.slice(0, 7)}, verified exit 0`
      + ` — ${verifierVerdict}`,
    problems: [],
  };
}

function resolveEvidenceCommit(repoRoot, recorded) {
  const resolved = git(repoRoot, ["rev-parse", "--verify", "--quiet", `${recorded}^{commit}`]);
  if (resolved.status !== 0) {
    return {
      problem: `the manifest records commit ${describeValue(recorded)}, which this repository`
        + " does not have — commit the capture in the history it backs",
    };
  }
  return { sha: resolved.stdout.trim() };
}

/** `docs/evidence/native/<id>/manifest.json` → `<id>`, in diff order. */
function evidenceDirsInDiff(paths) {
  const dirs = [];
  for (const file of paths) {
    const parts = file.split("/");
    if (parts.length < 3) continue;
    if (parts[0] !== "docs" || parts[1] !== "evidence" || parts[2] !== "native") continue;
    // Only the record files count: a stray edit inside an old evidence
    // directory must not re-open evidence for a new change.
    const record = parts.slice(4).join("/");
    if (record !== CAPTURE_MANIFEST && record !== DECISION_RECORD) continue;
    const name = parts[3];
    if (name === undefined) continue;
    if (!dirs.includes(name)) dirs.push(name);
  }
  return dirs;
}

function print(sections) {
  process.stdout.write(`${sections.filter(Boolean).join("\n")}\n`);
}

function report(outcome) {
  const { repoRoot, range, changed, nativeChanges, dirs, verdicts, verdict, detail } = outcome;

  const head = [
    "native evidence requirement",
    `  repo:     ${repoRoot}`,
    `  range:    ${range.label}  (${range.source})`,
    `  changed:  ${changed.length} path(s)`,
    `  native:   ${nativeChanges.length} native-facing path(s)`,
  ];
  if (nativeChanges.length > 0) {
    head.push(...nativeChanges.map(change => `    - ${change.path}  (${change.why})`));
  }
  head.push(
    `  evidence: ${dirs.length} record(s) committed in this range`
      + (dirs.length > 0 ? `: ${dirs.map(dir => `${EVIDENCE_ROOT}/${dir}`).join(", ")}` : ""),
  );
  if (dirs.length > 0) {
    head.push(...verdicts.map(entry => `    - ${entry.note}`));
    for (const entry of verdicts) {
      for (const problem of entry.problems) head.push(`      problem: ${problem}`);
    }
  }

  print([head.join("\n"), detail, `verdict: ${verdict}`]);
}

async function main(argv) {
  const options = parseArguments(argv);

  if (options.help) {
    print([USAGE]);
    return EXIT_SATISFIED;
  }
  if (options.printPaths) {
    process.stdout.write(`${JSON.stringify(NATIVE_FACING_PATHS, null, 2)}\n`);
    return EXIT_SATISFIED;
  }

  const start = options.repo === undefined ? process.cwd() : path.resolve(options.repo);
  const repoRoot = findRepoRoot(start);
  const range = resolveRange(repoRoot, options);
  const changed = changedPaths(repoRoot, range.from, range.to);
  const nativeChanges = nativeFacingChanges(repoRoot, range.from, range.to, changed);

  if (nativeChanges.length === 0) {
    report({
      repoRoot,
      range,
      changed,
      nativeChanges,
      dirs: [],
      verdicts: [],
      verdict: `nothing to require — no native-facing path changed across ${changed.length}`
        + " path(s), so no native evidence is required for this range.",
    });
    return EXIT_SATISFIED;
  }

  const dirs = evidenceDirsInDiff(changed);
  const verdicts = dirs.map(dir =>
    judgeEvidenceDir(repoRoot, range.from, range.to, nativeChanges, dir));

  const satisfied = verdicts.filter(entry => entry.satisfied);
  if (satisfied.length > 0) {
    report({
      repoRoot,
      range,
      changed,
      nativeChanges,
      dirs,
      verdicts,
      verdict: `satisfied — ${satisfied.length} committed record(s) cover this change:`
        + ` ${satisfied.map(entry => entry.note).join("; ")} — ${nativeChanges.length}`
        + " native-facing path(s) required it. The device run itself remains manual.",
    });
    return EXIT_SATISFIED;
  }

  const detail = [
    "looked for, committed by this change:",
    `  ${EVIDENCE_ROOT}/<date-or-id>/${CAPTURE_MANIFEST} + the capture it names`
      + " (verified here by scripts/verify-native-parity.mjs, must exit 0)",
    `  ${EVIDENCE_ROOT}/<date-or-id>/${DECISION_RECORD}`
      + " (an explicit recorded decision that no device run is needed)",
  ].join("\n");

  const unsatisfied = verdicts.length > 0;
  const exit = verdicts.some(entry => entry.exit === EXIT_COULD_NOT_EVALUATE)
    ? EXIT_COULD_NOT_EVALUATE
    : EXIT_MISSING;

  report({
    repoRoot,
    range,
    changed,
    nativeChanges,
    dirs,
    verdicts,
    detail,
    verdict: (unsatisfied
      ? `missing evidence — ${nativeChanges.length} native-facing path(s) changed and the`
        + " committed record does not satisfy the requirement; nothing was verified as a pass."
      : `missing evidence — ${nativeChanges.length} native-facing path(s) changed and no`
        + ` capture or decision was committed with them (${EVIDENCE_ROOT}/ is untouched by`
        + " this change). Nothing was verified as a pass."),
  });
  return exit;
}

const invokedDirectly = process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === SCRIPT_PATH;

if (invokedDirectly) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof CannotEvaluate) {
      process.stderr.write(`error: ${error.message}\n`);
      process.stdout.write("verdict: could not evaluate — nothing was verified; this is not a pass.\n");
      process.exitCode = EXIT_COULD_NOT_EVALUATE;
    } else {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      process.stderr.write(`error: unexpected failure requiring native evidence: ${message}\n`);
      process.exitCode = EXIT_COULD_NOT_EVALUATE;
    }
  }
}
