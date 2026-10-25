/**
 * Recording helpers for the second native stylesheet PAPI probe.
 *
 * The v1 probe (`stylesheet-probe.ts`) established two things on a device and
 * left one open:
 *
 * - `fn.length` is `0` for `__LoadStyleSheet`, `__AdoptStyleSheet` and
 *   `__ReplaceStyleSheets`, so the declared arity is not the signature;
 * - `__LoadStyleSheet` threw `LoadStyleSheet param size should >= 2` for a call
 *   with no arguments *and* for a call with a single string URL, so it needs a
 *   second parameter that v1 never supplied and never identified.
 *
 * This module carries what the v2 card needs to answer that question and to ask
 * whether a style-object path exists at all. It is pure and side-effect free so
 * a host-free test can check it, and it deliberately reuses v1's `describeValue`
 * and `safeCall` rather than re-implementing them: a recorder that describes a
 * native value differently from the one beside it would make the two captures
 * impossible to read together.
 *
 * Two rules from v1 are kept, because they are what make a probe a measurement:
 *
 * - nothing is inferred from a name, so every field comes from reading the
 *   runtime's own binding;
 * - `fn.length` is recorded as evidence about the binding, never turned into an
 *   expected parameter list.
 */

import {
  describeValue,
  safeCall,
  type ProbeCall,
  type ProbeValue,
} from "./stylesheet-probe-report.js";

/** The marker this card logs under. Not a prefix of v1's `[solid-lynx ss]`. */
export const STYLESHEET_V2_MARKER = "[solid-lynx ss2]";

/** The `probe` field on every line this card writes. */
export const STYLESHEET_V2_PROBE = "native-stylesheet-papi-v2";

/**
 * The stages this card emits, in order.
 *
 * Exported because the capture verifier and the docs table both list them, and a
 * stage that exists in one place but not the others is exactly what the v1
 * checker's structural tests exist to catch.
 */
export const STYLESHEET_V2_STAGES = [
  "inventory-v2",
  "loadstyle-arity",
  "adopt-arity",
  "replace-arity",
  "style-object-path",
  "lifecycle",
  "summary",
  "done",
] as const;

export type StylesheetV2Stage = (typeof STYLESHEET_V2_STAGES)[number];

/**
 * Every style-named global v1's device inventory reported.
 *
 * The card does not trust this list alone: it unions it with the runtime's own
 * property names, so a host that exposes a style binding nobody here expected
 * still appears in `inventory-v2`. This list exists so the fourteen v1 found are
 * always described even if the discovery filter changes.
 */
export const STYLESHEET_V2_GLOBALS = [
  "__AddInlineStyle",
  "__AdoptStyleSheet",
  "__CreateStyleObject",
  "__GetComputedStyleByKey",
  "__GetComputedStyles",
  "__GetInlineStyle",
  "__GetInlineStyles",
  "__LoadStyleSheet",
  "__ReplaceStyleSheets",
  "__SetCSSId",
  "__SetInlineStyles",
  "__SetParsedStyles",
  "__SetStyleObject",
  "__UpdateStyleObject",
] as const;

/**
 * The read-only operations the lifecycle stage reads its own card back through.
 *
 * Only operations that cannot mutate anything belong here: the lifecycle stage
 * runs after the rest of the card has collected its evidence, so a write at that
 * point could only spoil the report.
 */
export const STYLESHEET_V2_READBACK_GLOBALS = [
  "__GetInlineStyles",
  "__GetInlineStyle",
  "__GetComputedStyles",
  "__GetComputedStyleByKey",
] as const;

/** One global, described from the host's own binding. */
export interface V2Global {
  name: string;
  typeof: string;
  /** `fn.length`. Recorded, never read as a signature. */
  arity?: number;
  /** Key into `V2Inventory.sources` for the verbatim `String(fn)`. */
  source?: string;
  /**
   * Key into `V2Inventory.shapes` for `fn.name`, `prototype` and
   * `Object.getOwnPropertyNames(fn)`.
   *
   * Interning follows the same reasoning as `sources`: v1's device inventory shows
   * every native binding reporting the same three fields — an empty `name`, no
   * prototype, and `["length","name"]` — so writing them out fourteen times would
   * put the inventory line over the size the console bridge delivers. The values
   * are recorded once, verbatim, and referenced.
   */
  shape?: string;
  /** Why a field could not be read. */
  error?: string;
}

/** The fields every native binding reports identically, recorded once. */
export interface V2Shape {
  fnName: string;
  hasPrototype: boolean;
  own: string[];
}

export interface V2Inventory {
  /**
   * Distinct `String(fn)` values, keyed `s0`, `s1`, ….
   *
   * Every native binding in v1's capture had the same 33-character source, and
   * writing it out once per global would take the `inventory-v2` line from
   * roughly 2 KiB to roughly 3 KiB. An over-long console line is the one failure
   * that would silently destroy the whole stage, so the text is recorded once and
   * referenced. It is not summarised or interpreted: the exact string is here.
   */
  sources: Record<string, string>;
  /** Distinct name/prototype/own-property sets, keyed `p0`, `p1`, …. */
  shapes: Record<string, V2Shape>;
  globals: V2Global[];
}

const MAX_OWN = 8;
const MAX_SOURCE = 120;

/**
 * Every global whose name mentions a style, sheet, or css.
 *
 * `Object.getOwnPropertyNames` is used rather than `for…in` so a non-enumerable
 * binding is not missed, and it is guarded because a host object can throw on it.
 * The known names are unioned in so the fourteen v1 recorded are always present
 * even on a host whose discovery surface differs.
 */
export function styleGlobalNames(scope: object): string[] {
  let names: string[] = [];
  try {
    names = Object.getOwnPropertyNames(scope);
  } catch {
    names = [];
  }
  const found = names.filter(name => /style|sheet|css/i.test(name));
  const known = STYLESHEET_V2_GLOBALS.filter(name => !found.includes(name));
  return [...found, ...known].sort();
}

function read<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/**
 * Describes one global, interning its source text.
 *
 * A value that is not a function is described by its `typeof` and nothing else:
 * there is no arity to report and guessing one would be the inference this probe
 * forbids.
 */
export function describeGlobal(
  name: string,
  value: unknown,
  sources: Record<string, string>,
  shapes: Record<string, V2Shape> = {},
): V2Global {
  const description: V2Global = { name, typeof: typeof value };
  if (typeof value !== "function") return description;

  const fn = value as (...args: unknown[]) => unknown;

  const arity = read(() => fn.length);
  if (typeof arity === "number") description.arity = arity;

  try {
    const source = String(fn).slice(0, MAX_SOURCE);
    const existing = Object.keys(sources).find(key => sources[key] === source);
    if (existing !== undefined) {
      description.source = existing;
    } else {
      const key = `s${Object.keys(sources).length}`;
      sources[key] = source;
      description.source = key;
    }
  } catch (error) {
    description.error = errorText(error);
  }

  const fnName = read(() => fn.name);
  const prototype = read(() => (fn as { prototype?: unknown }).prototype);
  const own = read(() => Object.getOwnPropertyNames(fn).slice(0, MAX_OWN));
  if (typeof fnName === "string" && own !== undefined) {
    const shape: V2Shape = {
      fnName,
      hasPrototype: Boolean(prototype),
      own,
    };
    const existing = Object.keys(shapes).find(key =>
      shapes[key].fnName === shape.fnName
      && shapes[key].hasPrototype === shape.hasPrototype
      && shapes[key].own.join("\u0000") === shape.own.join("\u0000"));
    if (existing !== undefined) {
      description.shape = existing;
    } else {
      const key = `p${Object.keys(shapes).length}`;
      shapes[key] = shape;
      description.shape = key;
    }
  }

  return description;
}

/**
 * The inventory stage's payload, built from a live scope.
 *
 * Each property read is guarded separately: a host object can expose a binding
 * through a getter that throws, and one such binding must not take the whole
 * inventory — or the card — with it. A binding that cannot be read is described
 * as undefined with the throw recorded, which is itself evidence.
 */
export function describeGlobalInventory(scope: object): V2Inventory {
  const sources: Record<string, string> = {};
  const shapes: Record<string, V2Shape> = {};
  const globals = styleGlobalNames(scope).map(name => {
    let value: unknown;
    try {
      value = (scope as Record<string, unknown>)[name];
    } catch (error) {
      return { name, typeof: "unreadable", error: errorText(error) };
    }
    return describeGlobal(name, value, sources, shapes);
  });
  return { sources, shapes, globals };
}

/* ------------------------------------------------------------------ call tables
 *
 * The argument lists live here, as pure functions of the card's own values, so a
 * host-free test can assert the probe really attempts the bounded list it
 * documents — including that `[url]` and `[url, url2]` are different cases and
 * that every fabricated object is a fresh one per attempt.
 */

export interface AttemptCase {
  /** What this case is testing, in words a capture reader can act on. */
  label: string;
  args: unknown[];
}

/**
 * The eight `__LoadStyleSheet` argument lists, in order.
 *
 * `url2` is a second, different, really-served stylesheet: passing the same URL
 * twice would not distinguish "the second parameter is a URL" from "the binding
 * ignores its second argument and re-reads the first".
 */
export function loadStyleSheetCases(url: string, url2: string): AttemptCase[] {
  // Each object, array and function is constructed here rather than shared, so a
  // binding that stores or compares its second argument is not handed a value
  // another attempt also saw.
  //
  // The labels are kept short on purpose — `LOAD_STAGE_BYTES` explains why. The
  // argument descriptions beside each one already say exactly what was passed.
  return [
    { label: "[url]", args: [url] },
    { label: "[url, null]", args: [url, null] },
    { label: "[url, 0]", args: [url, 0] },
    { label: "[url, {}]", args: [url, {}] },
    { label: "[url, \"utf-8\"]", args: [url, "utf-8"] },
    { label: "[url, function(){}]", args: [url, (): void => {}] },
    { label: "[url, []]", args: [url, []] },
    { label: "[url, url2]", args: [url, url2] },
  ];
}

/**
 * `__AdoptStyleSheet` argument lists.
 *
 * The handle case is only present when some earlier stage produced a handle this
 * card itself created; a fabricated one is never substituted, because adopting
 * something that is not a stylesheet measures the probe rather than the host.
 */
export function adoptStyleSheetCases(handle?: unknown): AttemptCase[] {
  const cases: AttemptCase[] = [
    { label: "[]", args: [] },
    { label: "[null]", args: [null] },
    { label: "[{}]", args: [{}] },
  ];
  if (handle !== undefined) {
    cases.push({ label: "[handle from load]", args: [handle] });
  }
  return cases;
}

/**
 * `__ReplaceStyleSheets` argument lists.
 *
 * `no arguments` and `one argument an empty array` are separate cases because
 * v1 measured the first as returning `null` without throwing: a binding that
 * accepts nothing and a binding that accepts an empty set are different contracts.
 */
export function replaceStyleSheetsCases(loadedSet?: unknown): AttemptCase[] {
  const cases: AttemptCase[] = [
    { label: "[]", args: [] },
    { label: "[null]", args: [null] },
    { label: "[[]]", args: [[]] },
  ];
  if (loadedSet !== undefined) {
    cases.push({ label: "[loaded set]", args: [loadedSet] });
  }
  return cases;
}

/**
 * Whether a returned value is something later stages may pass back as a handle.
 *
 * Only a non-null object or function counts. A `null`, `undefined`, number or
 * string return means the call did not hand out an opaque handle, and treating
 * it as one would be the fabrication this probe refuses.
 */
export function isOpaqueHandle(value: unknown): boolean {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

/* ------------------------------------------------------------------- recording
 */

/** One attempted call, with the argument list that produced it. */
export interface V2Attempt {
  label: string;
  /** How each argument was constructed. `ProbeValue` never throws. */
  args: ProbeValue[];
  call: ProbeCall;
  outcome: "returned" | "threw";
}

/**
 * The delivered size budget for one stage line, in bytes.
 *
 * This is not arbitrary. v1's device capture contains a complete, parseable stage
 * line of 2,040 bytes and nothing longer, so 2,040 is the largest line the native
 * console bridge is known to have delivered intact. A stage that exceeds it risks
 * arriving truncated, and a truncated line is worse than a short one: it is the
 * stage that would have answered the card's question.
 *
 * The eight-case load experiment is the line at risk — every case repeats the
 * same 70-character engine error — so the repeated text is interned exactly as
 * `sources` interns `String(fn)`, and each attempt references its key. Measured
 * under this budget: the all-threw case, which is the longest because every
 * attempt carries an error, is about 1.6 KiB.
 */
export const LOAD_STAGE_BYTES = 2040;

/** The interned error text of one node, keyed `e0`, `e1`, …. */
export interface ErrorTable {
  [key: string]: string;
}

/**
 * Returns the key for an error's message, adding it to the table when new.
 *
 * Two attempts that failed with the identical message share one key, which is
 * what keeps an all-threw capture small. The message itself is never altered or
 * summarised: it is the engine's own text and it is stored once, verbatim.
 */
export function internError(errors: ErrorTable, message: string): string {
  const existing = Object.keys(errors).find(key => errors[key] === message);
  if (existing !== undefined) return existing;
  const key = `e${Object.keys(errors).length}`;
  errors[key] = message;
  return key;
}

/** The delivered-size check for one built stage line. */
export function withinBudget(line: string, budget = LOAD_STAGE_BYTES): boolean {
  return line.length <= budget;
}

/**
 * Picks the fullest stage payload that still fits in one delivered line.
 *
 * Interning the repeated error text is usually enough, but it cannot help when the
 * host returns a *different* message per case: eight distinct long errors put the
 * full payload over the budget on their own. The candidates are therefore ordered
 * richest-first, and the first one that fits wins:
 *
 *   1. `full` — every argument description, every error, and the grouping echo;
 *   2. `terse` — the same attempts without their argument descriptions, which the
 *      label already names;
 *   3. `lean` — the terse form without the grouping echo, which is derivable from
 *      the attempts themselves.
 *
 * Dropping something always costs less than the stage line, and the chosen form is
 * recorded in `form` so a reader knows what was omitted rather than guessing. If
 * even the last candidate does not fit, the payload says `overBudget` explicitly
 * instead of emitting a line that may arrive truncated: a silently shortened line
 * is the one failure a capture cannot show.
 */
export interface FitResult {
  payload: Record<string, unknown>;
  /** The form that was used, or `over-budget` when none fit. */
  form: string;
  bytes: number;
}

export interface BudgetCandidate {
  form: string;
  payload: Record<string, unknown>;
}

export function fitToBudget(
  stage: string,
  candidates: readonly BudgetCandidate[],
  budget = LOAD_STAGE_BYTES,
): FitResult {
  for (const candidate of candidates) {
    const bytes = v2ReportLine(stage, candidate.payload).length;
    if (bytes <= budget) {
      const compacted = candidate.form === candidates[0]?.form;
      return {
        payload: compacted ? candidate.payload : { ...candidate.payload, fitForm: candidate.form },
        form: candidate.form,
        bytes,
      };
    }
  }

  const last = candidates[candidates.length - 1];
  const payload = last === undefined ? {} : last.payload;
  return {
    payload: {
      ...payload,
      fitForm: "over-budget",
      overBudget: true,
      stageBytes: budget,
    },
    form: "over-budget",
    bytes: v2ReportLine(stage, payload).length,
  };
}

/**
 * Every attempt in one bounded list, plus the raw values behind the descriptions.
 *
 * The descriptions go into the capture; the raw values stay in memory because a
 * later stage may only pass back a handle the card actually received. Keeping
 * both in one object is what stops the two from drifting apart by index.
 */
export interface AttemptRun {
  attempts: V2Attempt[];
  /** The value each attempt returned, `undefined` where it threw. */
  raw: unknown[];
  /** The returned values that are safe to pass back as a handle. */
  handles: CapturedHandle[];
}

/** A handle this card itself received from the host. */
export interface CapturedHandle {
  label: string;
  value: unknown;
}

/**
 * Runs a bounded list of argument lists against one binding.
 *
 * Each case is independent: `safeCall` turns a throw into a recorded outcome, so
 * one failing case cannot stop the list. Each case is also invoked exactly once —
 * the binding is wrapped in a forwarder that keeps whatever it returned, rather
 * than the case being called a second time to recover the handle. Calling twice
 * would mean the capture described one call and the card made two.
 *
 * The forwarder passes every argument and the return value through untouched, so
 * the binding sees exactly what a bare call would give it.
 */
export function runCases(fn: unknown, cases: readonly AttemptCase[]): AttemptRun {
  const attempts: V2Attempt[] = [];
  const raw: unknown[] = [];

  for (const testCase of cases) {
    let returned: unknown = undefined;
    const record = (...args: unknown[]): unknown => {
      const value = (fn as (...rest: unknown[]) => unknown)(...args);
      returned = value;
      return value;
    };
    const target = typeof fn === "function" ? record : fn;

    const call = safeCall(target, testCase.args);
    attempts.push({
      label: testCase.label,
      args: testCase.args.map(describeValue),
      call,
      outcome: call.threw === undefined ? "returned" : "threw",
    });
    // Only a case that really returned offers a handle: `safeCall` recorded a
    // throw, so whatever `returned` holds was never handed out.
    raw.push(call.threw === undefined ? returned : undefined);
  }

  return { attempts, raw, handles: captureHandles(attempts, raw) };
}

/** The returned values that later stages may pass back. */
export function captureHandles(
  attempts: readonly V2Attempt[],
  raw: readonly unknown[],
): CapturedHandle[] {
  const handles: CapturedHandle[] = [];
  attempts.forEach((record, index) => {
    if (record.outcome !== "returned") return;
    const value = raw[index];
    if (!isOpaqueHandle(value)) return;
    handles.push({ label: record.label, value });
  });
  return handles;
}

/** First captured handle, or `undefined`. Used where a stage needs exactly one. */
export function firstHandle(handles: readonly CapturedHandle[]): unknown {
  return handles.length === 0 ? undefined : handles[0].value;
}

/** First captured handle that is an array, or `undefined`. */
export function firstArrayHandle(handles: readonly CapturedHandle[]): unknown {
  const found = handles.find(handle => Array.isArray(handle.value));
  return found?.value;
}

/**
 * Groups attempts by the outcome they produced.
 *
 * This is a summary of the capture, not an interpretation of it: two attempts
 * that threw the identical message are reported together so a reader can see at
 * a glance whether the bounded list separated at all, and the message is the
 * engine's own text rather than a paraphrase.
 */
export interface OutcomeGroup {
  outcome: "returned" | "threw";
  /** The engine's message verbatim, or the returned value's `kind`. */
  detail: string;
  labels: string[];
}

export function groupOutcomes(attempts: readonly V2Attempt[]): OutcomeGroup[] {
  const groups: OutcomeGroup[] = [];
  for (const record of attempts) {
    const detail = record.call.threw !== undefined
      ? record.call.threw.message
      : (record.call.returned?.kind ?? "unknown");
    const existing = groups.find(group =>
      group.outcome === record.outcome && group.detail === detail);
    if (existing) existing.labels.push(record.label);
    else groups.push({ outcome: record.outcome, detail, labels: [record.label] });
  }
  return groups;
}

/** The report line for one stage of this card. */
export function v2ReportLine(stage: string, payload: Record<string, unknown>): string {
  return `${STYLESHEET_V2_MARKER} ${JSON.stringify({ probe: STYLESHEET_V2_PROBE, stage, ...payload })}`;
}
