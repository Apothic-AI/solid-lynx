#!/usr/bin/env node
/**
 * Require native evidence for a change that touches native-facing behaviour.
 *
 * Two verifiers turn a captured native log into an exit code. The smoke card
 * logs one `[solid-lynx parity]` report and is checked by
 * `scripts/verify-native-parity.mjs`; the stylesheet and list cards log one
 * stage line each and are checked by `scripts/verify-native-probe.mjs`. Both
 * answer the same question — is this capture clean? — with the same three exit
 * codes, so the evidence requirement below treats them the same way and picks
 * between them by the manifest's `card`.
 *
 * `docs/parity-checklist.md` says how to record a run. That and the verifier
 * were both convention: the verifier is a command someone has to remember to run
 * on a capture someone has to keep, so a pull request that changed native
 * behaviour and ticked nothing merged and no check went red. This script is the
 * check that closes that hole. It answers one question about a git diff:
 *
 *   does this change touch native-facing behaviour, and if so, is there a
 *   stored evidence artifact committed with it that satisfies the requirement?
 *
 * The requirement has three forms, all of which have to be *committed by the
 * change itself*. Two of them are passes and one is deliberately not:
 *
 *   1. `docs/evidence/native/<id>/manifest.json` plus the capture it names.
 *      This script runs the verifier for the manifest's card against the stored
 *      bytes and requires exit 0, cross-checking the manifest's recorded exit
 *      code and verdict line against the live run. The manifest's `commit` must
 *      fall inside the evaluated range, so a capture taken before the change
 *      cannot be reused for it.
 *   2. `docs/evidence/native/<id>/decision.json`: an explicit recorded
 *      decision that this native-facing change needs no device run, with a
 *      reason, an author, a timestamp, and the paths it covers.
 *   3. `docs/evidence/native/<id>/pending.json`: the run is specified and
 *      scheduled but has not happened, with the card it will run, the reason it
 *      has not, the blocker named as a physical or external dependency, the
 *      native-facing paths it stands in for, an author, a timestamp, and the
 *      commit. This does NOT satisfy the requirement in the sense of a pass: it
 *      is the release saying out loud that its native behaviour is unverified,
 *      and it exits 3 (`pending, not a pass`) rather than 0. That code exists so
 *      the one honest case — an unmet, scheduled requirement — cannot be
 *      confused with either a pass (0) or a dodge (1). See EXIT_PENDING.
 *
 * A native-facing change with none of the three is exit 1. `.github/workflows/ci.yml`
 * runs this over the pull-request range as the `native-evidence` job.
 *
 * Why a pending record is exit 3 and not 0: the alternative is to make the two
 * honest outcomes the checker could express be "a capture verifies" and "an
 * explicit decision that no run is needed". A release whose probes are built,
 * unit-tested, and waiting on a device that is not attached fits neither, so it
 * must either write a decision.json asserting that no run is needed — which is
 * false, and is the lie this whole directory exists to prevent — or fail its own
 * gate as though it had dodged the requirement. A distinct code keeps those
 * apart: 3 says the record is complete and the requirement is unmet, 1 says the
 * record is absent or wrong. CI surfaces 3 as a warning annotation rather than a
 * failure, so a red `native-evidence` job always means missing evidence.
 *
 * What this cannot do, and does not claim: no device runs here. The manifest's
 * `device.getState` is a record written by whoever ran the capture, not a
 * measurement made by this process. What is machine-checked is that the capture
 * the manifest names parses and covers what its card is supposed to emit — every
 * operation in `parityOperationIds` for a smoke capture, every required stage in
 * order for a probe capture — and passes — plus that the paperwork around it is
 * complete and committed here. Whether a human actually held the A03 is a
 * reviewer's question.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Exit codes, the same discipline the verifier and dagr use, plus one this
 * script needs and they do not.
 *
 *   0  satisfied      a capture verified, a decision covers the change, or
 *                     nothing native-facing changed
 *   1  missing        the requirement is unmet and nothing says so
 *   2  could not evaluate — the range, git, or a stored byte stream could not be
 *                     read; never a pass
 *   3  pending        the requirement is unmet *and the change says so*: every
 *                     native-facing path is covered by a `pending.json`, which
 *                     names the card that will run, why it has not, and the
 *                     physical blocker. This is NOT a pass and must never be
 *                     treated as one — a CI job that swallowed 3 would be
 *                     reporting unverified native behaviour as green. It is not
 *                     1 either: 1 means someone did not do the paperwork, and
 *                     this means someone did and is blocked on hardware.
 *
 * 3 is distinct because the two honest outcomes the contract could previously
 * express were "a capture verifies" and "an explicit decision that no run is
 * needed". A release with built, unit-tested probes waiting on an unattached
 * device fits neither; folding it into 1 makes a scheduled requirement
 * indistinguishable from a dodge, and folding it into 0 makes "unverified" look
 * like a green tick. `.github/workflows/ci.yml` turns 3 into a workflow warning
 * annotation (visible on the run and the PR, and not a failure); 1 and 2 stay
 * job failures.
 */
const EXIT_SATISFIED = 0;
const EXIT_MISSING = 1;
const EXIT_COULD_NOT_EVALUATE = 2;
const EXIT_PENDING = 3;

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const PARITY_VERIFIER_PATH = path.join(SCRIPT_DIR, "verify-native-parity.mjs");
const PROBE_VERIFIER_PATH = path.join(SCRIPT_DIR, "verify-native-probe.mjs");
const NODE_LABEL = path.posix.join("scripts", "require-native-evidence.mjs");

const PARITY_VERIFIER_LABEL = path.posix.join("scripts", "verify-native-parity.mjs");
const PROBE_VERIFIER_LABEL = path.posix.join("scripts", "verify-native-probe.mjs");

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
/**
 * The third form: a scheduled run that has not happened. Not a pass — see
 * EXIT_PENDING — but a complete, checkable statement of what is missing.
 */
export const PENDING_RECORD = "pending.json";
/** The record filenames a directory may carry, exactly one of. */
export const RECORD_FILES = Object.freeze([CAPTURE_MANIFEST, DECISION_RECORD, PENDING_RECORD]);

/** Cards `examples/lynx-for-native/scripts/run-native-probe.sh` accepts. */
export const NATIVE_CARDS = Object.freeze(["smoke", "stylesheet", "list"]);

/**
 * Which verifier reads which card's capture.
 *
 * The card decides, not the file contents: a manifest that says `smoke` is
 * checked against the parity checklist even if the bytes beside it carry probe
 * stages, and that mismatch comes back as exit 2 from the parity verifier ("this
 * capture has no parity line") rather than as a silent pass through whichever
 * verifier happened to understand the bytes. Naming the verifier per card also
 * keeps the two capture formats from being interchangeable, which is what would
 * let a probe capture back a smoke claim.
 */
export const CARD_VERIFIERS = Object.freeze({
  smoke: Object.freeze({ label: PARITY_VERIFIER_LABEL, path: PARITY_VERIFIER_PATH }),
  stylesheet: Object.freeze({ label: PROBE_VERIFIER_LABEL, path: PROBE_VERIFIER_PATH }),
  list: Object.freeze({ label: PROBE_VERIFIER_LABEL, path: PROBE_VERIFIER_PATH }),
});

/**
 * The native-facing surface, as an explicit, testable list.
 *
 * Every entry below was established by reading the code, not assumed:
 *
 *   - The native bundle's own entries are `examples/lynx-for-native/lynx.config.ts`
 *     → `src/main-thread.tsx`, `src/stylesheet-probe.ts`, `src/list-probe.ts`.
 *     Each imports `@apothic-ai/solid-lynx` (→ `src/index.ts`) and the smoke card
 *     also imports `@apothic-ai/solid-lynx/parity` (→ `src/parity.ts`).
 *   - `pluginSolidLynx` sets `moduleName: "@apothic-ai/solid-lynx"` with
 *     `generate: "universal"`, so the Solid JSX transform emits calls into
 *     `@apothic-ai/solid-lynx/jsx-runtime` (→ `src/jsx-runtime.ts`, and
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
    why: "only when the change edits a native job body, or removes/renames one",
  },
]);

/**
 * Pre-existing jobs in `.github/workflows/ci.yml` whose *edited* bodies count as
 * a native change.
 *
 * "Edited" is the load-bearing word. A change is attributed to one of these jobs
 * only when it touches a significant line — not blank, not a comment — inside
 * that job's own block as it existed *before* the change, or when it edits such
 * a line. Appending a new job after `native-build`, adding a comment above it,
 * or reformatting whitespace is deliberately not a native change: see
 * `touchesNativeJob` for why, and for the escape hatch that keeps the gate
 * honest when the workflow's structure changes.
 */
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
       The script runs the verifier for the manifest's \`card\` against that
       capture and requires exit 0, and checks the manifest's recorded exit code
       and verdict line agree with the live run. The manifest's \`commit\` must
       be inside the evaluated range, so an older capture cannot be re-used for
       a new change.

         card \`smoke\`       ${PARITY_VERIFIER_LABEL}
         card \`stylesheet\`  ${PROBE_VERIFIER_LABEL}
         card \`list\`        ${PROBE_VERIFIER_LABEL}

       A probe capture is verified for the stages its card emits, in order, and
       for the answers those stages exist to give: the stylesheet card's mutating
       stage must have reached a real stylesheet while its missing-URL stage
       failed, and the list card must record whether \`enqueueComponent\` was ever
       called, including a recorded zero. Neither verifier infers a signature
       from \`fn.length\`.
    2. ${EVIDENCE_ROOT}/<date-or-id>/${DECISION_RECORD}: an explicit recorded decision
       that this change needs no device run — a reason, an author, a timestamp,
       and the native-facing paths it covers.
    3. ${EVIDENCE_ROOT}/<date-or-id>/${PENDING_RECORD}: the run is specified and scheduled
       but has not happened — \`card\` (which of the three cards will measure it),
       \`reason\` (why not, at least 40 characters), \`blocked_by\` (the physical or
       external dependency, named — not "n/a"), \`paths\` (every native-facing path
       it stands in for), \`author\`, \`timestamp\`, \`commit\`. This does NOT make
       the range a pass: it exits 3. It is the third form because a release can
       honestly be blocked on a device, and the alternative was to write a
       decision saying no run is needed, which would be false.

  A directory holds exactly one of the three.

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
                        outside this range, a decision with no reason, or a
                        pending record that does not cover every native-facing
                        path. This is a dodge: the requirement is unmet and
                        nothing says so
  2  could not evaluate git failed, the range would not resolve, or a stored
                        capture could not be verified at all (a 2 from the
                        verifier: a missing \`dist/\` for a smoke capture, or a
                        probe capture with no stage line — run \`pnpm build\`).
                        Never a pass
  3  pending, not a pass
                        every native-facing path in the range is covered by a
                        committed ${PENDING_RECORD}, which names the card that will
                        run, why it has not, and the physical blocker. The
                        record set is complete and honest; the requirement is
                        unmet. NOT 0: "this release's native behaviour is
                        unverified" must not look like a green tick. NOT 1: a
                        scheduled requirement is not a dodge. The output prints
                        an unmissable warning block naming the paths, the card,
                        and the blocker. CI surfaces this as a warning
                        annotation, and a red \`native-evidence\` job therefore
                        still means missing evidence rather than pending
                        evidence

  These follow the same discipline as dagr (0 clean, 1 read and insufficient, 2
  could not be read), with one code dagr has no use for: 3, a result that was
  read, is complete, and still is not a pass. A 2 must never be cited as a pass,
  and neither must a 3.

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
/**
 * The `jobs:` block, as per-job line spans plus a classification of every line.
 *
 * Line kinds, in the order they are checked:
 *   blank    empty or whitespace only
 *   comment  the first non-space character is `#`, at any indent
 *   key      a job name at the jobs indentation (`  name:`, optionally with a
 *            trailing comment and nothing else) — the block's own header
 *   body     anything else indented deeper than the job header, i.e. the job's
 *            own content: `runs-on:`, `steps:`, `run:` and so on
 *
 * `--` and `+` are absent on purpose: this reads a revision's file, not a diff.
 */
function scanJobs(text) {
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

  const kinds = new Map(); // 1-based line -> "blank" | "comment" | "key" | "body" | "outside"
  const keys = [];
  for (let index = jobsAt + 1; index <= lines.length; index += 1) {
    const line = lines[index - 1] ?? "";
    const number = index;
    if (index > sectionEnd) { kinds.set(number, "outside"); continue; }
    const key = /^ {2}([A-Za-z0-9_.-]+):\s*(#.*)?$/.exec(line);
    if (key) {
      keys.push({ name: key[1], line: number });
      kinds.set(number, "key");
    } else if (line.trim() === "") {
      kinds.set(number, "blank");
    } else if (/^\s*#/.test(line)) {
      kinds.set(number, "comment");
    } else {
      kinds.set(number, "body");
    }
  }

  const blocks = new Map();
  keys.forEach((entry, index) => {
    const end = index + 1 < keys.length ? keys[index + 1].line - 1 : sectionEnd;
    blocks.set(entry.name, { start: entry.line, end });
  });
  return { blocks, kinds, keys, lines };
}

/** Line numbers of `spans`, flattened. */
function linesOf(spans) {
  const numbers = [];
  for (const [start, end] of spans) {
    for (let line = start; line <= end; line += 1) numbers.push(line);
  }
  return numbers;
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

/** The workflow file at one revision, or `undefined` when it did not exist. */
function workflowAt(repoRoot, revision) {
  const result = git(repoRoot, ["show", `${revision}:${CI_WORKFLOW}`]);
  return result.status === 0 ? result.stdout : undefined;
}

/**
 * Whether a `ci.yml` change edits a job that runs native work.
 *
 * Structural, not contextual. The previous version attributed a line to the job
 * whose line span contained it, and a job's span ran from its key to the line
 * before the next job's key — so every blank line and comment leading into the
 * next job belonged to the job above. Appending a new job after `native-build`
 * therefore read as an edit *inside* `native-build`, and the guard fired on the
 * very commit that installed it. Hunk context (`@@ ... @@ jobs:`) cannot tell the
 * two apart either; it names the enclosing section, not the job.
 *
 * The rule now:
 *
 *   - A line inside a native job counts only if it is significant: a `body` line
 *     (`run:`, `uses:`, `steps:` …) or the job's own key line. Blank lines and
 *     comments never do.
 *   - A *newly created* job is not an edit to an existing one. Appending
 *     `native-evidence` after `native-build` adds lines that are, on the new
 *     side, inside `native-build`'s block boundary — but `native-build` is
 *     unchanged, so nothing about native build behaviour moved.
 *   - If the workflow's job structure changes in a way that could hide an edit
 *     (a native job renamed or deleted, the `jobs:` block unreadable), that is
 *     reported as native-facing, because a gate that silently stops recognising
 *     its own jobs is how a check quietly stops covering anything. That is the
 *     only direction this leans, and it is stated in the output when it fires.
 *   - Everything else — a comment, a blank line, a reformat, an edit to another
 *     job, a new job appended at the end — is not native-facing on this
 *     evidence, and the output says which of those it was rather than failing.
 */
function touchesNativeJob(repoRoot, from, to) {
  const { removed, added } = changedLineSpans(repoRoot, from, to, CI_WORKFLOW);
  if (removed.length === 0 && added.length === 0) {
    return { native: false, why: "the change has no line-level workflow hunks" };
  }

  const beforeText = workflowAt(repoRoot, from);
  const afterText = workflowAt(repoRoot, to);
  const before = beforeText === undefined ? null : scanJobs(beforeText);
  const after = afterText === undefined ? null : scanJobs(afterText);

  if ((beforeText !== undefined && before === null) || (afterText !== undefined && after === null)) {
    return {
      native: true,
      why: "the workflow's `jobs:` block cannot be read on one side of this change,"
        + " so no job can be shown to be untouched — treating it as native-facing"
        + " rather than assuming the native jobs are unaffected",
    };
  }

  const beforeJoins = inferJoins(before);
  const afterJoins = inferJoins(after);

  // A native job that disappeared, or gained/lost joins, cannot be reasoned
  // about from line numbers: the edit may be exactly what removed it.
  const nativeNow = NATIVE_CI_JOBS.filter(name => after !== null && after.blocks.has(name));
  const namesGone = NATIVE_CI_JOBS.filter(name => before !== null
    && before.blocks.has(name)
    && (after === null || !after.blocks.has(name)));
  if (namesGone.length > 0) {
    return {
      native: true,
      why: `the \`${namesGone.join("`, `")}\` job(s) are removed or renamed by this`
        + " change, which is itself a change to native CI",
    };
  }
  for (const name of nativeNow) {
    const was = beforeJoins.get(name) ?? [];
    const now = afterJoins.get(name) ?? [];
    if (was.length > 0 && now.length > 0 && was.join(",") !== now.join(",")) {
      return {
        native: true,
        why: `the \`${name}\` job's \`needs:\` changed from [${was.join(", ")}]`
          + ` to [${now.join(", ")}], which changes when native work runs`,
      };
    }
  }
  const nativeBefore = before === null ? [] : NATIVE_CI_JOBS.filter(name => before.blocks.has(name));
  const loopHeads = nativeNow.filter(name => (afterJoins.get(name) ?? []).length === 0);
  const loopWas = nativeBefore.filter(name => (beforeJoins.get(name) ?? []).length === 0);
  if (loopHeads.length > 0 && loopWas.length === 0 && nativeBefore.length > 0) {
    return {
      native: true,
      why: `\`${loopHeads.join("`, `")}\` has no \`needs:\`, but before this change`
        + " every native job was gated — a job that no longer waits on `unit` can"
        + " run before the gate it is supposed to follow",
    };
  }

  // Which native job blocks actually changed, structurally.
  const changedNative = [];
  const untouchedNative = [];
  for (const name of nativeBefore) {
    const nameBefore = { ...before.blocks.get(name) };
    const nameAfter = after === null ? undefined : after.blocks.get(name);
    if (nameAfter === undefined) continue; // handled above
    const significant = lineNumbers => lineNumbers.filter(number => {
      const kind = before.kinds.get(number);
      return kind === "body" || kind === "key";
    });
    const removedSignificant = significant(linesOf(removed));
    const addedSignificant = significant(linesOf(added));
    const hitRemoved = removedSignificant.some(number =>
      number >= nameBefore.start && number <= nameBefore.end);
    const hitAdded = addedSignificant.some(number =>
      number >= nameAfter.start && number <= nameAfter.end);
    if (hitRemoved || hitAdded) {
      changedNative.push(name);
    } else {
      untouchedNative.push(name);
    }
  }

  if (changedNative.length > 0) {
    return {
      native: true,
      why: `significant line(s) changed inside the \`${changedNative.join("`, `")}\``
        + " job body (a `run:`, `uses:`, or other job content, not a comment or a"
        + " blank line)",
    };
  }

  // Nothing native moved. Say which non-native shape this was.
  const createdJobs = after === null ? [] :
    [...after.blocks.keys()].filter(name => before === null || !before.blocks.has(name));
  const significantAdded = linesOf(added).filter(number => {
    const kind = after === null ? undefined : after.kinds.get(number);
    return kind === "body" || kind === "key";
  });
  const significantRemoved = linesOf(removed).filter(number => {
    const kind = before === null ? undefined : before.kinds.get(number);
    return kind === "body" || kind === "key";
  });

  if (createdJobs.length > 0 && significantAdded.length === 0) {
    return {
      native: false,
      why: `a new job (\`${createdJobs.join("`, `")}\`) was appended with only its`
        + " header and comment lines in this diff; the existing native job(s) are"
        + " unchanged",
    };
  }
  if (createdJobs.length > 0) {
    return {
      native: false,
      why: `new job(s) \`${createdJobs.join("`, `")}\` were added; the existing`
        + ` native job(s) (${untouchedNative.length > 0 ? `\`${untouchedNative.join("`, `")}\`` : "none present"})`
        + " are unchanged, and a new job is not an edit to one",
    };
  }
  if (significantAdded.length === 0 && significantRemoved.length === 0) {
    return {
      native: false,
      why: "only comment, blank, or whitespace lines changed in the workflow",
    };
  }
  return {
    native: false,
    why: "the changed job content is in jobs other than `"
      + `${NATIVE_CI_JOBS.join("` or `")}; the native job bodies are unchanged`,
  };
}

/**
 * `needs:` per job, as a joined string list, so a change in what a native job
 * waits on can be told from a change to what it runs.
 *
 * Text-level scanning, not YAML: no YAML parser is reachable from this script
 * without adding a dependency, and a workflow's `needs:` is simple enough to
 * read this way — a `needs:` line in a job's step block is not valid workflow
 * syntax, so there is no ambiguity to resolve.
 */
function inferJoins(scanned) {
  const joins = new Map();
  if (scanned === null) return joins;
  for (const [name, block] of scanned.blocks) {
    const body = scanned.lines.slice(block.start - 1, block.end);
    const found = [];
    for (const line of body) {
      const inline = /^ {4}needs:\s*(\S.*)$/.exec(line);
      if (inline) {
        const value = inline[1].replace(/#.*$/, "").trim();
        if (value.startsWith("[")) {
          found.push(...value.replace(/^\[|\]$/g, "").split(",")
            .map(entry => entry.trim().replace(/^["']|["']$/g, ""))
            .filter(Boolean));
        } else if (value !== "") {
          found.push(value.replace(/^["']|["']$/g, ""));
        }
        continue;
      }
      if (/^ {4}needs:\s*(#.*)?$/.test(line)) {
        const at = body.indexOf(line);
        for (const following of body.slice(at + 1)) {
          const item = /^ {6}-\s*(\S+)\s*$/.exec(following);
          if (!item) break;
          found.push(item[1].replace(/^["']|["']$/g, ""));
        }
      }
    }
    joins.set(name, found);
  }
  return joins;
}

/** Every native-facing path in the diff, with the reason it counts. */
function nativeFacingChanges(repoRoot, from, to, paths, notes = []) {
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
      if (verdict.native) {
        found.push({ path: file, why: verdict.why });
      } else {
        // Say why a workflow edit was judged not native-facing. A check that
        // silently ignores a file it knows about is indistinguishable from one
        // that never looked at it.
        notes.push(`${file}  (not native-facing: ${verdict.why})`);
      }
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

/**
 * The pending record: a scheduled run that has not happened.
 *
 * Structurally this is a `decision.json` with the verb reversed — a decision says
 * "this change needs no run", a pending record says "this change needs a run and
 * the run is blocked". The two fields that carry the difference are `card` (which
 * of the three cards will measure it) and `blocked_by` (the physical or external
 * thing that is missing). `reason` is the same 40-character bar as a decision's,
 * because "why has this not run yet" deserves the same weight as "why is no run
 * needed".
 *
 * `paths` is checked against the change the same way a decision's is, and for
 * the same reason: a pending record that names one path out of three silently
 * stands in for the other two, and "we are honest that this is unverified" stops
 * being true the moment the honesty covers less than the change.
 *
 * The blocker rule is deliberately mechanical and deliberately blunt. A free-text
 * `blocked_by` that says "hardware" or "n/a" names nothing a reader can act on,
 * so it has to be long enough to name something (12 characters) and it must not
 * be one of the shrugs this check has actually seen. It cannot confirm the
 * device is absent — nothing here can — but it can refuse to file a shrug.
 */
const BLOCKED_BY_MIN_LENGTH = 12;
const BLOCKED_BY_SHRUGS = Object.freeze([
  "none", "n/a", "na", "nothing", "tbd", "todo", "unknown", "hardware",
  "no device", "blocked", "pending", "later", "soon",
]);

function isShrug(value) {
  const normalized = value.trim().toLowerCase().replace(/[.!,;]+$/g, "");
  return BLOCKED_BY_SHRUGS.includes(normalized);
}

function validatePendingRecord(record, label) {
  const problems = [];
  const add = message => problems.push(message);

  if (!isPlainObject(record)) {
    return [`${label} is not a JSON object`];
  }
  if (record.kind !== "pending") {
    add(`${label}: "kind" must be "pending", got ${describeValue(record.kind)}`);
  }
  if (!NATIVE_CARDS.includes(record.card)) {
    add(`${label}: "card" must be one of ${NATIVE_CARDS.join(", ")} (the card that will`
      + ` measure this), got ${describeValue(record.card)}`);
  }
  // The same bar a decision's reason has to clear: a reviewer has to be able to
  // weigh it, and "blocked" is not a reason.
  if (!isText(record.reason) || record.reason.trim().length < 40) {
    add(`${label}: "reason" must be at least 40 characters explaining why no run has`
      + ` happened, got ${describeValue(record.reason)}`);
  }
  if (!isText(record.blocked_by)) {
    add(`${label}: "blocked_by" must name the physical or external dependency, got`
      + ` ${describeValue(record.blocked_by)}`);
  } else if (isShrug(record.blocked_by)) {
    // Checked before the length rule on purpose: every shrug in the list is short,
    // so a length-first order would bury the specific complaint ("that word names
    // nothing") under a generic one ("that is too short").
    add(`${label}: "blocked_by" must name what is actually missing, not`
      + ` ${describeValue(record.blocked_by)} — say what the run needs (for example`
      + ` "A03 not attached over adb; ub_y33g9p")`);
  } else if (record.blocked_by.trim().length < BLOCKED_BY_MIN_LENGTH) {
    add(`${label}: "blocked_by" must name the dependency in at least`
      + ` ${BLOCKED_BY_MIN_LENGTH} characters (a serial, a bus, a person, a queue), got`
      + ` ${describeValue(record.blocked_by)}`);
  }
  if (!Array.isArray(record.paths) || record.paths.length === 0
    || record.paths.some(entry => !isText(entry))) {
    add(`${label}: "paths" must be a non-empty array of the native-facing paths this`
      + ` pending record covers, got ${describeValue(record.paths)}`);
  }
  if (!isText(record.author)) {
    add(`${label}: "author" must name who recorded the pending state, got`
      + ` ${describeValue(record.author)}`);
  }
  if (!isTimestamp(record.timestamp)) {
    add(`${label}: "timestamp" must be an ISO 8601 timestamp, got`
      + ` ${describeValue(record.timestamp)}`);
  }
  if (!isText(record.commit) || !/^[0-9a-f]{7,40}$/.test(record.commit)) {
    add(`${label}: "commit" must be a git commit sha inside the range this record`
      + ` speaks for, got ${describeValue(record.commit)}`);
  }

  return problems;
}

/**
 * `pending.json` as a list of records.
 *
 * One file, one card most of the time, so a single object is the common shape.
 * A release that ships three cards and is blocked on one device has three
 * findings to record, and putting them in three directories would be three names
 * for one date; an array is accepted for exactly that case. Both shapes are
 * validated record by record, and an empty array is rejected rather than read as
 * "nothing is pending", which would be a pass in disguise.
 */
function pendingRecordsIn(value) {
  if (Array.isArray(value)) return value;
  return [value];
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
 * One evidence directory, judged. Returns `{ satisfied, exit, note, problems }`
 * plus the three fields the collective pass needs:
 *
 *   `kind`      which of the three forms this directory holds (`capture`,
 *               `decision`, `pending`, plus the non-forms `template`, `none`,
 *               `invalid`), so the report can say what it found rather than only
 *               what it did not find
 *   `covers`     the native-facing paths this record accounts for. Only a valid
 *               `decision.json` or `pending.json` contributes any; a capture
 *               contributes none, because a capture is a pass or a failure and
 *               is never a partial statement about paths
 *   `blocking`  whether this result forbids a `pending` verdict for the range.
 *               A dodge, a failed capture, a malformed record, and a directory
 *               carrying two records all block it: "pending" is meant to mean
 *               the record set is complete and honest, so a broken record beside
 *               a pending one is exit 1, not exit 3. A directory with no record
 *               (`template`, `none`) does not block, because it can never
 *               satisfy anything and its absence of coverage is already what the
 *               union check measures
 *   `pending`   the pending records' own details, for the warning block
 *
 * `exit` is the exit code this directory implies if nothing else satisfies the
 * requirement, so a missing `dist/` cannot be reported as missing evidence.
 */
function judgeEvidenceDir(repoRoot, from, to, nativeChanges, dirName) {
  const dir = path.join(repoRoot, EVIDENCE_ROOT, dirName);
  const manifestPath = path.join(dir, CAPTURE_MANIFEST);
  const decisionPath = path.join(dir, DECISION_RECORD);
  const pendingPath = path.join(dir, PENDING_RECORD);
  // Which record files are actually present, in the contract's own order. The
  // rest of the function reads this rather than three separate "has" booleans,
  // so "exactly one" and "this one" cannot drift apart.
  const present = RECORD_FILES.filter(name => existsSync(path.join(dir, name)));
  const label = `${EVIDENCE_ROOT}/${dirName}`;

  const insufficient = (note, problems = [], extra = {}) => ({
    satisfied: false,
    exit: EXIT_MISSING,
    kind: "invalid",
    blocking: true,
    covers: [],
    note,
    problems,
    ...extra,
  });

  if (dirName === TEMPLATE_DIR_NAME) {
    return {
      satisfied: false,
      exit: EXIT_MISSING,
      kind: "template",
      blocking: false,
      covers: [],
      note: `${label} is the template, not evidence: copy it to a new directory and`
        + " fill it in with a real run (see the README beside it)",
      problems: [],
    };
  }
  if (present.length === 0) {
    return {
      satisfied: false,
      exit: EXIT_MISSING,
      kind: "none",
      blocking: false,
      covers: [],
      note: `${label} has none of ${RECORD_FILES.join(", ")}`,
      problems: [],
    };
  }
  // One directory, one answer. A release that is both "measured" and "waiting to
  // measure" the same change has not made up its mind, and "was this measured?"
  // must have exactly one answer.
  if (present.length > 1) {
    return insufficient(
      `${label} carries ${present.join(" and ")}; an entry is exactly one of`
        + ` ${RECORD_FILES.join(", ")}, not several — a release cannot be both measured`
        + " and awaiting measurement for the same change",
    );
  }

  if (present.includes(PENDING_RECORD)) {
    const { value, problems: readProblems } = readJson(pendingPath);
    if (readProblems) return insufficient(label, readProblems);

    const records = pendingRecordsIn(value);
    if (records.length === 0) {
      return insufficient(
        `${label}/${PENDING_RECORD} is an empty list, which is a pass in disguise: a`
          + " pending record has to name what is pending",
      );
    }

    const problems = [];
    for (const [index, record] of records.entries()) {
      const recordLabel = records.length === 1
        ? `${label}/${PENDING_RECORD}`
        : `${label}/${PENDING_RECORD}[${index}]`;
      problems.push(...validatePendingRecord(record, recordLabel));
    }
    if (problems.length > 0) return insufficient(`${label}/${PENDING_RECORD}`, problems);

    // A pending record's `commit` has to be one this repository has, and it has
    // to sit inside the range it speaks for. Unlike a capture's, it is allowed to
    // be the change itself: the record states a fact about the tip, not a run
    // taken before it.
    for (const record of records) {
      const resolved = resolveEvidenceCommit(repoRoot, record.commit);
      if (resolved.problem !== undefined) {
        problems.push(`${label}/${PENDING_RECORD}: ${resolved.problem}`);
        continue;
      }
      if (git(repoRoot, ["merge-base", "--is-ancestor", resolved.sha, to]).status !== 0) {
        problems.push(
          `${label}/${PENDING_RECORD} records commit ${resolved.sha.slice(0, 7)}, which is not`
            + " in this range's history — a pending record speaks for the change it rides with",
        );
      }
    }
    if (problems.length > 0) return insufficient(`${label}/${PENDING_RECORD}`, problems);

    const nativePaths = new Set(nativeChanges.map(change => change.path));
    const named = records.flatMap(record => record.paths);
    const covered = named.filter(entry => nativePaths.has(entry));
    const ignored = named.filter(entry => !nativePaths.has(entry));
    const cards = [...new Set(records.map(record => record.card))];
    const blockers = [...new Set(records.map(record => record.blocked_by.trim()))];

    return {
      satisfied: false,
      exit: EXIT_PENDING,
      kind: "pending",
      blocking: false,
      // The record's own paths, not the intersection: the union pass decides
      // completeness, and it can only do that if it sees what the record claims
      // rather than what it happened to overlap.
      covers: [...new Set(named)],
      note: `${label}/${PENDING_RECORD}: pending, not a pass — ${records.length} record(s)`
        + ` for card(s) ${cards.join(", ")}, covering ${covered.length} of`
        + ` ${nativePaths.size} native-facing path(s), blocked by`
        + ` ${blockers.map(blocker => `"${blocker}"`).join("; ")}`
        + (ignored.length > 0
          ? `; ignores non-native ${ignored.map(entry => `\`${entry}\``).join(", ")}`
          : ""),
      problems: [],
      pending: records.map(record => ({
        dir: label,
        card: record.card,
        blocked_by: record.blocked_by,
        reason: record.reason,
        author: record.author,
        paths: record.paths.filter(entry => nativePaths.has(entry)),
      })),
    };
  }

  if (present.includes(DECISION_RECORD)) {
    const { value, problems: readProblems } = readJson(decisionPath);
    if (readProblems) return insufficient(label, readProblems);

    const problems = validateDecisionRecord(value, dir);
    if (problems.length > 0) return insufficient(`${label}/${DECISION_RECORD}`, problems);

    // A decision has to account for the change, not a file in it: naming one path
    // out of several is how a decision record becomes a rubber stamp on
    // everything else that rode along with it. Its uncovered paths are what the
    // union pass counts as missing, so `covers` is every path it names and the
    // incompleteness is judged once, against the whole record set.
    const nativePaths = new Set(nativeChanges.map(change => change.path));
    const covered = value.paths.filter(entry => nativePaths.has(entry));
    const unaccounted = [...nativePaths].filter(entry => !value.paths.includes(entry));
    const ignored = value.paths.filter(entry => !nativePaths.has(entry));
    const complete = covered.length > 0 && unaccounted.length === 0;
    return {
      satisfied: complete,
      exit: complete ? EXIT_SATISFIED : EXIT_MISSING,
      kind: "decision",
      blocking: false,
      covers: [...new Set(value.paths)],
      note: complete
        ? `${label}/${DECISION_RECORD}: decision recorded by ${value.author} —`
          + ` "${value.decision}" (covers ${covered.map(entry => `\`${entry}\``).join(", ")})`
          + (ignored.length > 0
            ? `; ignores non-native ${ignored.map(entry => `\`${entry}\``).join(", ")}`
            : "")
        : covered.length === 0
          ? `${label}/${DECISION_RECORD} covers none of the native-facing paths in this`
            + ` change (it names ${value.paths.map(entry => `\`${entry}\``).join(", ")})`
          : `${label}/${DECISION_RECORD} covers ${covered.length} of`
            + ` ${nativePaths.size} native-facing path(s) in this change`,
      problems: complete || covered.length === 0
        ? []
        : [`the decision does not name ${unaccounted.map(entry => `\`${entry}\``).join(", ")}`],
    };
  }

  // A capture manifest: the real check. Every problem is collected rather than
  // returned one at a time, so a manifest with a stale commit *and* a capture
  // the verifier rejects says both things in one run instead of sending the
  // author round the loop twice.
  const { value: manifest, problems: readProblems } = readJson(manifestPath);
  if (readProblems) return insufficient(label, readProblems);

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
  //
  // The card picks the verifier, so a probe capture and a smoke capture are never
  // interchangeable: a `smoke` manifest pointing at stage lines gets the parity
  // verifier's exit 2 ("no [solid-lynx parity] line"), and a `stylesheet` or
  // `list` manifest pointing at a parity report gets the probe verifier's exit 2
  // ("no [solid-lynx ss] or [solid-lynx lp] line"). Both are reported as
  // "could not evaluate", which is never a pass.
  let verifierVerdict = "";
  const verifier = CARD_VERIFIERS[manifest.card];
  if (capturePath !== undefined && verifier !== undefined
    && existsSync(capturePath) && statSync(capturePath).isFile()) {
    const run = spawnSync(process.execPath, [verifier.path, capturePath], {
      encoding: "utf8",
      cwd: SCRIPT_DIR,
    });
    if (run.error) {
      throw new CannotEvaluate(
        `could not run ${verifier.label}: ${run.error.message}`,
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
        `${verifier.label} could not evaluate ${manifest.capture} (exit 2), so the`
          + ` stored capture proves nothing: ${(run.stderr ?? "").trim() || "no detail"}`,
      );
    } else if (verifierExit !== 0) {
      // The verifier's own findings, so a reader does not have to re-run it to
      // learn which stage is missing. Only the indented finding lines are quoted;
      // the tables above them are re-derivable and would bloat the report.
      const quotes = (run.stdout ?? "")
        .split("\n")
        .filter(line => /^\s+- \[/.test(line))
        .slice(0, 6)
        .map(line => line.trim());
      problems.push(
        `${verifier.label} reads ${manifest.capture} as findings (exit ${verifierExit}),`
          + ` not a pass: ${verifierVerdict || "no verdict line"}`
          + (quotes.length > 0 ? ` — ${quotes.join(" ")}` : ""),
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
      kind: "capture",
      blocking: true,
      covers: [],
      note: `${label}/${CAPTURE_MANIFEST}`,
      problems: allProblems,
    };
  }

  return {
    satisfied: true,
    exit: EXIT_SATISFIED,
    kind: "capture",
    blocking: false,
    covers: [],
    note: `${label}: ${manifest.card} capture from ${manifest.device.serial}`
      + ` (${manifest.device.getState}) at ${recordedCommit.sha.slice(0, 7)}, verified exit 0`
      + ` by ${verifier.label} — ${verifierVerdict}`,
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

/** `docs/evidence/native/<id>/<record>` → `<id>`, in diff order. */
function evidenceDirsInDiff(paths) {
  const dirs = [];
  for (const file of paths) {
    const parts = file.split("/");
    if (parts.length < 3) continue;
    if (parts[0] !== "docs" || parts[1] !== "evidence" || parts[2] !== "native") continue;
    // Only the record files count: a stray edit inside an old evidence
    // directory must not re-open evidence for a new change.
    const record = parts.slice(4).join("/");
    if (!RECORD_FILES.includes(record)) continue;
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
  const notes = outcome.notes ?? [];

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
  if (notes.length > 0) {
    head.push(...notes.map(note => `    - ${note}`));
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
  const notes = [];
  const nativeChanges = nativeFacingChanges(repoRoot, range.from, range.to, changed, notes);

  if (nativeChanges.length === 0) {
    report({
      repoRoot,
      range,
      changed,
      nativeChanges,
      notes,
      dirs: [],
      verdicts: [],
      verdict: `nothing to require — no native-facing path changed across ${changed.length}`
        + " path(s), so no native evidence is required for this range."
        + (notes.length > 0
          ? " (.github/workflows/ci.yml changed, but outside every native job body;"
            + " see the note above.)"
          : ""),
    });
    return EXIT_SATISFIED;
  }

  const dirs = evidenceDirsInDiff(changed);
  const verdicts = dirs.map(dir =>
    judgeEvidenceDir(repoRoot, range.from, range.to, nativeChanges, dir));

  const satisfied = verdicts.filter(entry => entry.satisfied);
  if (satisfied.length > 0) {
    // A capture wins over a pending record for the same range, and that order is
    // not arbitrary: a verified capture is a measurement, a pending record is the
    // absence of one, and the presence of the measurement is the better answer to
    // "was this measured?". A release that ran the card after writing its pending
    // record gets exit 0 from the capture without having to delete the record —
    // and the report names both, so the leftover is visible rather than silent.
    const alsoPending = verdicts.filter(entry => entry.kind === "pending");
    report({
      repoRoot,
      range,
      changed,
      nativeChanges,
      dirs,
      verdicts,
      verdict: `satisfied — ${satisfied.length} committed record(s) cover this change:`
        + ` ${satisfied.map(entry => entry.note).join("; ")} — ${nativeChanges.length}`
        + " native-facing path(s) required it. The device run itself remains manual."
        + (alsoPending.length > 0
          ? ` A pending record is also committed (${alsoPending.map(entry => entry.note).join("; ")})`
            + " and is superseded by the verified capture; it can be removed, but it is not"
            + " standing in for anything now."
          : ""),
    });
    return EXIT_SATISFIED;
  }

  // Nothing verified. Before calling that a dodge, ask the one question that
  // separates a dodge from a scheduled requirement: is every native-facing path
  // accounted for by a decision or a pending record? Coverage is a union across
  // the whole record set, not per directory, because a release may honestly split
  // its statement ("this file needs no run; this one is waiting on the tablet")
  // and each record on its own would look partial.
  const nativePathList = nativeChanges.map(change => change.path);
  const accounted = new Set();
  for (const entry of verdicts) {
    if (entry.kind !== "pending" && entry.kind !== "decision") continue;
    for (const covered of entry.covers ?? []) {
      if (nativePathList.includes(covered)) accounted.add(covered);
    }
  }
  const uncovered = nativePathList.filter(entry => !accounted.has(entry));
  const pendingEntries = verdicts.filter(entry => entry.kind === "pending");
  const pendingRecords = pendingEntries.flatMap(entry => entry.pending ?? []);
  const blocked = verdicts.filter(entry => entry.blocking);

  if (pendingRecords.length > 0 && blocked.length === 0 && uncovered.length === 0) {
    // Exit 3, not 0 and not 1. See EXIT_PENDING: this is the honest middle the
    // contract used to have no way to express, and it has to be loud, because a
    // reader who skims must not come away thinking something passed.
    const detail = pendingWarningBlock({
      normalized: nativeChanges.length,
      paths: nativePathList,
      records: pendingRecords,
    });
    report({
      repoRoot,
      range,
      changed,
      nativeChanges,
      dirs,
      verdicts,
      detail,
      verdict: "pending — every one of this change's"
        + ` ${nativeChanges.length} native-facing path(s) is covered by a recorded pending`
        + " run, and nothing was verified as a pass: no capture for this range exists, the"
        + ` card(s) ${[...new Set(pendingRecords.map(record => record.card))].join(", ")}`
        + " have not run, and the blocker is recorded below. Exit 3 is not a pass.",
    });
    return EXIT_PENDING;
  }

  const detail = [
    "looked for, committed by this change:",
    `  ${EVIDENCE_ROOT}/<date-or-id>/${CAPTURE_MANIFEST} + the capture it names`
      + ` (verified here by ${PARITY_VERIFIER_LABEL} for a \`smoke\` capture and`
      + ` ${PROBE_VERIFIER_LABEL} for a \`stylesheet\` or \`list\` one; must exit 0)`,
    `  ${EVIDENCE_ROOT}/<date-or-id>/${DECISION_RECORD}`
      + " (an explicit recorded decision that no device run is needed)",
    `  ${EVIDENCE_ROOT}/<date-or-id>/${PENDING_RECORD}`
      + " (a scheduled, blocked run — required for *every* native-facing path in the"
      + " change; it does not make the range a pass)",
    ...(uncovered.length > 0 && (pendingRecords.length > 0 || verdicts.some(e => e.kind === "decision"))
      ? [
        "",
        "the record set is incomplete — these native-facing path(s) are covered by no"
          + ` ${PENDING_RECORD} and no ${DECISION_RECORD}, so the change is not even honest`
          + " about being unverified:",
        ...uncovered.map(entry => `  - ${entry}`),
      ]
      : []),
    ...(pendingRecords.length > 0 && blocked.length > 0
      ? [
        "",
        "a pending record is committed, but the record set also contains something that"
          + " does not hold, so this is missing evidence rather than a scheduled run:",
        ...blocked.map(entry => `  - ${entry.note}`),
        ...blocked.flatMap(entry => entry.problems.map(problem => `      problem: ${problem}`)),
      ]
      : []),
  ].join("\n");

  const unsatisfied = verdicts.length > 0;
  // 2 outranks 3: "this byte stream could not be read" is a failure of the check
  // itself, and reporting it as "pending, not a pass" would bury it.
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
        + ` capture, decision, or pending record was committed with them (${EVIDENCE_ROOT}/`
        + " is untouched by this change). Nothing was verified as a pass."),
  });
  return exit;
}

/**
 * The block a pending verdict prints, and the reason it is this loud.
 *
 * Everything else this script emits is a summary a reader can skim. This one is
 * the opposite: a release can pass every other check while its native behaviour
 * is wholly unverified, and the only thing standing between that and a green
 * tick is that somebody reads this. So it names the count, the paths, the card
 * that will measure them, who recorded it and when, and the blocker in the
 * words the record used — and it says in as many words that 3 is not a pass.
 */
function pendingWarningBlock({ normalized, paths, records }) {
  const bar = "!".repeat(78);
  const lines = [
    bar,
    "!! NATIVE EVIDENCE PENDING — THIS IS NOT A PASS",
    "!!",
    "!! Nothing in this range was verified as a pass. The change below is",
    `!! ${String(normalized).padEnd(2)} native-facing path(s) covered only by a pending record: the run is`,
    "!! specified, reviewed and blocked, not done. Do not cite this as a native",
    "!! result, and do not read exit 3 as a green tick.",
    "!!",
  ];
  const cards = [...new Set(records.map(record => record.card))];
  lines.push(`!! Card(s) awaiting a run: ${cards.join(", ")}`);
  for (const blocker of [...new Set(records.map(record => record.blocked_by.trim()))]) {
    lines.push(`!! Blocker:               ${blocker}`);
  }
  for (const record of records) {
    lines.push(`!! Why:                   ${record.reason.trim()}`);
    lines.push(`!! Recorded by:           ${record.author} (${record.dir}/${PENDING_RECORD})`);
  }
  lines.push(`!! ${paths.length} pending native-facing path(s):`);
  for (const entry of paths) lines.push(`!!   - ${entry}`);
  lines.push(
    "!!",
    "!! Exit code 3 means \"pending, not a pass\": every native-facing path is",
    "!! accounted for, so this is not a dodge (that is 1), but no card ran, so it",
    "!! is not a measurement (that is 0). Run the card, store the capture with its",
    "!! manifest, and the capture supersedes this record.",
    bar,
  );
  return lines.join("\n");
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
