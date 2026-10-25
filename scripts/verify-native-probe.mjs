#!/usr/bin/env node
/**
 * Verify a captured native probe log against the stages its card is supposed to
 * emit.
 *
 * Two native cards log one JSON line per stage instead of a single report:
 *
 *   examples/lynx-for-native/src/stylesheet-probe.ts  `[solid-lynx ss]`
 *   examples/lynx-for-native/src/list-probe.ts        `[solid-lynx lp]`
 *
 * `docs/capabilities.md` says what each stage measures, and until this script
 * existed the only way to turn a captured log into a verdict was for a reader to
 * hold the stage table next to the file and compare. Prose is not evidence a
 * release can re-check, which is the whole reason `verify-native-parity.mjs`
 * exists for the smoke card. This is its sibling for the two probe cards, and it
 * is a sibling rather than a `--probe` mode so the parity path keeps its contract
 * byte for byte: that script still exits 2 on a capture carrying only
 * `[solid-lynx ss]` lines, and its own tests still assert that.
 *
 * What it checks, per card:
 *
 *   1. every required stage appears once, in the order the card emits it, on a
 *      line carrying the card's marker, and the JSON after the marker parses;
 *   2. each stage carries the fields that make its answer readable — the
 *      stylesheet card's mutating stage pointed at a real stylesheet while its
 *      missing-URL stage failed, the list card's `summary` records whether
 *      `enqueueComponent` was ever called (a zero is an answer, an omission is
 *      a finding), and both cards' `summary` states what was not exercised;
 *   3. the card's own derived claims agree with the fields they are derived
 *      from, which is how an edited capture is caught.
 *
 * What it does not do, deliberately: infer a signature. `fn.length` is the
 * number of parameters a binding reports, and a native binding can report any
 * number regardless of what it requires, so an `arity` field is evidence about
 * the binding and never a parameter list. The only thing this script asserts
 * about an arity is that a recorded one is a number. See `checkArityFields`.
 *
 * It reads a text file and nothing else: no device, no adb, no network, no
 * build. A capture that was cut short, mistyped, or assembled by hand is a
 * finding or an unreadable capture — never a pass.
 *
 * Like its parity sibling, the payload is not "everything after the marker". A
 * real capture is written by the Lynx console bridge, which wraps the card's
 * message in a double quote and prefixes the thread that logged it; the JSON is
 * the span from the first `{` after the marker to the last `}` on the line, and
 * the rest is framing. See `extractCaptures` and `unbalancedReason`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

/** Exit codes. The same discipline dagr, and the parity verifier, use. */
const EXIT_VERIFIED = 0;
const EXIT_FINDINGS = 1;
const EXIT_COULD_NOT_EVALUATE = 2;

const NODE_LABEL = path.posix.join("scripts", "verify-native-probe.mjs");
const PARITY_NODE_LABEL = path.posix.join("scripts", "verify-native-parity.mjs");

/**
 * The three stylesheet operations the card names.
 *
 * Literal, like the stage sets below, because these are the card's checklist and
 * the card is not compiled into `dist/`. `test/native-probe-verify.test.ts`
 * holds the literals here to the card by importing `STYLESHEET_PAPI_NAMES` and
 * `LIST_PAPI_NAMES` from the probe recorders and by reading the stage names out
 * of the two cards, so the two cannot drift apart silently.
 */
const STYLESHEET_OPERATIONS = Object.freeze([
  "__LoadStyleSheet",
  "__AdoptStyleSheet",
  "__ReplaceStyleSheets",
]);

/** The four list bindings the card inventories. Presence is measured, not assumed. */
const LIST_OPERATIONS = Object.freeze([
  "__CreateList",
  "__UpdateListCallbacks",
  "__UpdateListComponents",
  "__GetListComponents",
]);

const LIST_REQUIRED_STAGES = Object.freeze([
  "inventory",
  "create",
  "materialize",
  "reorder",
  "shrunk",
  "summary",
  "done",
]);

const STYLESHEET_REQUIRED_STAGES = Object.freeze([
  "inventory",
  "no-arguments",
  "load-missing-url",
  "load-real-url",
  "summary",
  "done",
]);

/**
 * The second stylesheet card's stages.
 *
 * It is a separate card rather than more stages on the first one because v1's
 * capture is the ground truth v2 reasons from, and a card whose stage set grew
 * would make the two captures incomparable. The names are `inventory-v2` for the
 * same reason: a capture mixing the two cards is caught by stage name as well as
 * by marker.
 */
const STYLESHEET_V2_REQUIRED_STAGES = Object.freeze([
  "inventory-v2",
  "loadstyle-arity",
  "adopt-arity",
  "replace-arity",
  "style-object-path",
  "lifecycle",
  "summary",
  "done",
]);

/**
 * The eight bounded `__LoadStyleSheet` cases the v2 card must attempt.
 *
 * Literal, like the operation names, and held to the card by
 * `test/native-probe-verify.test.ts`, which imports `loadStyleSheetCases` and
 * reads the labels out of it. The checker does not care what the labels say, only
 * that eight distinct cases were attempted: a v2 capture that quietly dropped the
 * `[url, url2]` case would be answering a narrower question than the card claims.
 */
const STYLESHEET_V2_LOAD_CASE_COUNT = 8;

const CARDS = Object.freeze({
  stylesheet: {
    key: "stylesheet",
    card: "stylesheet",
    marker: "[solid-lynx ss]",
    probe: "native-stylesheet-papi",
    bundle: "stylesheet-probe.lynx.bundle",
    stages: STYLESHEET_REQUIRED_STAGES,
    operations: STYLESHEET_OPERATIONS,
    checks: {
      inventory: checkStylesheetInventory,
      "no-arguments": checkStylesheetNoArguments,
      "load-missing-url": checkStylesheetMissingUrl,
      "load-real-url": checkStylesheetRealUrl,
      summary: checkStylesheetSummary,
      done: checkDone,
    },
  },
  list: {
    key: "list",
    card: "list",
    marker: "[solid-lynx lp]",
    probe: "native-list-papi",
    bundle: "list-probe.lynx.bundle",
    stages: LIST_REQUIRED_STAGES,
    operations: LIST_OPERATIONS,
    checks: {
      inventory: checkListInventory,
      create: checkListCreate,
      materialize: checkListMaterialize,
      reorder: checkListReorder,
      shrunk: checkListShrunk,
      summary: checkListSummary,
      done: checkDone,
    },
  },
  stylesheet2: {
    key: "stylesheet2",
    card: "stylesheet-v2",
    marker: "[solid-lynx ss2]",
    probe: "native-stylesheet-papi-v2",
    bundle: "stylesheet-probe-v2.lynx.bundle",
    stages: STYLESHEET_V2_REQUIRED_STAGES,
    operations: STYLESHEET_OPERATIONS,
    checks: {
      "inventory-v2": checkStylesheetV2Inventory,
      "loadstyle-arity": checkStylesheetV2LoadArity,
      "adopt-arity": checkStylesheetV2OtherArity,
      "replace-arity": checkStylesheetV2OtherArity,
      "style-object-path": checkStylesheetV2StyleObject,
      lifecycle: checkStylesheetV2Lifecycle,
      summary: checkStylesheetV2Summary,
      done: checkDone,
    },
  },
});

/**
 * Card order for extraction, longest marker first.
 *
 * `[solid-lynx ss2]` starts with `[solid-lynx ss]`, so checking the shorter marker
 * first would classify every v2 line as v1 with a payload of `2] {...}`. Ordering
 * by length makes that impossible rather than relying on the shorter marker's
 * payload failing to parse.
 */
const CARD_ORDER = ["stylesheet2", "stylesheet", "list"];

/**
 * The thread tag the console bridge puts in front of a logged message.
 *
 * A card can log from the main thread or from the background thread. Each tagged
 * line is one stage report; the stage rules below are unchanged by which thread
 * wrote it.
 */
const THREAD_TAG = /\[(main-thread|background)\.js\]/g;

const USAGE = `verify-native-probe — check a captured native probe log

Usage:
  node ${NODE_LABEL} <capture.log>
  node ${NODE_LABEL} --help

What it does
  Two cards log one JSON line per stage instead of one report per run. A fixture
  can hold a stage line bare:

    [solid-lynx ss] {"probe":"native-stylesheet-papi","stage":"inventory",...}
    [solid-lynx lp] {"probe":"native-list-papi","stage":"inventory",...}

  A real capture cannot, because Lynx Explorer writes console output through the
  native console bridge, which wraps the message in double quotes and prefixes
  the thread that logged it:

    10-25 08:41:42.002  5650  5685 I lynx    : [715D09544CF0:INFO:lynx_console.cc(230)] "[main-thread.js] [solid-lynx ss] {...}"

  So a real line is logcat columns, an opening quote, a \`[main-thread.js] \` or
  \`[background.js] \` prefix, the marker, the JSON, then a closing quote.

  A run is recorded by keeping those lines in a log file. This script then
  (\`<capture.log>\` may be a logcat dump or a file holding only the stage lines):

  1. extracts every line carrying one of the two markers and parses the JSON on
     it, once per stage. The payload is the span from the first \`{\` after the
     marker to the last \`}\` on the line; the logcat columns, the bridge's
     wrapping quotes, the thread prefix, and trailing whitespace are framing.

     Truncation is decided by scanning that span for an unbalanced brace or an
     unterminated string before JSON.parse runs, never by whether the line ends
     with \`}\` — a real capture ends with the bridge's closing quote, so the only
     honest truncation signal is an unbalanced payload;

  2. labels every stage with the thread that logged it. A card may log from the
     main thread and the background thread, and two lines carrying one stage is
     two reports, not one: the duplicate is reported rather than collapsed to
     the last line;
  3. checks each card's required stages are all present, exactly once each, in
     the order the card emits them:

       stylesheet  inventory, no-arguments, load-missing-url, load-real-url,
                   summary, done
       list        inventory, create, materialize, reorder, shrunk, summary, done

     (a stage the card emitted that this list does not know is reported as an
     extra and is not a finding, so a newer card still verifies);
  4. checks the fields that make each stage's answer readable:
       - stylesheet: the missing-URL stage called __LoadStyleSheet and threw,
         the next stage called it with a different, absolute URL and returned,
         and \`summary.unmeasured\` names what was not exercised;
       - list: \`materialize\` keeps "the host asked for this row" apart from
         "the probe materialized this row", and \`shrunk\`/\`summary\` record
         whether enqueueComponent was ever called — a recorded 0 is an answer,
         a missing answer is a finding;
  5. checks the card's own derived fields against the fields they are derived
     from, so an edited capture is caught rather than believed.

  It does not infer a signature. \`fn.length\` is the parameter count a
  binding reports; a native binding can report any number regardless of what it
  requires, so an \`arity\` field is recorded evidence about the binding and is
  never read as a parameter list. The only assertion made about an arity is that
  a recorded one is a number.

  The marker decides which card a line belongs to, and a capture may hold both
  cards' stages — a session that opened both bundles produces exactly that. Each
  card is evaluated on its own and the capture as a whole is a finding if any
  card in it is.

Exit codes
  0  verified        every card present in the capture has all of its required
                     stages, in order, with readable answers
  1  findings        the capture was read and contradicts itself or the card: a
                     missing, duplicated, or out-of-order stage, a stage that
                     does not carry the field it needs, a mutating stage that
                     never reached the real stylesheet, a list capture that never
                     answers the recycling question, or a derived field that
                     disagrees with the fields it is derived from
  2  could not evaluate
                     there was nothing to evaluate, or nothing trustworthy to
                     read: an unreadable file, a capture with neither marker, a
                     marker with no JSON after it, JSON that does not parse, or a
                     line that parses but is not a stage report

  These follow the same discipline as dagr and ${PARITY_NODE_LABEL}:
  0 means the artefact is clean, 1 means it was read and has findings, 2 means it
  could not be read. A 2 is never a clean result and must not be cited as a pass.

What this cannot do
  It reads the capture's own record. It cannot tell whether a device was
  attached, and it cannot tell a real capture from a well-formed synthetic one:
  point it at test/fixtures/native-probe/stylesheet-good.log and it exits 0. The
  fixtures are labelled as fixtures for that reason. What it does make impossible
  is citing a capture that is missing a stage, disagrees with itself, or never
  answered the question the stage exists to answer.

Capture recipe
  pnpm native:build
  examples/lynx-for-native/scripts/run-native-probe.sh stylesheet
  node ${NODE_LABEL} /tmp/solid-lynx-logs/lynx_console-stylesheet-<stamp>.log

  Keep the capture next to whatever record cites it. A verdict without the log
  it came from is a claim, not evidence.
`;

class CannotEvaluate extends Error {}

function usageError(message) {
  return new CannotEvaluate(`${message}\n\nRun \`node ${NODE_LABEL} --help\` for usage.`);
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

/* --------------------------------------------------------- payload extraction
 *
 * The console bridge's framing is the same for both cards, and it is the shape
 * this script originally missed. Lynx Explorer writes a card's `console.log` as
 * one logcat line:
 *
 *   10-25 08:41:42.002  5650  5685 I lynx    : [715D09544CF0:INFO:lynx_console.cc(230)] "[main-thread.js] [solid-lynx ss] {...}"
 *   |____________ logcat columns _____________________|   |__ thread tag __| |____ marker ___|  |JSON|  |
 *                                                        ^                                       ^        ^
 *                                                        bridge's opening quote                  payload  bridge's closing quote
 *
 * The rules that follow from it:
 *
 *   1. The payload is the span from the first `{` after the marker to the last
 *      `}` on the line. Everything outside it is framing: the logcat columns,
 *      the bridge's wrapping `"`, a `[main-thread.js] ` or `[background.js] `
 *      prefix, and trailing whitespace. A synthetic line with a bare marker
 *      extracts the same span, so both shapes parse.
 *   2. The JSON check is not loosened: the span goes to JSON.parse as-is.
 *   3. Truncation is measured by scanning the span for an unbalanced brace or an
 *      unterminated string, before JSON.parse, because "the line does not end
 *      with `}`" cannot distinguish the bridge's closing quote from a lost tail.
 *   4. A marker on more than one line is more than one report. A card that logs
 *      the same stage from the main thread and the background thread has logged
 *      two stages, and the existing `duplicate-stage` rule reports that — it is
 *      never silently collapsed to the last line.
 */

/**
 * The thread that logged a line, from the tag the bridge puts ahead of the
 * marker. The last such tag before the marker wins, so an unrelated bracket in
 * the logcat columns cannot be read as the thread.
 */
function threadOf(line, markerAt) {
  const before = line.slice(0, markerAt);
  const tags = [...before.matchAll(THREAD_TAG)];
  return tags.length === 0 ? "(unthreaded)" : `${tags[tags.length - 1][1]}.js`;
}

/**
 * The first way a payload span cannot be a complete JSON value, or `null` when
 * it is balanced.
 *
 * A scan, not a parse: it runs before JSON.parse so a genuinely truncated line
 * reports truncation rather than a generic parse error, and it reads the span
 * the way a JSON tokenizer would — brackets stack, and a quote opens a string
 * unless it is escaped inside one.
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
 * Every line carrying a probe marker, with the payload span and the framing
 * around it.
 *
 * A line carrying both markers cannot happen with these cards (each card writes
 * one prefix), so the first marker found decides; the payload's own `probe`
 * field is checked against that card afterwards, which is what catches a line
 * whose prefix and payload disagree.
 */
function extractCaptures(text) {
  const lines = text.split(/\r?\n/);
  const captures = [];
  lines.forEach((line, index) => {
    for (const key of CARD_ORDER) {
      const card = CARDS[key];
      const at = line.indexOf(card.marker);
      if (at < 0) continue;
      const markerEnd = at + card.marker.length;
      const openAt = line.indexOf("{", markerEnd);
      const closeAt = openAt < 0 ? -1 : line.lastIndexOf("}");
      const hasClosingBrace = openAt >= 0 && closeAt >= openAt;
      captures.push({
        lineNumber: index + 1,
        card: key,
        marker: card.marker,
        thread: threadOf(line, at),
        // When the closing brace is missing the payload runs to the end of the
        // line, so the balance scan can say what is still open.
        payload: openAt < 0
          ? ""
          : hasClosingBrace ? line.slice(openAt, closeAt + 1) : line.slice(openAt),
        // The text after the marker with the payload cut out of it: the
        // bridge's quotes, a thread tag left after the marker, whitespace.
        framing: openAt < 0
          ? line.slice(markerEnd)
          : line.slice(markerEnd, openAt)
            + (hasClosingBrace ? line.slice(closeAt + 1) : ""),
        hasOpeningBrace: openAt >= 0,
        hasClosingBrace,
        line,
      });
      return;
    }
  });
  return captures;
}

/** Parses every capture, or throws because the capture cannot be evaluated. */
function parseCaptures(captures, capturePath) {
  return captures.map(capture => {
    const where = `${capturePath}:${capture.lineNumber}`;

    if (!capture.hasOpeningBrace) {
      const after = capture.framing.trim();
      throw new CannotEvaluate(
        `${where}: the ${capture.marker} marker is there but no JSON follows it: the line`
          + ` has no \`{\` after the marker${after === "" ? "" : ` (it carries ${describeValue(
            after.length > 40 ? `${after.slice(0, 39)}…` : after)})`}. Run the card again`
          + " and capture the whole line; nothing was verified.",
      );
    }

    if (!capture.hasClosingBrace) {
      throw new CannotEvaluate(
        `${where}: the JSON after ${capture.marker} does not parse because it is`
          + ` truncated: the \`{\` after the marker is never closed`
          + ` (${unbalancedReason(capture.payload) ?? "no closing brace remains on the line"}).`
          + " The line is truncated: a complete stage balances its braces, so the capture"
          + " stopped early or the console bridge dropped the tail. Nothing was verified;"
          + " a capture that cannot be parsed is not a result.",
      );
    }

    // The scan comes before the parse so that a real truncation is named as one.
    // A span whose braces balance but which JSON still rejects is malformed, not
    // truncated, and saying so keeps the two failures apart.
    const unbalanced = unbalancedReason(capture.payload);
    if (unbalanced !== null) {
      throw new CannotEvaluate(
        `${where}: the JSON after ${capture.marker} does not parse because it is`
          + ` truncated: ${unbalanced}. The line is truncated: a complete stage balances`
          + " its braces, and the console bridge drops everything after the first"
          + " newline, so a line that stops early looks like this. Nothing was verified;"
          + " a capture that cannot be parsed is not a result.",
      );
    }

    let stage;
    try {
      stage = JSON.parse(capture.payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CannotEvaluate(
        `${where}: the JSON after ${capture.marker} does not parse (${message}). Its`
          + " braces balance, so this is not a truncation: the payload is malformed."
          + " Nothing was verified; a capture that cannot be parsed is not a result.",
      );
    }

    if (!isPlainObject(stage) || typeof stage.stage !== "string" || stage.stage.trim() === "") {
      throw new CannotEvaluate(
        `${where}: the JSON after ${capture.marker} parses but is not a probe stage`
          + " (expected an object with a string `stage`). Nothing was verified.",
      );
    }

    return { ...capture, stage };
  });
}

/**
 * Collects findings for one card, with the stage each one belongs to.
 *
 * Findings are data, not exceptions: they are the reason this exits 1.
 */
function collector(capturePath) {
  const findings = [];
  return {
    findings,
    add(kind, message, stage) {
      findings.push({ kind, message, stage, where: capturePath });
    },
  };
}

/* ---------------------------------------------------------------- field checks
 *
 * Small predicates over the capture's own JSON. Each one names the stage and the
 * field in the finding, because a reader who has to guess which field was wrong
 * will go and read the file by eye — which is what this script replaces.
 */

function expectObject(out, stage, field, value) {
  if (!isPlainObject(value)) {
    out.add(
      "missing-field",
      `\`${stage}.${field}\` must be an object, got ${describeValue(value)}.`,
      stage,
    );
    return undefined;
  }
  return value;
}

function expectArray(out, stage, field, value) {
  if (!Array.isArray(value)) {
    out.add(
      "missing-field",
      `\`${stage}.${field}\` must be an array, got ${describeValue(value)}.`,
      stage,
    );
    return undefined;
  }
  return value;
}

function expectBoolean(out, stage, field, value) {
  if (typeof value !== "boolean") {
    out.add(
      "missing-field",
      `\`${stage}.${field}\` must be a boolean, got ${describeValue(value)}.`
        + " A capture that leaves it out does not record the answer.",
      stage,
    );
    return undefined;
  }
  return value;
}

function expectNumber(out, stage, field, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    out.add(
      "missing-field",
      `\`${stage}.${field}\` must be a finite number, got ${describeValue(value)}.`,
      stage,
    );
    return undefined;
  }
  return value;
}

function expectText(out, stage, field, value) {
  if (!isText(value)) {
    out.add(
      "missing-field",
      `\`${stage}.${field}\` must be a non-empty string, got ${describeValue(value)}.`,
      stage,
    );
    return undefined;
  }
  return value;
}

function expectTextArray(out, stage, field, value) {
  const array = expectArray(out, stage, field, value);
  if (array === undefined) return undefined;
  if (array.some(entry => !isText(entry))) {
    out.add(
      "missing-field",
      `\`${stage}.${field}\` must hold only non-empty strings, got ${describeValue(value)}.`,
      stage,
    );
    return undefined;
  }
  return array;
}

/** The host-call counters a list stage records, or `undefined` if unreadable. */
function expectHostCalls(out, stage, value) {
  const counters = expectObject(out, stage, "hostCallCounts", value);
  if (counters === undefined) return undefined;
  const componentAtIndex = expectNumber(out, stage, "hostCallCounts.componentAtIndex",
    counters.componentAtIndex);
  const enqueueComponent = expectNumber(out, stage, "hostCallCounts.enqueueComponent",
    counters.enqueueComponent);
  if (componentAtIndex === undefined || enqueueComponent === undefined) return undefined;
  return counters;
}

/**
 * An `arity` is a number, and that is the whole check.
 *
 * `arity` is `fn.length`, the declared parameter count the runtime reports. A
 * native binding can report any arity regardless of what it actually requires,
 * so an arity is evidence about the binding, never a signature. No check in this
 * file compares an arity with a parameter count, with a call's argument count, or
 * with any expected value: turning `fn.length` into an expected arity is exactly
 * the inference these cards were written to avoid, and a verifier that did it
 * would manufacture a contract the device never offered.
 *
 * What is worth checking is narrower: a capture that wrote `"arity":"two"`, or
 * an object, or a negative number, did not record what it says it recorded. It
 * says nothing about whether the binding's arity is right, because there is no
 * right arity to compare against.
 */
function checkArityFields(out, stage, entry, where) {
  const arity = entry.arity;
  if (arity === undefined) return;
  if (typeof arity !== "number" || !Number.isFinite(arity) || arity < 0) {
    out.add(
      "unreadable-arity",
      `\`${stage}.${where}.arity\` must be a number, got ${describeValue(arity)}.`
        + " An arity is recorded evidence about a binding, not a signature, so there is"
        + " nothing else it can be checked against.",
      stage,
    );
  }
}

/** Whether a value looks like an absolute http(s) URL. */
function isHttpUrl(value) {
  return isText(value) && /^https?:\/\/[^\s]+$/i.test(value.trim());
}

/** The last call recorded on an operation, which is the one its stage made. */
function lastCall(operation) {
  if (!isPlainObject(operation) || !Array.isArray(operation.calls)) return undefined;
  return operation.calls.length === 0 ? undefined : operation.calls[operation.calls.length - 1];
}

/** The first argument a call recorded, described, or `undefined`. */
function firstArgument(call) {
  if (!isPlainObject(call) || !Array.isArray(call.input)) return undefined;
  return call.input[0];
}

/** The string value of the first argument, when it is a plain string. */
function firstArgumentString(call) {
  const argument = firstArgument(call);
  if (!isPlainObject(argument) || argument.kind !== "string") return undefined;
  return typeof argument.value === "string" ? argument.value : undefined;
}

/** An operation entry by name, from a stage that reports \`operations\`. */
function operationNamed(stage, name) {
  if (!Array.isArray(stage.operations)) return undefined;
  return stage.operations.find(entry => isPlainObject(entry) && entry.name === name);
}

/* ------------------------------------------------------------- stage checks
 *
 * One function per required stage. Each reads only the fields that stage emits
 * (see the cards) and reports what is absent or contradictory. A stage with no
 * function here — \`done\` is the only one — is checked for its marker fields and
 * nothing else.
 */

function checkDone(out, stage) {
  expectText(out, stage.stage, "status", stage.status);
}

function checkStylesheetInventory(out, stage, card) {
  const operations = expectArray(out, stage.stage, "operations", stage.operations);
  expectTextArray(out, stage.stage, "relatedGlobals", stage.relatedGlobals);
  if (operations === undefined) return;

  for (const name of card.operations) {
    const entry = operationNamed(stage, name);
    if (entry === undefined) {
      out.add(
        "missing-operation",
        `\`inventory\` does not describe ${name}. The card records all`
          + ` ${card.operations.length} of its bindings before it calls any of them, so a`
          + " capture without it is not this card's inventory.",
        stage.stage,
      );
      continue;
    }
    const described = expectObject(out, stage.stage, `operations[${name}].function`,
      entry.function);
    if (described !== undefined) {
      expectText(out, stage.stage, `operations[${name}].function.typeof`, described.typeof);
      checkArityFields(out, stage.stage, described, `operations[${name}].function`);
    }
  }
}

function checkStylesheetNoArguments(out, stage, card) {
  const operations = expectArray(out, stage.stage, "operations", stage.operations);
  if (operations === undefined) return;

  for (const name of card.operations) {
    const entry = operationNamed(stage, name);
    if (entry === undefined) {
      out.add(
        "missing-operation",
        `\`no-arguments\` does not report ${name}, so the capture does not record that`
          + " the binding was called with no arguments.",
        stage.stage,
      );
      continue;
    }
    const calls = expectArray(out, stage.stage, `operations[${name}].calls`, entry.calls);
    if (calls !== undefined && calls.length === 0) {
      out.add(
        "missing-call",
        `\`no-arguments\` reports ${name} with no calls. The stage exists to record what`
          + " the binding does when it cannot succeed, and an empty call list records nothing.",
        stage.stage,
      );
    }
  }
}

function checkStylesheetMissingUrl(out, stage, card) {
  const name = "__LoadStyleSheet";
  const entry = operationNamed(stage, name);
  if (entry === undefined) {
    out.add("missing-operation",
      `\`load-missing-url\` does not report ${name}.`, stage.stage);
    return;
  }
  const call = lastCall(entry);
  if (call === undefined) {
    out.add("missing-call",
      `\`load-missing-url\` reports ${name} with no calls, so it did not attempt the load.`,
      stage.stage);
    return;
  }
  const url = firstArgumentString(call);
  if (!isHttpUrl(url)) {
    out.add(
      "missing-field",
      "`load-missing-url` did not record an absolute http(s) URL as the load's first"
        + ` argument, got ${describeValue(firstArgument(call))}. Without the URL the`
        + " capture does not say what the load was pointed at.",
      stage.stage,
    );
  }
  const threw = call.threw;
  if (!isPlainObject(threw) || !isText(threw.name)) {
    out.add(
      "load-did-not-fail",
      "`load-missing-url` records no `threw` on its call, so the load pointed at an"
        + " unresolvable path did not fail. This stage's whole value is that the load"
        + " cannot succeed; a call that returned instead says the URL resolved, or that"
        + " the argument was ignored.",
      stage.stage,
    );
  }
}

function checkStylesheetRealUrl(out, stage, card, context) {
  const name = "__LoadStyleSheet";
  const entry = operationNamed(stage, name);
  if (entry === undefined) {
    out.add("missing-operation",
      `\`load-real-url\` does not report ${name}.`, stage.stage);
    return;
  }
  const call = lastCall(entry);
  if (call === undefined) {
    out.add("missing-call",
      `\`load-real-url\` reports ${name} with no calls, so the mutating stage never ran.`,
      stage.stage);
    return;
  }
  const url = firstArgumentString(call);
  if (!isHttpUrl(url)) {
    out.add(
      "missing-field",
      "`load-real-url` did not record an absolute http(s) URL as the load's first"
        + ` argument, got ${describeValue(firstArgument(call))}.`,
      stage.stage,
    );
  }

  // The card's calls accumulate on the operation across stages, so the call this
  // stage made is the last one in the array (stylesheet-probe.ts pushes onto
  // `record("__LoadStyleSheet").calls`). Comparing it with the URL the previous
  // stage recorded is what shows the mutating stage was pointed somewhere else.
  const missingUrl = context.stylesheetMissingUrl;
  if (url !== undefined && missingUrl !== undefined && url === missingUrl) {
    out.add(
      "same-target",
      `\`load-real-url\` loaded ${describeValue(url)}, the same URL the failing stage`
        + " used. The two stages exist to separate a URL that cannot resolve from one"
        + " that does, so a capture where they agree does not record that separation.",
      stage.stage,
    );
  }

  if (isPlainObject(call.threw)) {
    out.add(
      "load-real-url-threw",
      `\`load-real-url\` threw (${describeValue(call.threw.name)}:`
        + ` ${describeValue(call.threw.message)}), so the capture does not record a load`
        + " that reached the served stylesheet.",
      stage.stage,
    );
  } else if (call.returned === undefined) {
    out.add(
      "missing-field",
      "`load-real-url` records neither `returned` nor `threw` for its call, so it does"
        + " not record what the mutating load did.",
      stage.stage,
    );
  }
}

/**
 * The `unmeasured` claim, checked for shape and not for wording.
 *
 * What the card says it did not exercise is a claim the verifier can check only
 * for being present and readable: the wording belongs to the card, and a checker
 * that pinned the wording would fail every time the card's prose improved. An
 * empty or unreadable `unmeasured` is different — it is a capture that asserts
 * nothing, and a summary that asserts nothing cannot stop the report being read
 * as a claim about operations that were never exercised.
 */
function checkUnmeasured(out, stage) {
  const unmeasured = expectArray(out, stage.stage, "unmeasured", stage.unmeasured);
  if (unmeasured === undefined) return;
  if (unmeasured.length === 0) {
    out.add(
      "empty-unmeasured",
      "`summary.unmeasured` is empty. The card always states what it did not exercise"
        + " (no wording is required, but the list cannot be empty), so an empty list"
        + " means the capture was edited or truncated.",
      stage.stage,
    );
    return;
  }
  unmeasured.forEach((entry, index) => {
    if (!isPlainObject(entry)) {
      out.add(
        "missing-field",
        `\`summary.unmeasured[${index}]\` must be an object with \`operation\` and`
          + ` \`reason\`, got ${describeValue(entry)}.`,
        stage.stage,
      );
      return;
    }
    expectText(out, stage.stage, `unmeasured[${index}].operation`, entry.operation);
    expectText(out, stage.stage, `unmeasured[${index}].reason`, entry.reason);
  });
}

function checkStylesheetSummary(out, stage) {
  expectArray(out, stage.stage, "operations", stage.operations);
  checkUnmeasured(out, stage);
}

/* ------------------------------------------------------------ the v2 card
 *
 * The v2 card answers a different question from the v1 one: it attempts a bounded
 * list of argument shapes for `__LoadStyleSheet` and reports each outcome, rather
 * than asserting that a load reached a stylesheet. The checks below therefore test
 * *that the bounded list was really attempted and really recorded*, and never that
 * any particular attempt succeeded. A v2 capture where all eight cases threw the
 * same error is a complete, correct answer — that is the finding the card exists
 * to record — so treating an all-threw capture as a finding would invert the
 * card's purpose.
 */

function isAttemptList(value) {
  if (!Array.isArray(value)) return false;
  return value.every(entry => isPlainObject(entry)
    && isText(entry.label)
    && (entry.outcome === "returned" || entry.outcome === "threw")
    && (isPlainObject(entry.threw) || isPlainObject(entry.returned)));
}

function checkBoundedAttempts(out, stage, field, expected) {
  const attempts = expectArray(out, stage.stage, field, stage[field]);
  if (attempts === undefined) return undefined;

  if (!isAttemptList(attempts)) {
    out.add(
      "unreadable-attempt",
      `\`${stage.stage}.${field}\` holds an entry that is not a recorded attempt: every`
        + " entry needs a `label`, an \`outcome\` of returned/threw, and the `threw` or"
        + " `returned` it produced. Without both halves the capture does not say what was"
        + " tried or what came back.",
      stage.stage,
    );
    return attempts;
  }

  if (expected !== undefined && attempts.length !== expected) {
    out.add(
      "wrong-attempt-count",
      `\`${stage.stage}.${field}\` records ${attempts.length} attempt(s) where the card`
        + ` attempts ${expected}. The bounded list is the experiment; a capture with fewer`
        + " cases answers a narrower question than the one the card claims to ask.",
      stage.stage,
    );
  }

  // The label is what makes an all-threw capture readable, so two identical labels
  // mean the capture cannot say which case produced which answer.
  const labels = attempts.filter(isPlainObject).map(entry => entry.label);
  if (new Set(labels).size !== labels.length) {
    out.add(
      "duplicate-attempt-label",
      `\`${stage.stage}.${field}\` repeats a case label, so its attempts cannot be told`
        + " apart.",
      stage.stage,
    );
  }

  return attempts;
}

function checkStylesheetV2Inventory(out, stage, card) {
  const globals = expectArray(out, stage.stage, "globals", stage.globals);
  const sources = expectObject(out, stage.stage, "sources", stage.sources);
  const shapes = expectObject(out, stage.stage, "shapes", stage.shapes);
  if (globals === undefined) return;

  // `names` is present in the full form and replaced by `namesOmitted` in the lean
  // one, when the discovered names would not fit the delivered-line budget. Every
  // name is a `globals` entry either way, so the inventory itself is not reduced.
  if (stage.names !== undefined) {
    expectTextArray(out, stage.stage, "names", stage.names);
  } else if (typeof stage.namesOmitted !== "number") {
    out.add(
      "missing-field",
      "`inventory-v2` records neither `names` nor `namesOmitted`, so the capture does"
        + " not say how many style globals the host's discovery returned.",
      stage.stage,
    );
  }

  for (const name of card.operations) {
    const entry = globals.find(candidate =>
      isPlainObject(candidate) && candidate.name === name);
    if (entry === undefined) {
      out.add(
        "missing-operation",
        `\`inventory-v2\` does not describe ${name}. The card describes every style-named`
          + " global before it calls any of them, so a capture without it is not this"
          + " card's inventory.",
        stage.stage,
      );
      continue;
    }
    expectText(out, stage.stage, `globals[${name}].typeof`, entry.typeof);
    checkArityFields(out, stage.stage, entry, `globals[${name}]`);
    // An interned key has to resolve, or the exact `String(fn)` (or the name and
    // own-property set) is lost from the capture while the line still looks
    // complete. Interning is what keeps this line inside the delivered-size budget,
    // so a dangling key is the failure it introduced.
    if (isText(entry.source) && sources !== undefined && !(entry.source in sources)) {
      out.add(
        "unresolved-source",
        `\`inventory-v2\` says ${name} came from source ${describeValue(entry.source)},`
          + " which `sources` does not define. The interned text is the only verbatim"
          + " copy of the binding's source in the capture.",
        stage.stage,
      );
    }
    if (isText(entry.shape) && shapes !== undefined) {
      const shape = shapes[entry.shape];
      if (!isPlainObject(shape)) {
        out.add(
          "unresolved-shape",
          `\`inventory-v2\` says ${name} has shape ${describeValue(entry.shape)}, which`
            + " `shapes` does not define. The interned shape is the only copy of the"
            + " binding's name and own property names in the capture.",
          stage.stage,
        );
      } else if (!Array.isArray(shape.own) || typeof shape.fnName !== "string"
        || typeof shape.hasPrototype !== "boolean") {
        // `fnName` is allowed to be empty: v1's device capture records `name: ""`
        // for every native binding, so requiring a non-empty string here would
        // reject the very shape the engine produces.
        out.add(
          "unreadable-shape",
          "`shapes[" + entry.shape + "]` must hold a string `fnName` (empty is"
            + " normal for a native binding), a boolean `hasPrototype`, and an"
            + " `own` array.",
          stage.stage,
        );
      }
    }
  }
}

/**
 * An interned error key has to resolve.
 *
 * The card interns repeated error text so the stage line fits the budget the
 * console bridge delivers, which means an attempt can carry `message: "e0"`
 * instead of the engine's words. If `errors` does not define that key, the
 * capture has lost the only verbatim statement of what the host said while still
 * looking complete — the exact failure interning introduced.
 */
function checkInternedErrors(out, stage, attempts) {
  if (!Array.isArray(attempts)) return;
  const errors = stage.errors;
  if (!isPlainObject(errors)) {
    // The full form always carries the table; a capture without it is only
    // acceptable when no attempt carries an interned key.
    const interned = attempts.some(entry =>
      isPlainObject(entry?.threw) && isText(entry.threw.message)
      && /^e\d+$/.test(entry.threw.message));
    if (interned) {
      out.add(
        "missing-field",
        `\`${stage.stage}\` references an interned error but carries no \`errors\` table,`
          + " so the engine's message is not in the capture.",
        stage.stage,
      );
    }
    return;
  }

  for (const [index, entry] of attempts.entries()) {
    if (!isPlainObject(entry?.threw)) continue;
    const message = entry.threw.message;
    if (!isText(message) || !/^e\d+$/.test(message)) continue;
    if (!(message in errors) || !isText(errors[message])) {
      out.add(
        "unresolved-error",
        `\`${stage.stage}.attempts[${index}]\` references error ${describeValue(message)},`
          + " which `errors` does not define. The interned text is the only verbatim copy"
          + " of what the host said.",
        stage.stage,
      );
    }
  }
}

function checkStylesheetV2LoadArity(out, stage) {
  const attempts = checkBoundedAttempts(out, stage, "attempts",
    STYLESHEET_V2_LOAD_CASE_COUNT);
  checkInternedErrors(out, stage, stage.attempts);
  expectArray(out, stage.stage, "groups", stage.groups);
  expectNumber(out, stage.stage, "returnedHandles", stage.returnedHandles);

  const listed = Array.isArray(stage.attempts) ? stage.attempts : [];
  const returned = listed.filter(entry => isPlainObject(entry)
    && entry.outcome === "returned").length;
  void attempts;
  if (typeof stage.returnedHandles === "number" && stage.returnedHandles > returned) {
    out.add(
      "handle-count-exceeds-returns",
      `\`loadstyle-arity\` reports ${stage.returnedHandles} handle(s) from ${returned}`
        + " returning attempt(s). A handle can only come from a call that returned, so the"
        + " count and the attempts disagree about what the host handed out.",
      stage.stage,
    );
  }
}

function checkStylesheetV2OtherArity(out, stage) {
  checkBoundedAttempts(out, stage, "attempts", undefined);
  checkInternedErrors(out, stage, stage.attempts);
  expectArray(out, stage.stage, "groups", stage.groups);
  expectNumber(out, stage.stage, "returnedHandles", stage.returnedHandles);
  // `handleAvailable` (adopt) and `setAvailable` (replace) say whether the case
  // that needs a real object could run at all. That distinction is the difference
  // between "the host rejected this handle" and "this card never had one", so it
  // has to be a recorded boolean rather than left to be read off the labels.
  for (const field of ["handleAvailable", "setAvailable"]) {
    if (stage[field] !== undefined) {
      expectBoolean(out, stage.stage, field, stage[field]);
    }
  }
  if (stage.handleAvailable === undefined && stage.setAvailable === undefined) {
    out.add(
      "missing-field",
      `\`${stage.stage}\` records neither \`handleAvailable\` nor \`setAvailable\`, so`
        + " the capture does not say whether the case needing a real object could run.",
      stage.stage,
    );
  }
}

function checkStylesheetV2StyleObject(out, stage) {
  if (typeof stage.exposed !== "boolean") {
    out.add(
      "missing-field",
      "`style-object-path` does not record whether __CreateStyleObject is exposed"
        + " (`exposed` must be a boolean). "
        + `Got ${describeValue(stage.exposed)}.`,
      stage.stage,
    );
    return;
  }

  // A host with no style-object constructor is a complete answer, and the card
  // says so without attempting anything. Nothing further is required of it.
  if (stage.exposed === false) return;

  checkBoundedAttempts(out, stage, "attempts", undefined);
  expectText(out, stage.stage, "handleKind", stage.handleKind);
  expectText(out, stage.stage, "handleTypeof", stage.handleTypeof);
  const followUps = expectArray(out, stage.stage, "followUps", stage.followUps);
  if (followUps === undefined) return;

  for (const [index, followUp] of followUps.entries()) {
    if (!isPlainObject(followUp)) {
      out.add(
        "missing-field",
        `\`style-object-path.followUps[${index}]\` must be an object, got`
          + ` ${describeValue(followUp)}.`,
        stage.stage,
      );
      continue;
    }
    expectText(out, stage.stage, `followUps[${index}].name`, followUp.name);
    checkBoundedAttempts(out, {
      stage: `${stage.stage}.${followUp.name}`,
      attempts: followUp.attempts,
    }, "attempts", undefined);
  }

  // The one inference this card must never make: calling a setter with a value the
  // card did not receive. `followUpsSkipped` is where the card says it declined;
  // an empty follow-up list without that explanation is a gap, not an answer.
  if (followUps.length === 0 && !isText(stage.followUpsSkipped)) {
    out.add(
      "missing-field",
      "`style-object-path` called no setter and does not say why. Either record the"
        + " calls, or record `followUpsSkipped` explaining that no handle this card created"
        + " was available to pass one.",
      stage.stage,
    );
  }
}

function checkStylesheetV2Lifecycle(out, stage) {
  expectNumber(out, stage.stage, "callsThatReturned", stage.callsThatReturned);
  expectBoolean(out, stage.stage, "anyHandleReturned", stage.anyHandleReturned);
  const readbacks = expectArray(out, stage.stage, "readbacks", stage.readbacks);
  if (readbacks !== undefined) {
    readbacks.forEach((entry, index) => {
      if (!isPlainObject(entry)) {
        out.add(
          "missing-field",
          `\`lifecycle.readbacks[${index}]\` must be an object, got ${describeValue(entry)}.`,
          stage.stage,
        );
        return;
      }
      expectText(out, stage.stage, `readbacks[${index}].name`, entry.name);
      if (typeof entry.exposed !== "boolean") {
        out.add(
          "missing-field",
          `\`lifecycle.readbacks[${index}].exposed\` must be a boolean, got`
            + ` ${describeValue(entry.exposed)}.`,
          stage.stage,
        );
      }
    });
  }

  // A lifecycle claim would be the one thing this card must not make. The rule is
  // checked on the capture's own words rather than trusted from the code: if the
  // stage ever reports an applied rule or an owned sheet, the checker says so.
  const claim = typeof stage.claim === "string" ? stage.claim : "";
  if (/applied|lifecycle (?:proven|established)|owns? the/i.test(claim)) {
    out.add(
      "lifecycle-claim",
      `\`lifecycle.claim\` reads ${describeValue(stage.claim)}, which claims a stylesheet`
        + " lifecycle. The card measures calls; it has no binding that reports an applied"
        + " rule, so a claim like this is not supported by any field in the capture.",
      stage.stage,
    );
  }
}

function checkStylesheetV2Summary(out, stage) {
  expectArray(out, stage.stage, "stagesLogged", stage.stagesLogged);
  expectNumber(out, stage.stage, "attemptsRecorded", stage.attemptsRecorded);
  expectNumber(out, stage.stage, "callsThatThrew", stage.callsThatThrew);
  expectNumber(out, stage.stage, "callsThatReturned", stage.callsThatReturned);
  expectNumber(out, stage.stage, "handlesReturned", stage.handlesReturned);
  expectNumber(out, stage.stage, "distinctLoadAnswers", stage.distinctLoadAnswers);
  expectArray(out, stage.stage, "loadAnswers", stage.loadAnswers);
  checkUnmeasured(out, stage);

  // The summary's own counters have to add up to the attempts it summarises, or
  // the two halves of the capture disagree about how many experiments were run.
  if (typeof stage.callsThatThrew === "number"
    && typeof stage.callsThatReturned === "number"
    && typeof stage.attemptsRecorded === "number") {
    const total = stage.callsThatThrew + stage.callsThatReturned;
    if (total !== stage.attemptsRecorded) {
      out.add(
        "summary-does-not-add-up",
        `\`summary\` records ${stage.attemptsRecorded} attempt(s) but ${total}`
          + ` (${stage.callsThatThrew} threw + ${stage.callsThatReturned} returned). The`
          + " summary is derived from the stages above, so the two cannot disagree.",
        stage.stage,
      );
    }
  }

  if (typeof stage.distinctLoadAnswers === "number"
    && Array.isArray(stage.loadAnswers)
    && stage.distinctLoadAnswers !== stage.loadAnswers.length) {
    out.add(
      "summary-does-not-add-up",
      `\`summary.distinctLoadAnswers\` is ${stage.distinctLoadAnswers} but`
        + ` \`loadAnswers\` lists ${stage.loadAnswers.length}.`,
      stage.stage,
    );
  }
}

function checkListInventory(out, stage, card) {
  const operations = expectArray(out, stage.stage, "operations", stage.operations);
  // `namedPresent` is the measurement, not a promise: a host that lacks a
  // binding records it by leaving it out of this array. What is checked is that
  // the array is there and holds names, not that every name is in it.
  expectTextArray(out, stage.stage, "namedPresent", stage.namedPresent);
  expectTextArray(out, stage.stage, "relatedGlobals", stage.relatedGlobals);
  expectBoolean(out, stage.stage, "countingInstalled", stage.countingInstalled);
  if (operations === undefined) return;
  operations.forEach((entry, index) => {
    if (!isPlainObject(entry) || !isText(entry.name)) {
      out.add(
        "missing-field",
        `\`inventory.operations[${index}]\` must be an object with a string \`name\`, got`
          + ` ${describeValue(entry)}.`,
        stage.stage,
      );
      return;
    }
    expectText(out, stage.stage, `operations[${index}].typeof`, entry.typeof);
    checkArityFields(out, stage.stage, entry, `operations[${index}]`);
  });
  // The card inventories these four names; a capture that describes none of them
  // is not this card's inventory, whatever else it holds.
  if (!operations.some(entry => isPlainObject(entry) && isText(entry.name))) {
    out.add(
      "missing-operation",
      `\`inventory\` describes none of ${card.operations.join(", ")}, so the capture`
        + " does not record what the host exposes.",
      stage.stage,
    );
  }
}

function checkListCreate(out, stage) {
  expectBoolean(out, stage.stage, "createListExposed", stage.createListExposed);
  expectBoolean(out, stage.stage, "updateListCallbacksExposed", stage.updateListCallbacksExposed);
  expectBoolean(out, stage.stage, "returnedHandle", stage.returnedHandle);
  expectText(out, stage.stage, "handleTypeof", stage.handleTypeof);
  expectTextArray(out, stage.stage, "modelItems", stage.modelItems);
  expectArray(out, stage.stage, "rowsAfterCreate", stage.rowsAfterCreate);
  expectObject(out, stage.stage, "children", stage.children);
  expectHostCalls(out, stage.stage, stage.hostCallCounts);
}

function checkListMaterialize(out, stage) {
  expectArray(out, stage.stage, "requested", stage.requested);
  expectNumber(out, stage.stage, "requestedCount", stage.requestedCount);
  expectNumber(out, stage.stage, "materialized", stage.materialized);
  expectArray(out, stage.stage, "rows", stage.rows);
  expectObject(out, stage.stage, "children", stage.children);
  const counters = expectHostCalls(out, stage.stage, stage.hostCallCounts);

  // The distinction this stage exists for. `hostAskedOnItsOwn` is the host's
  // half, `materialized`/`requestedCount` are the probe's; a capture that keeps
  // only one of the two cannot say which of them produced the rows.
  const afterUpdate = expectBoolean(out, stage.stage, "hostAskedAfterUpdate",
    stage.hostAskedAfterUpdate);
  const whileMaterializing = expectBoolean(out, stage.stage, "hostAskedWhileMaterializing",
    stage.hostAskedWhileMaterializing);
  const onItsOwn = expectBoolean(out, stage.stage, "hostAskedOnItsOwn", stage.hostAskedOnItsOwn);

  // The card derives `hostAskedOnItsOwn` from the two booleans beside it, so a
  // capture where the derived field disagrees with its own inputs was edited, or
  // written by a different revision than the one it claims.
  if (afterUpdate !== undefined && whileMaterializing !== undefined && onItsOwn !== undefined) {
    const derived = afterUpdate || whileMaterializing;
    if (derived !== onItsOwn) {
      out.add(
        "derived-field-mismatch",
        `\`materialize.hostAskedOnItsOwn\` is ${describeValue(onItsOwn)}, but`
          + ` \`hostAskedAfterUpdate || hostAskedWhileMaterializing\` is`
          + ` ${describeValue(derived)}. The capture disagrees with its own fields.`,
        stage.stage,
      );
    }
  }

  // A host count that is absent is not a zero: three of the four booleans and
  // counts above exist to separate "the host never asked" from "the probe asked
  // instead", and only a recorded number can carry that.
  if (counters === undefined && onItsOwn === true) {
    out.add(
      "missing-recycling-answer",
      "`materialize` claims the host asked on its own but records no `hostCallCounts`,"
        + " so the claim has no counter behind it.",
      stage.stage,
    );
  }
}

function checkListReorder(out, stage) {
  expectTextArray(out, stage.stage, "before", stage.before);
  expectTextArray(out, stage.stage, "after", stage.after);
  expectNumber(out, stage.stage, "existingRowsMoved", stage.existingRowsMoved);
  expectBoolean(out, stage.stage, "identityMeasured", stage.identityMeasured);
  expectBoolean(out, stage.stage, "keyedIdentityPreserved", stage.keyedIdentityPreserved);
  expectBoolean(out, stage.stage, "elementOrderChanged", stage.elementOrderChanged);
  expectObject(out, stage.stage, "hostCallsDuring", stage.hostCallsDuring);
  const diff = expectObject(out, stage.stage, "diff", stage.diff);
  if (diff !== undefined) {
    expectTextArray(out, stage.stage, "diff.kept", diff.kept);
    expectTextArray(out, stage.stage, "diff.released", diff.released);
  }
}

function checkListShrunk(out, stage) {
  expectTextArray(out, stage.stage, "releasedRows", stage.releasedRows);
  expectTextArray(out, stage.stage, "keptRows", stage.keptRows);
  expectBoolean(out, stage.stage, "hostRecycled", stage.hostRecycled);
  expectObject(out, stage.stage, "hostCallsDuring", stage.hostCallsDuring);
  expectHostCalls(out, stage.stage, stage.hostCallCounts);
}

/**
 * The list summary, including the one answer this whole card is asked for.
 *
 * `summary.hostCallCounts.enqueueComponent` is the recycling answer: a recording
 * of how often the host called `enqueueComponent`, and `0` is a complete answer
 * — "it was never called during this card". A summary that omits the counter
 * does not answer the question at all, so it is a finding rather than a pass,
 * and so is a `shrunk` stage that reports `hostRecycled` without the counter
 * that decides it.
 */
function checkListSummary(out, stage) {
  const measured = expectTextArray(out, stage.stage, "measured", stage.measured);
  if (measured !== undefined && measured.length === 0) {
    out.add(
      "empty-measured",
      "`summary.measured` is empty, so the card does not say what it did measure.",
      stage.stage,
    );
  }
  checkUnmeasured(out, stage);

  if (stage.hostCallCounts === undefined) {
    out.add(
      "missing-recycling-answer",
      "`summary` records no `hostCallCounts`, so the capture never answers whether"
        + " enqueueComponent was called. A recorded 0 is an answer; an omission is the"
        + " question left open, and this card exists to close it.",
      stage.stage,
    );
    return;
  }
  expectHostCalls(out, stage.stage, stage.hostCallCounts);
}

/* ------------------------------------------------------------ card evaluation
 *
 * A card is one set of stages. Evaluation produces findings, not exceptions, so
 * every problem in a capture is reported in one run instead of one at a time.
 */

function evaluateCard(cardKey, stages, capturePath) {
  const card = CARDS[cardKey];
  const out = collector(capturePath);
  const context = {};

  const present = new Map();
  const extras = [];
  let previousIndex = -1;

  for (const capture of stages) {
    const stage = capture.stage;
    const stageName = stage.stage;
    if (stage.probe !== card.probe) {
      out.add(
        "wrong-probe",
        `the line carrying ${card.marker} says \`probe\``
          + ` ${describeValue(stage.probe)} instead of ${describeValue(card.probe)}; the`
          + " marker and the payload disagree about which card wrote it.",
        stageName,
      );
    }

    const index = card.stages.indexOf(stageName);
    if (index < 0) {
      // A stage this checker does not know is an extra, not a finding: "at least
      // the required stage set" is the rule, and a newer card that logs more must
      // still verify.
      extras.push(stageName);
      continue;
    }
    if (present.has(stageName)) {
      const first = present.get(stageName);
      const sameThread = first.thread === capture.thread;
      out.add(
        "duplicate-stage",
        `\`${stageName}\` appears on more than one line (${first.thread} at line`
          + ` ${first.lineNumber}, then ${capture.thread} at line ${capture.lineNumber}).`
          + (sameThread
            ? " Two lines from one thread is the card having rendered twice — two runs in"
              + " one capture, not one."
            : " A card that logs the same stage from both threads has reported it twice,"
              + " and that is two reports rather than one: neither line is dropped in"
              + " favour of the other.")
          + " A stage is expected exactly once.",
        stageName,
      );
      continue;
    }
    if (index < previousIndex) {
      out.add(
        "out-of-order-stage",
        `\`${stageName}\` appears after \`${card.stages[previousIndex]}\`, but the card`
          + ` emits it before. The stage order is: ${card.stages.join(", ")}.`,
        stageName,
      );
    }
    previousIndex = Math.max(previousIndex, index);
    present.set(stageName, capture);

    if (stageName === "load-missing-url") {
      const operation = operationNamed(stage, "__LoadStyleSheet");
      const call = lastCall(operation);
      context.stylesheetMissingUrl = firstArgumentString(call);
    }
  }

  const missing = card.stages.filter(name => !present.has(name));
  if (missing.length > 0) {
    out.add(
      "missing-stage",
      `${missing.length} required stage(s) are absent from this card's lines:`
        + ` ${missing.map(name => `\`${name}\``).join(", ")}. The required set is`
        + ` ${card.stages.join(", ")} — a capture that stops early is not a run.`,
    );
  }

  for (const [stageName, capture] of present) {
    const check = card.checks[stageName];
    if (check === undefined) continue;
    const before = out.findings.length;
    try {
      check(out, capture.stage, card, context);
    } catch (error) {
      // A checker that throws on a hostile payload must not take the other
      // stages' findings with it.
      const message = error instanceof Error ? error.message : String(error);
      if (out.findings.length === before) {
        out.add("unreadable-stage",
          `\`${stageName}\` could not be checked: ${message}`, stageName);
      }
    }
  }

  return {
    card,
    cardKey,
    stages,
    present,
    extras,
    missing,
    findings: out.findings,
    lineNumbers: stages.map(capture => capture.lineNumber),
  };
}

/* ------------------------------------------------------------------ rendering
 *
 * The table is the reviewer's whole view of the capture, so it lists the
 * required stages in the order the card emits them, then any extras, then the
 * findings that explain a non-zero exit.
 */

function padRight(value, width) {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function renderTable(result) {
  const { card } = result;
  const rows = [];
  for (const name of card.stages) {
    const capture = result.present.get(name);
    if (capture === undefined) {
      rows.push([name, "MISSING", "-"]);
      continue;
    }
    const detail = describeStage(capture.stage);
    rows.push([name, "present", detail]);
  }
  for (const extra of result.extras) {
    rows.push([extra, "extra", "not required by this checker"]);
  }

  const header = ["stage", "state", "evidence"];
  const widths = header.map((heading, column) =>
    Math.max(heading.length, ...rows.map(row => row[column].length)));
  const line = cells =>
    `  ${cells.map((value, column) => padRight(value, widths[column])).join("  ")}`.trimEnd();
  return [
    line(header),
    line(widths.map(width => "-".repeat(width))),
    ...rows.map(line),
  ].join("\n");
}

/** One short, field-derived line per stage, never a re-worded claim. */
function describeStage(stage) {
  const parts = [];
  const counter = (name, value) => {
    if (typeof value === "number") parts.push(`${name} ${value}`);
  };

  switch (stage.stage) {
    case "inventory": {
      if (Array.isArray(stage.operations)) parts.push(`${stage.operations.length} binding(s)`);
      if (Array.isArray(stage.namedPresent)) parts.push(`${stage.namedPresent.length} present`);
      break;
    }
    case "inventory-v2": {
      if (Array.isArray(stage.globals)) parts.push(`${stage.globals.length} global(s)`);
      if (isPlainObject(stage.sources)) {
        parts.push(`${Object.keys(stage.sources).length} source(s)`);
      }
      break;
    }
    case "loadstyle-arity":
    case "adopt-arity":
    case "replace-arity": {
      if (Array.isArray(stage.attempts)) parts.push(`${stage.attempts.length} attempt(s)`);
      if (Array.isArray(stage.groups)) parts.push(`${stage.groups.length} distinct answer(s)`);
      counter("handles", stage.returnedHandles);
      if (typeof stage.handleAvailable === "boolean") {
        parts.push(`handle available ${describeValue(stage.handleAvailable)}`);
      }
      if (typeof stage.setAvailable === "boolean") {
        parts.push(`set available ${describeValue(stage.setAvailable)}`);
      }
      break;
    }
    case "style-object-path": {
      parts.push(`exposed ${describeValue(stage.exposed)}`);
      if (Array.isArray(stage.followUps)) parts.push(`${stage.followUps.length} setter(s)`);
      if (isText(stage.handleKind)) parts.push(`handle ${stage.handleKind}`);
      break;
    }
    case "lifecycle": {
      counter("calls returned", stage.callsThatReturned);
      if (Array.isArray(stage.readbacks)) parts.push(`${stage.readbacks.length} readback(s)`);
      break;
    }
    case "no-arguments": {
      const calls = Array.isArray(stage.operations)
        ? stage.operations.reduce((total, entry) =>
          total + (Array.isArray(entry.calls) ? entry.calls.length : 0), 0)
        : undefined;
      if (calls !== undefined) parts.push(`${calls} call(s)`);
      break;
    }
    case "load-missing-url":
    case "load-real-url": {
      const operation = operationNamed(stage, "__LoadStyleSheet");
      const call = lastCall(operation);
      const url = firstArgumentString(call);
      if (url !== undefined) parts.push(url);
      if (isPlainObject(call?.threw)) parts.push(`threw ${String(call.threw.name)}`);
      else if (call?.returned !== undefined) parts.push("returned");
      break;
    }
    case "create": {
      parts.push(`handle ${describeValue(stage.returnedHandle)}`);
      if (typeof stage.handleTypeof === "string") parts.push(`typeof ${stage.handleTypeof}`);
      counter("children", isPlainObject(stage.children) ? stage.children.count : undefined);
      break;
    }
    case "materialize": {
      counter("requested", stage.requestedCount);
      counter("materialized", stage.materialized);
      parts.push(`host asked on its own ${describeValue(stage.hostAskedOnItsOwn)}`);
      break;
    }
    case "reorder": {
      counter("moved", stage.existingRowsMoved);
      parts.push(`order changed ${describeValue(stage.elementOrderChanged)}`);
      break;
    }
    case "shrunk": {
      counter("released", Array.isArray(stage.releasedRows)
        ? stage.releasedRows.length
        : undefined);
      parts.push(`host recycled ${describeValue(stage.hostRecycled)}`);
      break;
    }
    case "summary": {
      if (Array.isArray(stage.unmeasured)) parts.push(`${stage.unmeasured.length} unmeasured`);
      const counters = isPlainObject(stage.hostCallCounts) ? stage.hostCallCounts : undefined;
      if (counters !== undefined) {
        counter("enqueueComponent", counters.enqueueComponent);
      }
      counter("attempts", stage.attemptsRecorded);
      counter("distinct answers", stage.distinctLoadAnswers);
      break;
    }
    case "done": {
      if (isText(stage.status)) parts.push(stage.status);
      break;
    }
    default:
      break;
  }

  return parts.length > 0 ? parts.join(", ") : "no summary fields";
}

function renderDetail(result, capturePath) {
  const threads = [...new Set(result.stages.map(capture => capture.thread))];
  const lines = [`  ${capturePath} — ${result.card.card} card,`
    + ` ${result.stages.length} stage line(s),`
    + ` ${result.missing.length} missing,`
    + ` thread(s) ${threads.join(", ")}`];
  for (const finding of result.findings) {
    lines.push(`  - [${finding.kind}] ${finding.message}`);
  }
  return lines.join("\n");
}

function summarize(results) {
  const findings = results.flatMap(result => result.findings);
  return {
    findings,
    cards: results.length,
    stages: results.reduce((total, result) => total + result.stages.length, 0),
    required: results.reduce((total, result) =>
      total + result.card.stages.filter(name => result.present.has(name)).length, 0),
    totalRequired: results.reduce((total, result) => total + result.card.stages.length, 0),
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
      `${capturePath} contains no ${CARD_ORDER.map(key => CARDS[key].marker).join(", ")}`
        + " line, so there is nothing to verify. Point this at a capture from the"
        + " stylesheet, stylesheet-v2 or list card, or at"
        + ` ${PARITY_NODE_LABEL} for a smoke capture. This is not a pass.`,
    );
  }

  const parsed = parseCaptures(captures, capturePath);
  const byCard = CARD_ORDER.map(key => ({
    key,
    stages: parsed.filter(capture => capture.card === key),
  })).filter(group => group.stages.length > 0);

  const results = byCard.map(group => evaluateCard(group.key, group.stages, capturePath));
  const totals = summarize(results);
  const verified = totals.findings.length === 0;

  const heading = [
    "native probe verification",
    `  capture:    ${capturePath}`,
    `  checklist:  ${NODE_LABEL} (${results.map(result =>
      `${result.card.card}: ${result.card.stages.length} stages`).join("; ")})`,
    `  cards:      ${totals.cards} (${results.map(result => result.card.card).join(", ")})`,
    `  stages:     ${totals.stages} line(s), ${totals.required} of`
      + ` ${totals.totalRequired} required stage(s) present`,
  ].join("\n");

  const tables = results.map((result, index) => {
    const threads = [...new Set(result.stages.map(capture => capture.thread))];
    const title = `card ${index + 1} of ${results.length} — ${result.card.card}`
      + ` — ${capturePath}:${result.lineNumbers.join(",")}`
      + ` — thread(s) ${threads.join(", ")}`;
    return [title, renderTable(result)].join("\n");
  });

  const detail = verified
    ? ""
    : ["findings", ...results
      .filter(result => result.findings.length > 0)
      .map(result => renderDetail(result, capturePath))].join("\n");

  const verdict = verified
    ? `verdict: verified — ${totals.required} required stage(s) present across`
      + ` ${totals.cards} card(s), and nothing in the capture contradicts what it records.`
      + " What the stages mean is still read against docs/capabilities.md."
    : `verdict: findings — ${totals.findings.length} problem(s) across`
      + ` ${totals.cards} card(s); this capture cannot back a native claim.`;

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
