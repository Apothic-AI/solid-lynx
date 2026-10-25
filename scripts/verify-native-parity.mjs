#!/usr/bin/env node
/**
 * Verify a captured native parity log against the checklist the package ships.
 *
 * `examples/lynx-for-native` logs one `[solid-lynx parity] {...}` line carrying a
 * `ParityReport` from `runElementPapiParity()`. Reading that line by eye is how
 * the native column of `docs/parity-checklist.md` was filled, and prose is not
 * evidence a release can re-check. This script does the three things a reviewer
 * does by eye:
 *
 *   1. find every parity line and parse the JSON behind it;
 *   2. compare the operations in the captured report against
 *      `parityOperationIds` from the built package (`dist/parity.js`);
 *   3. reject any operation that is not `pass`, or `unsupported` with a reason.
 *
 * It reads a text file and nothing else: no device, no adb, no network.
 *
 * The payload is not "everything after the marker". A real capture is written by
 * the Lynx console bridge, which wraps the card's message in a double quote and
 * prefixes it with the thread that logged it (see `extractCaptures`). The JSON is
 * the span from the first `{` after the marker to the last `}` on the line;
 * everything else on that line is framing. Until this rule existed the script
 * only ever read hand-written fixtures in `test/fixtures/`, which carry a bare
 * marker and JSON with no wrapping quote, so every real capture was rejected as
 * truncated while parsing correctly by eye.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Exit codes. The same discipline dagr uses: 0 clean, 1 findings, 2 unreadable. */
const EXIT_VERIFIED = 0;
const EXIT_FINDINGS = 1;
const EXIT_COULD_NOT_EVALUATE = 2;

const MARKER = "[solid-lynx parity]";

/**
 * The thread tag the console bridge puts in front of a logged message.
 *
 * A card can log from the main thread or from the background thread, and the
 * same marker may legitimately appear from both. Each tagged line is one report
 * — see `threadOf` and the duplicate-marker rule below.
 */
const THREAD_TAG = /\[(main-thread|background)\.js\]/g;

/** Statuses the harness can emit. */
const STATUSES = ["pass", "fail", "unsupported"];
/** Statuses that are acceptable evidence. `unsupported` only with a reason. */
const ACCEPTED_STATUSES = ["pass", "unsupported"];

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.dirname(path.dirname(SCRIPT_PATH));
const PARITY_MODULE_PATH = path.join(REPO_ROOT, "dist", "parity.js");
const PARITY_MODULE_LABEL = path.posix.join("dist", "parity.js");
const PARITY_NODE_LABEL = path.posix.join("scripts", "verify-native-parity.mjs");

/** Observed values longer than this are clipped in the table, never in the detail. */
const OBSERVED_WIDTH = 56;

const USAGE = `verify-native-parity — check a captured native parity log

Usage:
  node ${PARITY_NODE_LABEL} <capture.log>
  node ${PARITY_NODE_LABEL} --help

What it does
  examples/lynx-for-native logs one line per run. A fixture can hold it bare:

    [solid-lynx parity] {"label":"native","operations":[...],"summary":{...}}

  A real capture cannot, because Lynx Explorer writes it through the native
  console bridge, which wraps the message in double quotes and prefixes the
  thread that logged it:

    10-25 08:41:39.887  5650  5685 I lynx    : [715D09544CF0:INFO:lynx_console.cc(230)] "[main-thread.js] [solid-lynx parity] {...}"

  So a real line is logcat columns, an opening \`"\`, a \`[main-thread.js] \` or
  \`[background.js] \` prefix, the marker, the JSON, then a closing \`"\`. A native
  run is recorded by keeping that line in a log file. This script then
  (\`<capture.log>\` may be a logcat dump, a console capture, or a file holding
  nothing but the line):

  1. extracts every line containing the [solid-lynx parity] marker and parses
     the JSON on it: the span from the first \`{\` after the marker to the last
     \`}\` on the line. Everything outside that span is framing — the logcat
     columns, the console bridge's wrapping quotes, the \`[main-thread.js] \` or
     \`[background.js] \` prefix, and trailing whitespace;
  2. compares the operations in each captured report against
     \`parityOperationIds\` imported from the built package (dist/parity.js),
     and reports any operation that is missing or unrecognised;
  3. rejects any operation whose status is not \`pass\`, and any \`unsupported\`
     operation that carries no reason (an empty \`observed\` and \`note\`).

  It also checks that each report's \`summary\` counters match its own rows, so a
  capture whose summary was edited or truncated is a finding rather than a pass.

  Truncation is decided by scanning the payload span for an unbalanced brace or
  an unterminated string before JSON.parse runs, never by whether the line ends
  with \`}\`: a real capture ends with the bridge's closing quote, and only an
  unbalanced span is truncation.

  Two marker lines are two reports. A card can log from the main thread and
  again from the background thread, and a report is self-contained, so each line
  is parsed and evaluated on its own under the thread that logged it. Nothing is
  replaced by the last line: both are checked, and a defect in either is a
  finding.

  The host \`label\` in the report is printed but not enforced: the harness can be
  run under any label, and it is the reader's job to know which host was
  captured. A label is evidence, not a gate.

Exit codes
  0  verified        every captured report is complete and every operation passes
                     (or is unsupported with a reason)
  1  findings        the capture was read and something in it is wrong: a missing
                     or unrecognised operation, a \`fail\`, an \`unsupported\` with
                     no reason, or a summary that disagrees with its rows
  2  could not evaluate
                     there was nothing to evaluate, or nothing trustworthy to
                     read: an unreadable file, a capture with no
                     [solid-lynx parity] line, a marker with no \`{\` after it, a
                     payload that is truncated or malformed, or a missing
                     dist/parity.js (run \`pnpm build\` first)

  These follow the same discipline as dagr: 0 means the artefact is clean, 1
  means the artefact was read and has findings, 2 means it could not be read at
  all. A 2 is never a clean result and must not be cited as a pass; neither must
  "the file was missing" be confused with "the run passed".

Capture recipe
  pnpm native:build
  examples/lynx-for-native/scripts/run-native-probe.sh smoke
  node ${PARITY_NODE_LABEL} /tmp/solid-lynx-logs/lynx_console-smoke-<stamp>.log
  (that path is one line; wrapped here for this help text only)

  Keep the capture next to whatever record cites it. A verdict without the log
  it came from is a claim, not evidence.
`;

class CannotEvaluate extends Error {}

function usageError(message) {
  return new CannotEvaluate(`${message}\n\nRun \`node ${PARITY_NODE_LABEL} --help\` for usage.`);
}

function parseArguments(argv) {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    return { help: true };
  }
  if (argv.length === 0) {
    throw usageError("no capture file given.");
  }
  if (argv.length > 1) {
    throw usageError(
      `expected exactly one capture file, got ${argv.length}: ${argv.join(" ")}.`
        + " Verify each capture separately, one command per run.",
    );
  }
  const argvPath = argv[0];
  if (argvPath.startsWith("-")) {
    throw usageError(`unknown option: ${argvPath}`);
  }
  return { help: false, capturePath: argvPath };
}

/**
 * Reads the operation ids from the built package.
 *
 * The built `dist/` is the only copy of the checklist the reviewer actually
 * receives, so it is the source of truth here rather than the TypeScript source
 * or a list copied into this script.
 */
async function loadExpectedOperations() {
  if (!existsSync(PARITY_MODULE_PATH)) {
    throw new CannotEvaluate(
      `${PARITY_MODULE_LABEL} is missing, so the checklist this capture is checked`
        + " against cannot be read. Run `pnpm build` (or `pnpm install && pnpm build`)"
        + " and re-run this command. Nothing was verified.",
    );
  }

  let module;
  try {
    module = await import(pathToFileURL(PARITY_MODULE_PATH).href);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CannotEvaluate(
      `${PARITY_MODULE_LABEL} exists but did not load: ${message}.`
        + " Re-run `pnpm build`; a half-written or stale dist is not a checklist.",
    );
  }

  const ids = module.parityOperationIds;
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new CannotEvaluate(
      `${PARITY_MODULE_LABEL} does not export a non-empty \`parityOperationIds\` array,`
        + " so there is no checklist to verify against. Re-run `pnpm build`.",
    );
  }
  const notStrings = ids.filter(id => typeof id !== "string");
  if (notStrings.length > 0) {
    throw new CannotEvaluate(
      `${PARITY_MODULE_LABEL} exports ${notStrings.length} non-string operation id(s) in`
        + " `parityOperationIds`, which cannot be compared against a report.",
    );
  }
  return ids;
}

/* --------------------------------------------------------- payload extraction
 *
 * A real capture is framed, and that framing is what the first version of this
 * script got wrong. Lynx Explorer writes a `console.log` through the native
 * console bridge, which emits one logcat line shaped like this:
 *
 *   10-25 08:41:39.887  5650  5685 I lynx    : [715D09544CF0:INFO:lynx_console.cc(230)] "[main-thread.js] [solid-lynx parity] {...}"
 *   |____________ logcat columns _____________________|  |__ thread tag __| |____ marker ____|  |JSON|  |
 *                                                        ^                                       ^        ^
 *                                                        bridge's opening quote                  payload  bridge's closing quote
 *
 * Three things follow from that shape, and all three are rules rather than
 * guesses:
 *
 *   1. The payload is the span from the first `{` after the marker to the last
 *      `}` on the line. Everything outside it is framing: the logcat columns,
 *      the bridge's wrapping `"`, a `[main-thread.js] ` or `[background.js] `
 *      prefix, and trailing whitespace. A fixture with a bare marker and JSON
 *      still extracts the same span, which is why both shapes parse.
 *   2. The JSON check itself is not loosened: the span goes to JSON.parse as-is,
 *      and anything malformed is still a `could not evaluate`.
 *   3. Truncation is measured by scanning the span for an unbalanced brace or an
 *      unterminated string, before JSON.parse is attempted. "The line does not
 *      end with `}`" cannot tell framing from truncation, because every real
 *      capture ends with the bridge's closing quote. A real truncation — the
 *      console bridge dropping the tail, or a capture cut mid-write — leaves
 *      braces unbalanced or a string open, and that is what is reported.
 *
 * A marker on more than one line is two reports, not one: each line is parsed
 * and evaluated on its own, and the report is labelled with the thread that
 * logged it. The parity report is self-contained, so two lines mean two complete
 * reports and both are checked; nothing is silently dropped in favour of the
 * last line.
 */

/**
 * The thread that logged a line, from the tag the console bridge puts in the
 * message ahead of the marker. The last tag before the marker wins, so a stray
 * bracket earlier in the logcat columns cannot be mistaken for it.
 */
function threadOf(line, markerAt) {
  const before = line.slice(0, markerAt);
  const tags = [...before.matchAll(THREAD_TAG)];
  return tags.length === 0 ? "(unthreaded)" : `${tags[tags.length - 1][1]}.js`;
}

/**
 * The first way a JSON span cannot be a complete value, or `null` when it is
 * balanced.
 *
 * This is a scan, not a parse: it runs before JSON.parse so that a genuinely
 * truncated line reports truncation instead of a generic parse error, and it
 * reads the span the same way a JSON tokenizer would — braces and brackets
 * stack, and a quote opens a string unless it is escaped inside one.
 */
function unbalancedReason(span) {
  const stack = [];
  let inString = false;
  let escaped = false;

  for (const char of span) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") {
      stack.push(char);
      continue;
    }
    if (char === "}" || char === "]") {
      const open = stack.pop();
      if (open === undefined) {
        return `a \`${char}\` on the line closes a value that was never opened`;
      }
      const fits = (open === "{" && char === "}") || (open === "[" && char === "]");
      if (!fits) {
        return `a \`${char}\` closes a \`${open}\` that was opened before it`;
      }
    }
  }

  if (inString) return "a string is still open where the line stops";
  if (stack.length > 0) {
    return `${stack.length} \`${stack[stack.length - 1]}\` never closed before the line stops`;
  }
  return null;
}

/**
 * Every line carrying the marker, with the payload span and its framing.
 *
 * `payload` is the JSON span; `framing` is the rest of the line after the
 * marker, so a reader of an error message can see what was treated as framing
 * without re-reading the capture.
 */
function extractCaptures(text) {
  const lines = text.split(/\r?\n/);
  const captures = [];
  lines.forEach((line, index) => {
    const at = line.indexOf(MARKER);
    if (at < 0) return;
    const markerEnd = at + MARKER.length;
    const openAt = line.indexOf("{", markerEnd);
    const closeAt = openAt < 0 ? -1 : line.lastIndexOf("}");
    const hasClosingBrace = openAt >= 0 && closeAt >= openAt;
    captures.push({
      lineNumber: index + 1,
      thread: threadOf(line, at),
      // When the closing brace is missing the payload runs to the end of the
      // line, so the balance scan can say what is still open rather than the
      // report guessing at "truncated" from a missing character.
      payload: openAt < 0
        ? ""
        : hasClosingBrace ? line.slice(openAt, closeAt + 1) : line.slice(openAt),
      // The text after the marker with the payload cut out of it: the bridge's
      // quotes, a thread tag left after the marker, trailing whitespace.
      framing: openAt < 0
        ? line.slice(markerEnd)
        : line.slice(markerEnd, openAt)
          + (hasClosingBrace ? line.slice(closeAt + 1) : ""),
      hasOpeningBrace: openAt >= 0,
      hasClosingBrace,
      line,
    });
  });
  return captures;
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

/** Parses every capture, or throws because the capture cannot be evaluated. */
function parseCaptures(captures, capturePath) {
  return captures.map(capture => {
    const where = `${capturePath}:${capture.lineNumber}`;

    if (!capture.hasOpeningBrace) {
      const after = capture.framing.trim();
      throw new CannotEvaluate(
        `${where}: the ${MARKER} marker is there but no JSON follows it: the line has no`
          + ` \`{\` after the marker${after === "" ? "" : ` (it carries ${describeValue(
            after.length > 40 ? `${after.slice(0, 39)}…` : after)})`}. Run the card again and`
          + " capture the whole line; nothing was verified.",
      );
    }

    if (!capture.hasClosingBrace) {
      throw new CannotEvaluate(
        `${where}: the JSON after ${MARKER} does not parse because it is truncated: the`
          + ` \`{\` after the marker is never closed (${unbalancedReason(capture.payload)
            ?? "no closing brace remains on the line"}). The line is truncated: a complete`
          + " report balances its braces, so the capture stopped early or the console"
          + " bridge dropped the tail. Nothing was verified; a capture that cannot be"
          + " parsed is not a result.",
      );
    }

    // The scan comes first, so a real truncation is named as one. A complete
    // report whose braces balance but which JSON still rejects is malformed, not
    // truncated, and saying so keeps the two failures apart.
    const unbalanced = unbalancedReason(capture.payload);
    if (unbalanced !== null) {
      throw new CannotEvaluate(
        `${where}: the JSON after ${MARKER} does not parse because it is truncated:`
          + ` ${unbalanced}. The line is truncated: a complete report balances its braces,`
          + " and the console bridge drops everything after the first newline, so a line"
          + " that stops early looks like this. Nothing was verified; a capture that"
          + " cannot be parsed is not a result.",
      );
    }

    let report;
    try {
      report = JSON.parse(capture.payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CannotEvaluate(
        `${where}: the JSON after ${MARKER} does not parse (${message}). Its braces`
          + " balance, so this is not a truncation: the payload is malformed. Nothing was"
          + " verified; a capture that cannot be parsed is not a result.",
      );
    }

    if (!isPlainObject(report) || !Array.isArray(report.operations)) {
      throw new CannotEvaluate(
        `${where}: the JSON after ${MARKER} parses but is not a`
          + " parity report (expected an object with an `operations` array). Nothing was verified.",
      );
    }

    return { ...capture, report };
  });
}

function hasText(value) {
  return typeof value === "string" ? value.trim() !== "" : value !== undefined && value !== null;
}

/**
 * Compares one captured report against the built checklist and returns its
 * findings. Findings are data, not exceptions: they are the reason this exits 1.
 */
function evaluateReport(capture, expectedIds, capturePath) {
  const report = capture.report;
  const findings = [];
  const where = `${capturePath}:${capture.lineNumber}`;
  const add = (kind, message, row) => findings.push({ kind, message, where, row });

  const seen = new Set();
  const rows = [];
  report.operations.forEach((row, index) => {
    if (!isPlainObject(row) || typeof row.operation !== "string") {
      add(
        "malformed-row",
        `operation at index ${index} is not a result with a string \`operation\`:`
          + ` ${describeValue(row)}`,
      );
      return;
    }
    if (seen.has(row.operation)) {
      add("duplicate-operation", `\`${row.operation}\` is reported more than once.`, row);
      return;
    }
    seen.add(row.operation);
    rows.push(row);
  });

  const expected = new Set(expectedIds);
  const missing = expectedIds.filter(id => !seen.has(id));
  const unrecognised = rows.map(row => row.operation).filter(id => !expected.has(id));

  if (missing.length > 0) {
    add(
      "missing-operation",
      `${missing.length} operation(s) from parityOperationIds are absent from this report:`
        + ` ${missing.map(id => `\`${id}\``).join(", ")}. A partial report is not a run.`,
    );
  }
  if (unrecognised.length > 0) {
    add(
      "unrecognised-operation",
      `${unrecognised.length} reported operation(s) are not in parityOperationIds:`
        + ` ${unrecognised.map(id => `\`${id}\``).join(", ")}. The capture and the built`
        + " package disagree; rebuild, or the report came from a different revision.",
    );
  }

  for (const row of rows) {
    const status = row.status;
    if (!STATUSES.includes(status)) {
      add(
        "unrecognised-status",
        `\`${row.operation}\` reports status ${describeValue(status)}, which is not one of`
          + ` ${STATUSES.join(", ")}.`,
        row,
      );
      continue;
    }
    if (status === "fail") {
      add(
        "fail",
        `\`${row.operation}\` failed: expected ${describeValue(row.expected)},`
          + ` observed ${describeValue(row.observed)}.`,
        row,
      );
      continue;
    }
    if (status === "unsupported" && !hasText(row.observed) && !hasText(row.note)) {
      add(
        "unsupported-without-reason",
        `\`${row.operation}\` is unsupported with neither an \`observed\` value nor a note,`
          + " so there is nothing to record as the reason.",
        row,
      );
    }
  }

  // A summary that disagrees with the rows means the capture was edited, or the
  // report and its own table came from different runs. Either way: not a pass.
  if (!isPlainObject(report.summary)) {
    add("summary-missing", "the report has no `summary` object, so the counters cannot be checked.");
  } else {
    for (const status of STATUSES) {
      const counted = rows.filter(row => row.status === status).length;
      const claimed = report.summary[status];
      if (claimed !== counted) {
        add(
          "summary-mismatch",
          `the report's summary claims ${describeValue(claimed)} \`${status}\` operation(s)`
            + ` but its own rows contain ${counted}.`,
        );
      }
    }
  }

  return { capture, rows, missing, unrecognised, findings };
}

/** The host label as written, so an unlabelled report is visible as such. */
function labelOf(report) {
  return typeof report.label === "string" && report.label.trim() !== ""
    ? report.label
    : "(unlabelled)";
}

function padRight(value, width) {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function clip(value, width) {
  return value.length <= width ? value : `${value.slice(0, width - 1)}…`;
}

function cell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** A compact table of one report's rows, in the order the checklist declares. */
function renderTable(result, expectedIds) {
  const order = new Map(expectedIds.map((id, index) => [id, index]));
  const rank = row => order.get(row.operation) ?? Number.MAX_SAFE_INTEGER;
  const rows = [...result.rows].sort((left, right) => rank(left) - rank(right));

  const header = ["operation", "status", "expected", "observed"];
  const body = rows.map(row => [
    row.operation,
    String(row.status),
    String(row.expected ?? "-"),
    clip(String(row.observed ?? "-"), OBSERVED_WIDTH),
  ]);
  const widths = header.map((heading, column) =>
    Math.max(heading.length, ...body.map(line => line[column].length)));

  const line = cells =>
    `  ${cells.map((value, column) => padRight(value, widths[column])).join("  ")}`.trimEnd();
  return [
    line(header),
    line(widths.map(width => "-".repeat(width))),
    ...body.map(line),
  ].join("\n");
}

function renderDetail(result, capturePath) {
  const report = result.capture.report;
  const lines = [`  ${capturePath}:${result.capture.lineNumber}`
    + ` — thread ${result.capture.thread} — host ${labelOf(report)},`
    + ` ${result.rows.length} operation(s)`];

  for (const finding of result.findings) {
    lines.push(`  - [${finding.kind}] ${finding.message}`);
    if (finding.row) {
      const papi = Array.isArray(finding.row.papi) ? finding.row.papi.join(", ") : "";
      if (papi) lines.push(`      papi: ${papi}`);
      if (finding.row.note) lines.push(`      note: ${finding.row.note}`);
    }
  }
  return lines.join("\n");
}

function summarize(results) {
  const findings = results.flatMap(result => result.findings);
  const rows = results.flatMap(result => result.rows);
  return {
    findings,
    reports: results.length,
    operations: rows.length,
    pass: rows.filter(row => row.status === "pass").length,
    unsupported: rows.filter(row => row.status === "unsupported").length,
    fail: rows.filter(row => row.status === "fail").length,
  };
}

function print(sections) {
  process.stdout.write(`${sections.filter(Boolean).join("\n\n")}\n`);
}

async function main(argv) {
  const options = parseArguments(argv);
  if (options.help) {
    print([USAGE]);
    return EXIT_VERIFIED;
  }

  const { capturePath } = options;
  const expectedIds = await loadExpectedOperations();

  let text;
  try {
    text = readFileSync(capturePath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CannotEvaluate(
      `cannot read the capture at ${capturePath}: ${message}. Nothing was verified;`
        + " point this at the log the run actually wrote.",
    );
  }

  const captures = extractCaptures(text);
  if (captures.length === 0) {
    throw new CannotEvaluate(
      `${capturePath} contains no ${MARKER} line, so there is nothing to verify.`
        + " The card did not log, or the capture came from a different console tag."
        + " This is not a pass: re-run the card and capture the line.",
    );
  }

  const parsed = parseCaptures(captures, capturePath);
  const results = parsed.map(capture => evaluateReport(capture, expectedIds, capturePath));
  const totals = summarize(results);
  const verified = totals.findings.length === 0;

  const heading = [
    "native parity verification",
    `  capture:    ${capturePath}`,
    `  checklist:  ${PARITY_MODULE_LABEL} (${expectedIds.length} operations)`,
    `  reports:    ${totals.reports}${totals.reports > 1
      ? " (one per marker line; none is dropped in favour of the last)"
      : ""}`,
    `  lines:      ${results.map(result => `${result.capture.thread} at line `
      + `${result.capture.lineNumber}`).join("; ")}`,
  ].join("\n");

  const tables = results.map((result, index) => {
    const title = `report ${index + 1} of ${results.length}`
      + ` — ${capturePath}:${result.capture.lineNumber}`
      + ` — thread ${result.capture.thread}`
      + ` — host ${labelOf(result.capture.report)}`;
    return [title, renderTable(result, expectedIds)].join("\n");
  });

  const detail = verified
    ? ""
    : ["findings", ...results
      .filter(result => result.findings.length > 0)
      .map(result => renderDetail(result, capturePath))].join("\n");

  const verdict = verified
    ? `verdict: verified — ${totals.pass} operation(s) pass`
      + `${totals.unsupported > 0 ? `, ${totals.unsupported} unsupported with a recorded reason` : ""}`
      + ` across ${totals.reports} captured report(s).`
    : `verdict: findings — ${totals.findings.length} problem(s) across`
      + ` ${totals.reports} captured report(s); this capture cannot back a parity claim.`;

  print([heading, ...tables, detail, verdict].filter(Boolean).map(section => `${section}`));
  return verified ? EXIT_VERIFIED : EXIT_FINDINGS;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  if (error instanceof CannotEvaluate) {
    process.stderr.write(`error: ${error.message}\n`);
    process.stdout.write(
      "verdict: could not evaluate — nothing was verified; this is not a pass.\n",
    );
    process.exitCode = EXIT_COULD_NOT_EVALUATE;
  } else {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    process.stderr.write(`error: unexpected failure verifying the capture: ${message}\n`);
    process.exitCode = EXIT_COULD_NOT_EVALUATE;
  }
}
