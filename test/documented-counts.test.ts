/**
 * Documented counts: every prose statement about this suite's own size must
 * match the suite.
 *
 * The failure this file exists for has now happened four times in one release:
 * a test file was added or removed and hard-coded numbers in README, CHANGELOG,
 * ROADMAP and `docs/` were left behind. The observed sequence was
 * 54 -> 73/80 -> 98 -> 117 -> 154 -> 204 -> 213 -> 221 -> 225 -> 228, and each pass was a
 * manual hunt: some files were found, at least one was missed, and the
 * correction left the document set contradicting itself about its own count. A
 * reader who catches the set disagreeing about a number that is trivially
 * checkable has no reason to trust the numbers that are not.
 *
 * So the number is measured, not remembered.
 *
 * ## How the suite is measured, and why this way
 *
 * `node node_modules/vitest/vitest.mjs list --json` — vitest's own collection
 * pass, in a child process. It reports one `{ name, file }` entry per test it
 * would run, and this file groups those entries by `file`.
 *
 *   - It is **collection, not execution**. The child loads the test modules,
 *     collects the cases and exits without running a test body or any hook.
 *     That is what makes it safe to call from inside a test: a nested
 *     `vitest run` would execute the whole suite — including the test that is
 *     asking — and recurse. `list` terminates. Measured cost: ~1.2 s.
 *   - It uses the **same configuration the real run uses** (`vitest.config.ts`:
 *     `include`, `exclude`, the aliases), because vitest is the thing reading
 *     that file. Nothing here re-implements the include globs, so a new
 *     `test/**` pattern cannot make the measured and executed numbers disagree.
 *   - It counts **what vitest records**, not `it(` occurrences, so a case
 *     generated in a loop counts as the cases it generates.
 *   - It is invoked as `node <vitest.mjs>` rather than through `pnpm exec`, so
 *     no package-manager wrapper sits between the measurement and vitest;
 *     resolving the path uses `createRequire` against this file's own location.
 *
 * The alternative was `pnpm exec vitest run --reporter=json`: it measures what
 * actually *ran*, which is better evidence, but it is a second full execution
 * of the suite from inside the suite (~6-7 s, every hook and fixture run twice)
 * and it reports skipped tests in a separate field that would have to be summed.
 * Collection and execution agree today — the suite has no `skip`/`todo` — and
 * that agreement is not assumed: `measures the suite...` asserts that every
 * collected file is a real file under `test/`, and the stability test requires
 * two collections to be identical. If a future `skip` ever made the two
 * numbers differ, the executed count would be the true one and this file would
 * need the `run --reporter=json` form; that trade is stated here rather than
 * discovered by someone debugging a phantom.
 *
 * ## The recursion, handled explicitly
 *
 * This file is part of the suite, so it changes the number it measures. There
 * is no special case for it: the measured count includes
 * `test/documented-counts.test.ts` and its own cases, which is exactly the
 * number a reader gets from `pnpm test`. That is proven, not assumed — the test
 * below selects the entries belonging to this very file by comparing resolved
 * paths and requires a non-zero number of them back. Measured 268 tests in 12
 * files with this file present, stable across repeated collections.
 *
 * ## The ignore rule, and why it cannot hide a stale current claim
 *
 * A number must be checked unless it is explicitly about a flat past state.
 * Three cases, in this order:
 *
 *   1. the sentence names a **commit id** (7-40 lowercase hex, the shape this
 *      repository uses: `fee7833`, `af237ca`) -> historical;
 *   2. the sentence contains a **present-tense token** -- "now", "today",
 *      "currently", "at present", "grown to", "has since" -> **checked**;
 *   3. a historical marker anywhere in the sentence or in the heading above it --
 *      "at the time", "at that time", "at this commit", "at that commit",
 *      "that commit", "predates", "was re-measured", "not re-measured",
 *      "not re-run" -> historical.
 *
 * Why each clause exists:
 *
 *   - **Markers are matched anywhere in the sentence, not only before the
 *     number**, because that is how this repository writes them: `121 tests in
 *     7 files at the time of that run` is historical with the framing at the
 *     end.
 *   - **Clause 2 stops sentence-level framing from swallowing a live claim.**
 *     `what this repository had at the time; the suite is 213 today` carries a
 *     marker *and* a stale current claim; the "today" disqualifies the sentence.
 *     `the suite has since grown to 220` is present perfect -- it says what the
 *     suite is now -- so it is checked too, even when the same sentence goes on
 *     to say "that count was not re-run". Both were real holes found by auditing
 *     this rule against the tree, not hypotheticals.
 *   - **Blocks are read as blocks.** A markdown table or bullet list is not one
 *     sentence: before that was fixed, a neighbouring row's "at that commit"
 *     exempted the current `228 tests in 11 files` row. `claimRows` therefore
 *     breaks blocks at every table row, list item, heading and blank line, and
 *     joins only *soft-wrapped continuation lines* -- so a wrapped sentence is
 *     read whole, and an adjacent row is never consulted. Same bug class, same
 *     fix, in both directions.
 *   - **The section heading counts as context**, because a claim written under
 *     "### Verified at this commit" is framed by that heading.
 *
 * The shapes in the tree, and how each is treated:
 *
 *   - `### Verified at this commit` / `213 unit tests in 9 files`, in a
 *     paragraph naming `fee7833`: skipped. That number is *correct* for
 *     `fee7833` -- nine test files there, checked with `git ls-tree` -- so
 *     failing it would be the test being wrong.
 *   - `exit 0, 121 tests in 7 files at the time of that run`: skipped. The
 *     historical count stays, with its framing, rather than being deleted.
 *   - `228 unit tests in 11 files`, `the suite is 228 now`, `has since grown to
 *     228`: checked.
 *
 * What the rule cannot do, stated plainly: a *current* count that shares a
 * sentence with a commit id would be skipped, and a human would have to catch
 * it. The documents keep those in separate sentences, which is also how a
 * reader wants them. The alternative -- no exemption at all -- would fail every
 * correct historical statement and get this guard deleted, which is the worse
 * outcome for a check that has to survive contact with real documents.
 *
 * ## What it scans, and what it deliberately does not
 *
 * Only suite size: totals (`<N> unit tests`, `<N> tests in <M> files`, `the
 * suite is <N>`, `grown to <N>`) and the per-file breakdown of the same suite
 * (`renderer 63`, `packaging.test.ts 4`). Counts about other things are not
 * scanned even when they share a sentence or a paragraph: the twenty parity
 * operations (`docs/contract.md` §14), the browser suites (17 and 9 tests, a
 * different runner), the tarball's 46 entries, and "17 + 9 tests". The patterns
 * require the words that make a statement about *this* suite in this
 * repository's idiom, so a bare "N tests" never matches.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const suiteTestDirectory = resolve(packageRoot, "test");

/** Extensions whose prose can state a suite size. `.dagr/` is not tracked. */
const SCANNED_EXTENSIONS = [".md", ".yml", ".yaml"];

interface CollectedTest {
  name: string;
  file: string;
}

interface Measurement {
  /** Tests vitest would run, this file's own cases included. */
  tests: number;
  /** Distinct test files vitest would load, this file included. */
  files: number;
  /** How many collected tests belong to this very file. */
  ownTests: number;
  /** Absolute paths, sorted. */
  filePaths: string[];
  /** Tests per test file, keyed by the file stem (`renderer`, `packaging`). */
  perFile: Map<string, number>;
}

interface CountClaim {
  /** Repository-relative path, `/`-separated. */
  file: string;
  /** 1-based line number. */
  line: number;
  /** The `<N>` as written. */
  writtenTests: number;
  /** The `<M>` as written, or `undefined` when the statement names no file count. */
  writtenFiles?: number;
  /** The matched text, for a failure message that quotes what it read. */
  statement: string;
}

interface FileClaim {
  file: string;
  line: number;
  /** Test-file stem the claim is about, e.g. `renderer`. */
  subject: string;
  written: number;
  measured: number;
  statement: string;
}

let measurement: Measurement;
let totalClaims: CountClaim[];
let fileClaims: FileClaim[];

/** Repository-relative, `/`-separated, for messages. */
function toRepoPath(absolutePath: string): string {
  return relative(packageRoot, absolutePath).split(sep).join("/");
}

/**
 * Every tracked markdown, workflow and YAML file. `git ls-files` rather than a
 * directory walk so "the documents" means the committed ones — the same choice
 * `test/packaging.test.ts` makes in reading the real tarball's file list instead
 * of trusting a hand-kept one.
 */
function scannedFiles(): string[] {
  const listed = execFileSync("git", ["ls-files", "-z"], {
    cwd: packageRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return listed
    .split("\0")
    .filter(path => path !== "")
    .filter(path => SCANNED_EXTENSIONS.some(extension => path.endsWith(extension)))
    .sort();
}

/** The suite as vitest sees it. See the header for why this mechanism. */
function measureSuite(): Measurement {
  const requireFromHere = createRequire(import.meta.url);
  const vitestCli = resolve(
    dirname(requireFromHere.resolve("vitest/package.json")),
    "vitest.mjs",
  );

  const collected = JSON.parse(
    execFileSync(process.execPath, [vitestCli, "list", "--json"], {
      cwd: packageRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    }),
  ) as CollectedTest[];

  const filePaths = [...new Set(collected.map(entry => entry.file))].sort();
  const selfPath = resolve(fileURLToPath(import.meta.url));
  const ownTests = collected.filter(entry => resolve(entry.file) === selfPath).length;

  const perFile = new Map<string, number>();
  for (const entry of collected) {
    // `test/renderer.test.ts` -> `renderer`, the name the docs use for it.
    const stem = basename(entry.file).replace(/\.test\.tsx?$/, "");
    perFile.set(stem, (perFile.get(stem) ?? 0) + 1);
  }

  return { tests: collected.length, files: filePaths.length, ownTests, filePaths, perFile };
}

/**
 * Words that make a count about a flat past state. Matched anywhere in the
 * sentence or in the heading above it; only a present-tense token overrides
 * them.
 *
 * `"at the time"` is not narrowed further: it covers "at the time", "at the
 * time of that run" and "at the time of writing", all historical.
 */
const HISTORICAL_MARKERS = [
  "at the time",
  "at that time",
  "at this commit",
  "at that commit",
  "that commit",
  "predates",
  "was re-measured",
  "not re-measured",
  "not re-run",
];

/**
 * Present-tense words that disqualify a sentence from the historical
 * exemption. Word-bounded, so "known" does not read as "now".
 *
 * `grown to` and `has since` are here on purpose. "The suite has since grown to
 * 228" is present perfect: it says what the suite is *now*, as a consequence of
 * past growth, and a reader takes the number as current. Treating it as
 * historical would exempt exactly the sentence that goes stale next. Only
 * flat-past framing embeds an exemption.
 */
const PRESENT_MARKERS = /\b(?:now|today|currently)\b|\bat present\b|\bgrown to\b|\bhas since\b/i;

/**
 * A 7-40 character run of lowercase hex: a commit id as this repository writes
 * them (`fee7833`, `002b786`). No `i` flag, so a lowercase word cannot read as
 * a sha.
 */
const COMMIT_SHAPE = /(?<![0-9a-z])[0-9a-f]{7,40}(?![0-9a-z])/;

/**
 * `true` when a claim in `sentence` (with `heading` as context) is about a past
 * state rather than this commit. Three cases, in order:
 *
 *  1. The sentence names a **commit id**. That is an unambiguous anchor — a
 *     count attached to a named commit is a historical record by construction —
 *     so it wins even if the same sentence also says "now". This is what lets a
 *     document keep a true historical snapshot beside a true current number.
 *  2. The sentence has a present-tense token and no commit id: **checked**. This
 *     is the clause that stops framing from swallowing a live claim.
 *  3. Otherwise a historical marker anywhere in the sentence or its heading
 *     exempts it.
 *
 * The corollary, stated so it is not discovered later: a *current* count must
 * never share a sentence with a commit id, or it will be skipped. The documents
 * here keep them in separate sentences, which is also how a reader wants them.
 */
function isHistorical(heading: string, sentence: string): boolean {
  // 1. A named commit is authoritative, present-tense words notwithstanding.
  if (COMMIT_SHAPE.test(sentence)) return true;

  // 2. A live claim cannot borrow framing from elsewhere in its sentence.
  if (PRESENT_MARKERS.test(sentence)) return false;

  // 3. Explicit flat-past framing, in the sentence or the heading above it.
  const haystack = `${heading}\n${sentence}`.toLowerCase();
  return HISTORICAL_MARKERS.some(marker => haystack.includes(marker));
}

/** Word numerals the prose uses ("across ten files"). Digits are handled too. */
const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

/**
 * The shapes that state the whole suite's size, in this repository's idiom.
 * Named groups per family so one statement yields one claim rather than two
 * overlapping ones.
 *
 * `unit tests` is what keeps per-file and other-suite counts out: "19 tests"
 * (one file), "17 tests" (Chromium), "9 tests" (Playwright) and "50 tests"
 * (a script) carry neither `unit` nor `in N files`.
 */
const SUITE_SIZE_PATTERN = new RegExp(
  [
    // <N> unit tests [across|in <M> files]
    String.raw`(?<unit>\b(?<unitN>\d+)\s+unit tests`
      + String.raw`(?:\s+(?:across|in)\s+(?<unitM>\d+|${Object.keys(NUMBER_WORDS).join("|")})\s+files?)?)`,
    // <N> tests in <M> files
    String.raw`(?<inFiles>\b(?<inN>\d+)\s+tests?\s+in\s+(?<inM>\d+)\s+files?\b)`,
    // <N> passing tests — a total for this suite, as compatibility.md writes it
    String.raw`(?<passing>\b(?<passingN>\d+)\s+passing tests\b)`,
    // the suite is <N> / was <N>
    String.raw`(?<suite>\bsuite\s+(?:is|was)\s+(?<suiteN>\d+))`,
    // the suite (has) (since) grown to <N> — present perfect, so a current claim
    String.raw`(?<grown>\bsuite\s+(?:has\s+)?(?:since\s+)?grown\s+to\s+(?<grownN>\d+))`,
  ].join("|"),
  "gi",
);

interface ClaimRow {
  line: number;
  text: string;
  /** Text of the nearest preceding heading / workflow comment block, or "". */
  heading: string;
  /**
   * The *block* this line belongs to: a table row, a list item, a heading, or a
   * soft-wrapped paragraph, with the markdown line breaks removed.
   *
   * This repository wraps prose at ~80 columns, so a claim and its historical
   * framing often sit on different lines and the sentence that decides whether
   * a number is historical has to be the logical sentence. It must **not** be
   * the surrounding markdown container: a table or a bullet list is not one
   * sentence, and treating it as one let a neighbouring row's "at that commit"
   * exempt a current row's number. Blocks are therefore broken at every line
   * that starts a new markdown block element.
   */
  block: string;
}

/** Lines that begin a new markdown block rather than continuing one. */
const BLOCK_STARTER = /^\s*(?:[|#*>]|[-+]\s|\d+[.)]\s)/;

/**
 * The lines that can hold prose, each tagged with the block and heading it
 * belongs to.
 *
 * Fenced code blocks are **scanned**, not skipped: `docs/session-handoff.md`
 * keeps its verified command list in a fence and "228 tests in 11 files" lives
 * on one of those lines. A count in a fence is still a claim a reader checks.
 * Fence markers themselves are dropped, and fenced lines are never read as
 * markdown structure — a `# comment` inside a fence is code, not a heading —
 * while the heading from outside the fence still labels them.
 *
 * In a workflow, only the comment text is prose; the rest is executable config,
 * and the comment block a line belongs to is its heading context, since YAML
 * comments have no headings.
 */
function claimRows(file: string, source: string): ClaimRow[] {
  const rows: ClaimRow[] = [];
  const lines = source.split("\n");
  const isWorkflow = file.endsWith(".yml") || file.endsWith(".yaml");
  let heading = "";
  let inFence = false;

  // Block accumulation for one markdown block at a time.
  let blockLines: string[] = [];
  let blockStart = 0;
  let blockHeading = "";

  const flushBlock = () => {
    if (blockLines.length === 0) return;
    const joined = blockLines.join(" ").replace(/\s+/g, " ").trim();
    for (let i = 0; i < blockLines.length; i += 1) {
      rows.push({
        line: blockStart + i + 1,
        text: blockLines[i],
        heading: blockHeading,
        block: joined,
      });
    }
    blockLines = [];
  };

  lines.forEach((line, index) => {
    if (/^\s*(```+|~~~+)/.test(line)) {
      flushBlock();
      inFence = !inFence;
      return;
    }

    if (inFence) {
      // Code, but a count in it is still a claim. The whole fence is one block
      // so a wrapped command keeps its own line numbers, and structure-shaped
      // lines (`# …`) cannot rewrite the heading.
      if (blockLines.length === 0) {
        blockStart = index;
        blockHeading = heading;
      }
      blockLines.push(line);
      return;
    }

    if (isWorkflow) {
      const comment = /^\s*#\s?(.*)$/.exec(line);
      if (!comment) {
        flushBlock();
        return;
      }
      // A contiguous comment block is one block, and its first line labels it.
      if (blockLines.length === 0) blockStart = index;
      else if (/^\s*#\s*$/.test(lines[index - 1] ?? "")) flushBlock();
      if (blockLines.length === 0) {
        blockStart = index;
        blockHeading = comment[1].trim();
      }
      blockLines.push(comment[1]);
      return;
    }

    const headingMatch = /^#{1,6}\s+(.*)$/.exec(line);
    if (headingMatch) {
      flushBlock();
      heading = headingMatch[1];
      // A heading is its own one-line block, so a claim written *in* a heading
      // is read with that heading as context.
      rows.push({ line: index + 1, text: line, heading, block: line });
      return;
    }

    if (line.trim() === "") {
      flushBlock();
      return;
    }

    // A new table row or list item starts a new block; a plain line continues
    // the current one (that is what soft wrapping looks like).
    if (BLOCK_STARTER.test(line) || blockLines.length === 0) {
      flushBlock();
      blockStart = index;
      blockHeading = heading;
    }
    blockLines.push(line);
  });

  flushBlock();
  return rows;
}

/**
 * The sentence a match sits in, inside its own block. A table row or list item
 * is one claim; wrapped prose is split on sentence-ending punctuation so one
 * clause cannot shelter another.
 */
function sentenceAround(row: ClaimRow, matchIndex: number): string {
  const text = row.block;
  if (row.block === row.text || text.trimStart().startsWith("|")) return text;

  const starts: number[] = [0];
  for (const match of text.matchAll(/[.!?]\s+/g)) {
    starts.push((match.index ?? 0) + match[0].length);
  }
  starts.push(text.length);

  // Match positions are on the physical line; locate the line inside the block
  // to translate them.
  const lineStart = text.indexOf(row.text.trim());
  const blockIndex = lineStart >= 0 ? lineStart + matchIndex : matchIndex;

  for (let i = 0; i < starts.length - 1; i += 1) {
    if (blockIndex >= starts[i] && blockIndex < starts[i + 1]) {
      return text.slice(starts[i], starts[i + 1]).trim();
    }
  }
  return text;
}

function collectTotalClaims(): CountClaim[] {
  const found: CountClaim[] = [];

  for (const file of scannedFiles()) {
    const source = readFileSync(resolve(packageRoot, file), "utf8");

    for (const row of claimRows(file, source)) {
      // A fresh regex per line: a `g` regex carries `lastIndex` between calls.
      for (const match of row.text.matchAll(new RegExp(SUITE_SIZE_PATTERN))) {
        const sentence = sentenceAround(row, match.index ?? 0);
        if (isHistorical(row.heading, sentence)) continue;

        const groups = match.groups ?? {};
        const testsText =
          groups.unitN ?? groups.inN ?? groups.suiteN ?? groups.grownN ?? groups.passingN;
        const filesText = groups.unitM ?? groups.inM;
        if (testsText === undefined) continue;

        found.push({
          file,
          line: row.line,
          writtenTests: Number(testsText),
          writtenFiles:
            filesText === undefined
              ? undefined
              : (NUMBER_WORDS[filesText.toLowerCase()] ?? Number(filesText)),
          statement: match[0].replace(/\s+/g, " ").trim(),
        });
      }
    }
  }

  return found;
}

/**
 * Per-file breakdowns of the same suite: `<stem> <N>` or `test/<stem>.test.ts <N>`,
 * where `<stem>` is a test file that exists.
 *
 * Two false positives this narrows away, both seen in the tree:
 *   - a scoped package name: `@lynx-js/rspeedy` 0.18.0 would otherwise read as
 *     "rspeedy, 0 tests". The optional `test/` prefix is consumed first when it
 *     is there, so the lookbehind then sees whatever precedes `test/` (a space
 *     or a backtick); for a package path it sees `/`, `@` or `-`, which are
 *     excluded;
 *   - a semver: the count may not be followed by `.` or a digit, so `0.18.0`
 *     and `1.9.15` are not counts.
 *
 * Longest stem first so `native-parity-verify` wins over `parity` at the same
 * position, and the lookbehind keeps `parity` from matching inside
 * `native-parity-verify` (preceded by `-`).
 */
function fileCountPattern(stems: string[]): RegExp {
  const ordered = [...stems].sort((a, b) => b.length - a.length);
  return new RegExp(
    String.raw`(?<![\w@/-])(?:test/)?(?<subject>${ordered.join("|")})(?:\.test\.tsx?)?\`?\s+(?<count>\d+)(?![\d.])`,
    "gi",
  );
}

function collectFileClaims(): FileClaim[] {
  const found: FileClaim[] = [];
  const stems = [...measurement.perFile.keys()];
  const pattern = fileCountPattern(stems);

  for (const file of scannedFiles()) {
    const source = readFileSync(resolve(packageRoot, file), "utf8");

    for (const row of claimRows(file, source)) {
      for (const match of row.text.matchAll(new RegExp(pattern))) {
        const sentence = sentenceAround(row, match.index ?? 0);
        if (isHistorical(row.heading, sentence)) continue;
        const subject = (match.groups?.subject ?? "").toLowerCase();
        const measured = measurement.perFile.get(subject);
        if (measured === undefined) continue;
        found.push({
          file,
          line: row.line,
          subject,
          written: Number(match.groups?.count),
          measured,
          statement: match[0].trim(),
        });
      }
    }
  }

  return found;
}

beforeAll(() => {
  measurement = measureSuite();
  totalClaims = collectTotalClaims();
  fileClaims = collectFileClaims();
}, 120_000);

describe("counts stated in the repository's own documents", () => {
  it("measures the suite with vitest's collection pass, not by counting files", () => {
    expect(measurement.tests).toBeGreaterThan(0);
    expect(measurement.files).toBeGreaterThan(0);

    // The recursion, proven rather than assumed: this file's own cases are in
    // the number the assertions below compare against. If collection ever
    // stopped loading this file, `ownTests` would be 0 and the measured total
    // would be smaller than what `pnpm test` runs.
    expect(
      measurement.ownTests,
      `${toRepoPath(fileURLToPath(import.meta.url))} contributed 0 collected tests; `
        + "the measurement is not including the file that is asking",
    ).toBeGreaterThan(0);

    // Every collected file is a real file under test/, so a config that scanned
    // the wrong directory surfaces here rather than as a wrong document number.
    for (const file of measurement.filePaths) {
      expect(isAbsolute(file), `collected a non-absolute path: ${file}`).toBe(true);
      expect(
        resolve(file).startsWith(suiteTestDirectory + sep),
        `collected ${file}, which is not under test/`,
      ).toBe(true);
    }

    // The parts add up to the whole, which is what makes the per-file
    // assertions below and the totals assertions the same measurement.
    const summed = [...measurement.perFile.values()].reduce((a, b) => a + b, 0);
    expect(summed).toBe(measurement.tests);
    expect(measurement.perFile.size).toBe(measurement.files);
  });

  it("states the same suite size everywhere it states a size", () => {
    // A guard on the guard: if the patterns stopped matching, this test would
    // pass vacuously while the documents drifted freely.
    expect(
      totalClaims.length,
      "no document states the suite size any more; the scan or the documents changed shape",
    ).toBeGreaterThan(0);
    expect(
      new Set(totalClaims.map(claim => claim.file)).size,
      "only one file states the suite size; the scan is probably not reading the tree",
    ).toBeGreaterThan(1);

    const failures: string[] = [];

    for (const claim of totalClaims) {
      if (claim.writtenTests !== measurement.tests) {
        failures.push(
          `${claim.file}:${claim.line}: says "${claim.statement}" `
            + `(${claim.writtenTests} tests), but the suite measures ${measurement.tests} tests`,
        );
      }
      if (claim.writtenFiles !== undefined && claim.writtenFiles !== measurement.files) {
        failures.push(
          `${claim.file}:${claim.line}: says "${claim.statement}" `
            + `(${claim.writtenFiles} files), but the suite measures ${measurement.files} files`,
        );
      }
    }

    expect(
      failures,
      `${failures.length} documented count(s) disagree with the suite `
        + `(${measurement.tests} tests in ${measurement.files} files). `
        + "Update the document, or — if the statement is about an earlier commit — "
        + `name that commit or say "at the time":\n${failures.join("\n")}`,
    ).toEqual([]);
  });

  it("states the per-file breakdown correctly wherever it gives one", () => {
    const failures: string[] = [];

    for (const claim of fileClaims) {
      if (claim.written !== claim.measured) {
        failures.push(
          `${claim.file}:${claim.line}: says "${claim.statement}" `
            + `(${claim.written} tests in test/${claim.subject}.test.ts), `
            + `but that file has ${claim.measured}`,
        );
      }
    }

    expect(failures, `per-file counts disagree with the suite:\n${failures.join("\n")}`).toEqual([]);

    // A per-file statement exists somewhere, or the scan is dead.
    expect(fileClaims.length, "no per-file breakdown was found; the scan changed shape")
      .toBeGreaterThan(0);
  });

  it("is stable across repeated collection", () => {
    // Two collections, because this file measures itself: a number that is
    // stable only because it was measured once is the kind of number this file
    // exists to stop.
    const again = measureSuite();
    expect(again.tests).toBe(measurement.tests);
    expect(again.files).toBe(measurement.files);
    expect(again.filePaths).toEqual(measurement.filePaths);
    expect([...again.perFile.entries()].sort()).toEqual([...measurement.perFile.entries()].sort());
  });
});
