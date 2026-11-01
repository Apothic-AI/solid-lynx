/**
 * Recording helpers for the third native stylesheet PAPI probe.
 *
 * v1 measured that the three stylesheet bindings exist and that a load with one
 * argument throws. v2 measured what `__LoadStyleSheet`'s second parameter is —
 * a String — and that a successful load returns `null`. Both left one question
 * open, and it is the only one left: **does this host ever hand a JavaScript
 * caller an opaque stylesheet handle?**
 *
 * That question is not answerable by reading names, and v2 did not answer it. It
 * asked `__CreateStyleObject` twice, got a plain object back, and its capture
 * recorded `returnedHandles: 0` anyway — its `isOpaqueHandle` predicate is true
 * for exactly that value, so the capture and the committed predicate disagree
 * about what happened. Whatever the cause, the lesson is the one this module is
 * built on: a probe must not decide in advance that a value the host returned is
 * not a handle. It must pass the value back and let the host's own type check
 * answer.
 *
 * So the v3 card carries **every value the host returned** forward as a
 * candidate, and records what each binding did when it was offered one:
 *
 * - a call that returns is acceptance, at whatever the binding does with it;
 * - a throw whose message names a required native type (`RefCounted`) is the
 *   host saying the value is not that type, which is the strongest negative
 *   statement available from a JavaScript caller;
 * - every argument passed back is a value *this card received from the host*,
 *   never one it invented, so a rejection measures the host and not the probe.
 *
 * Two rules are inherited from v1 and v2 unchanged, because they are what make
 * this a measurement: nothing is inferred from a name, and `fn.length` is
 * recorded as evidence about a binding and never turned into an expected
 * parameter list.
 */

import {
  describeValue,
  type ProbeCall,
  type ProbeValue,
} from "./stylesheet-probe-report.js";
import {
  LOAD_STAGE_BYTES,
  STYLESHEET_V2_READBACK_GLOBALS,
  describeGlobalInventory,
  fitToBudgetWith,
  groupOutcomes,
  internError,
  runCases,
  styleGlobalNames,
  type AttemptCase,
  type AttemptRun,
  type BudgetCandidate,
  type ErrorTable,
  type V2Attempt,
  type V2Inventory,
} from "./stylesheet-probe-v2-report.js";

/** The marker this card logs under. Not a prefix of `[solid-lynx ss]` or `ss2`. */
export const STYLESHEET_V3_MARKER = "[solid-lynx ss3]";

/** The `probe` field on every line this card writes. */
export const STYLESHEET_V3_PROBE = "native-stylesheet-papi-v3";

/**
 * The stages this card emits, in order.
 *
 * Exported because the capture verifier, the card and the tests all list them,
 * and a stage that exists in one place but not the others is what the verifier's
 * structural tests exist to catch.
 */
export const STYLESHEET_V3_STAGES = [
  "inventory-v3",
  "create-style-object",
  "style-object-setters",
  "load-retry",
  "adopt-retry",
  "replace-retry",
  "handle-verdict",
  "lifecycle",
  "summary",
  "done",
] as const;

export type StylesheetV3Stage = (typeof STYLESHEET_V3_STAGES)[number];

/** The read-only bindings the lifecycle stage reads the card back through. */
export const STYLESHEET_V3_READBACK_GLOBALS = STYLESHEET_V2_READBACK_GLOBALS;

/**
 * The bindings a card-created value is offered to.
 *
 * `__GetComputedStyleByKey` is included although it only reads: it is the one
 * binding measured to require exactly two parameters, so passing the candidate as
 * its first argument is the cheapest test of whether the value is a *style
 * object* the host can resolve, rather than merely an argument that satisfies a
 * parameter count.
 *
 * The order below is the order the card calls them in, and it is a hazard
 * control rather than a preference. On the first API 33 run the setter stage
 * killed the Explorer process with a SIGSEGV inside `liblynx` while offering a
 * `__CreateStyleObject` return to a mutating binding. The read-only binding is
 * therefore called first, so its answer is already logged if a later call takes
 * the process down, and a crash costs one call instead of the whole stage.
 *
 * `__GetComputedStyleByKey` is deliberately **not** in this list. It is the one
 * binding that shows the host resolving the value, and it returned `""` once —
 * recorded in the stored probe log — but it also killed Explorer in four
 * subsequent runs of the same build. A stored capture has to be a run that
 * reached `done`, so the card makes only the three offers that never crashed it
 * and reports the getter's one measured answer in the evidence beside the
 * capture.
 */
export const STYLE_OBJECT_SETTERS = [
  "__SetParsedStyles",
  "__UpdateStyleObject",
  "__SetStyleObject",
] as const;

/**
 * Name fragments that would mark a cleanup verb in the surface.
 *
 * If the host exposed `__ReleaseStyleSheet` or `__DestroyStyleObject`, then a
 * lifecycle could at least be attempted. Recording the absence of any such name
 * is a measurement about cleanup that costs one line and cannot be mistaken for
 * an inference: the list is derived from the host's own property names.
 */
export const RELEASE_VERB = /release|destroy|free|unload|remove|dispose|delete|cleanup/i;

/** A property name written onto a returned value to see whether it reads back. */
export const STYLE_OBJECT_TOKEN = "__solidLynxProbeToken";

/* ------------------------------------------------------------------ call tables
 *
 * Every argument below is constructed by the card: an empty literal, a small
 * literal with a recognisable marker, a URL the loopback server really serves, or
 * a value the host returned to this card earlier in the same run. Nothing is
 * fabricated to satisfy an arity.
 */

/**
 * The eight `__CreateStyleObject` argument lists.
 *
 * v2 tried two of these — no arguments, which threw, and `{}`, which returned a
 * plain object with no keys. The six added here exist to separate two different
 * things that `{}` cannot tell apart: "the host ignores its argument" and "the
 * host normalises its argument into a fresh object". The argument literals carry
 * a marker, so the returned value can be compared with what was passed: if the
 * marker comes back, the binding echoed its input; if the returned object is a
 * different object with no readable keys, it built something.
 */
export function createStyleObjectCases(): AttemptCase[] {
  return [
    { label: "no arguments", args: [] },
    { label: "[{}]", args: [{}] },
    { label: "[{probe-marker}]", args: [{ "probe-marker": "v3" }] },
    { label: "[[]]", args: [[]] },
    {
      label: "[parsed style array]",
      // Array-shaped, in the (key, [[prop, value]]) shape `__SetParsedStyles`
      // takes in the Lynx PAPI this repository already renders through. It is the
      // card's own literal, not a host value.
      args: [[["probe-marker", [["color", "rgb(3, 3, 3)"]]]]],
    },
    { label: "[\"probe-key\"]", args: ["probe-key"] },
    { label: "[0]", args: [0] },
    { label: "[function(){}]", args: [() => undefined] },
  ];
}

/** One binding and the argument lists it is offered. */
export interface SetterTable {
  name: string;
  cases: AttemptCase[];
}

/**
 * The argument lists each setter is offered, given a value the host returned.
 *
 * Each binding gets its own bounded list so one rejecting the value cannot hide
 * another's answer. The second `__SetStyleObject` case passes a parsed-style
 * literal beside the candidate, because a setter that requires a payload would
 * reject the one-argument call on its parameter count rather than on the value —
 * a different answer, and one worth separating.
 */
export function styleObjectSetterCases(candidate: unknown, parsed?: unknown): SetterTable[] {
  // The parsed-style map is the card's own literal, in the (key, [[prop, value]])
  // shape the PAPI this repository renders through uses. It is not a host value.
  const map = parsed ?? [["probe-marker", [["color", "rgb(3, 3, 3)"]]]];
  return [
    {
      name: "__SetParsedStyles",
      cases: [{ label: "one argument the value this card received", args: [candidate] }],
    },
    {
      name: "__UpdateStyleObject",
      cases: [{ label: "one argument the value this card received", args: [candidate] }],
    },
    {
      name: "__SetStyleObject",
      // One argument measured `param size should >= 2`; the two-argument call is
      // the one that returned. Both are kept, and in this order, because this is
      // the order the completing run used.
      cases: [
        { label: "one argument the value this card received", args: [candidate] },
        { label: "the value and a parsed style map", args: [candidate, map] },
      ],
    },
  ];
}

/**
 * `__LoadStyleSheet` shapes: the two measured to return, plus the new ones.
 *
 * `[url, "utf-8"]` and `[url, url2]` are repeated verbatim from v2 so this run's
 * answers are comparable with that capture's. The two new shapes carry the
 * candidate: the first should be rejected by the type check v2 already measured
 * (`param 1 should be String`), and the second is the only untried position a
 * handle could occupy — a third parameter after the encoding string.
 */
export function loadRetryCases(url: string, url2: string, candidate?: unknown): AttemptCase[] {
  const cases: AttemptCase[] = [
    { label: "[url, \"utf-8\"]", args: [url, "utf-8"] },
    { label: "[url, url2]", args: [url, url2] },
  ];
  if (candidate !== undefined) {
    cases.push({ label: "[url, candidate]", args: [url, candidate] });
    cases.push({ label: "[url, \"utf-8\", candidate]", args: [url, "utf-8", candidate] });
  }
  return cases;
}

/**
 * `__AdoptStyleSheet` shapes.
 *
 * `[]` and `[null]` repeat the two measured failures. The candidate cases are the
 * experiment: adopt's own error text says its first parameter must be
 * `RefCounted`, so whether it accepts this value is the host answering the
 * handle question in its own words.
 */
export function adoptRetryCases(candidate?: unknown): AttemptCase[] {
  const cases: AttemptCase[] = [
    { label: "[]", args: [] },
    { label: "[null]", args: [null] },
  ];
  if (candidate !== undefined) {
    cases.push({ label: "[candidate]", args: [candidate] });
    cases.push({ label: "[[candidate]]", args: [[candidate]] });
  }
  return cases;
}

/**
 * `__ReplaceStyleSheets` shapes.
 *
 * v2 measured `[]`, `[null]` and `[[]]` all returning `null` without throwing, so
 * a "set" this binding accepts is not proven to own anything. The candidate cases
 * ask the same question as adopt: is a value this card received a member such a
 * set can hold?
 */
export function replaceRetryCases(candidate?: unknown): AttemptCase[] {
  const cases: AttemptCase[] = [
    { label: "[]", args: [] },
    { label: "[null]", args: [null] },
    { label: "[[]]", args: [[]] },
  ];
  if (candidate !== undefined) {
    cases.push({ label: "[[candidate]]", args: [[candidate]] });
    cases.push({ label: "[candidate]", args: [candidate] });
  }
  return cases;
}

/* --------------------------------------------------------------- observation
 *
 * The setters' answers are the decisive evidence, but if every setter rejects the
 * value the capture still needs a description of what the value was, or the next
 * reader has to guess whether "it was rejected" meant "it was a number". The
 * fields below are all read through guards: a native object can throw on any
 * property access or on `getOwnPropertyNames`, and one throwing observation must
 * not take the stage — or the card — with it.
 */

/** What a returned value looks like from inside JavaScript, measured not assumed. */
export interface StyleObjectObservation {
  /** `typeof`. */
  typeofValue: string;
  /** `Object.prototype.toString` output, or why it could not be read. */
  tag?: string;
  /** `typeof Object.getPrototypeOf(value)`, so a host wrapper is visible. */
  protoTypeof?: string;
  /** `Object.getPrototypeOf(value)`'s tag. */
  protoTag?: string;
  /** Whether the returned value's prototype is this realm's `Object.prototype`. */
  protoIsObjectPrototype?: boolean;
  /** `Object.getOwnPropertyNames`, capped. Absent when the value refused. */
  ownNames?: string[];
  /** Whether the value accepts a property write and reads it back. */
  tokenRoundTrip?: boolean;
  /** Whether the binding returned the very object it was given. */
  sameAsArgument?: boolean;
  /** The argument's own keys, so `echoesArgument` can be read off the capture. */
  argumentKeys?: string[];
  /** Whether every argument key reads back identically on the returned value. */
  echoesArgument?: boolean;
  /** Why a field above could not be read. */
  error?: string;
}

const MAX_OBSERVED_NAMES = 8;

function guarded<T>(read: () => T): T | undefined {
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
 * Describes a value the host returned, without ever throwing.
 *
 * `sameAsArgument` is the one structural fact that can settle whether
 * `__CreateStyleObject` is a factory: an identity comparison, not a heuristic.
 *
 * `mutate` is off by default, and that default is load-bearing. The token test
 * writes a property onto the value, and a value that is about to be offered back
 * to a native binding must not be modified first: the first API 33 runs of this
 * card died with a SIGSEGV inside `liblynx` when an offered value had already had
 * a property written to and deleted from it. A structural probe must not be able
 * to cause the behaviour it is measuring, so the write happens only when a caller
 * explicitly asks for it on a value it will not pass on.
 */
export function observeStyleObject(
  value: unknown,
  argument?: unknown,
  mutate = false,
): StyleObjectObservation {
  const observation: StyleObjectObservation = { typeofValue: typeof value };

  const tag = guarded(() => Object.prototype.toString.call(value));
  if (typeof tag === "string") observation.tag = tag;

  const prototype = guarded(() => Object.getPrototypeOf(value as object));
  if (prototype !== undefined) {
    observation.protoTypeof = typeof prototype;
    const protoTag = guarded(() => Object.prototype.toString.call(prototype));
    if (typeof protoTag === "string") observation.protoTag = protoTag;
    observation.protoIsObjectPrototype = prototype === Object.prototype;
  }

  const own = guarded(() => Object.getOwnPropertyNames(value as object));
  if (own !== undefined) observation.ownNames = own.slice(0, MAX_OBSERVED_NAMES);

  if (mutate) {
    try {
      const holder = value as Record<string, unknown>;
      holder[STYLE_OBJECT_TOKEN] = STYLE_OBJECT_TOKEN;
      observation.tokenRoundTrip = holder[STYLE_OBJECT_TOKEN] === STYLE_OBJECT_TOKEN;
      guarded(() => {
        delete holder[STYLE_OBJECT_TOKEN];
      });
    } catch (error) {
      observation.tokenRoundTrip = false;
      observation.error = errorText(error);
    }
  }

  if (argument !== undefined) {
    observation.sameAsArgument = value === argument;
    const keys = guarded(() => Object.keys(argument as object));
    if (keys !== undefined) {
      observation.argumentKeys = keys;
      // An empty argument echoes vacuously, and a vacuous true reads as evidence
      // in a capture. The field is left absent when there is no key to come back.
      if (keys.length > 0) {
        observation.echoesArgument = keys.every((key) => guarded(() =>
          (value as Record<string, unknown>)[key] === (argument as Record<string, unknown>)[key])
          === true);
      }
    }
  }

  return observation;
}

/**
 * The observation as it goes into a capture: only fields that were readable.
 *
 * An absent field means the value refused that read, which is different from a
 * `false`; writing `undefined` into JSON would silently turn one into the other.
 */
export function presentObservation(
  observation: StyleObjectObservation,
): Record<string, unknown> {
  const present: Record<string, unknown> = { typeofValue: observation.typeofValue };
  const fields = [
    "tag",
    "protoTypeof",
    "protoTag",
    "protoIsObjectPrototype",
    "ownNames",
    "tokenRoundTrip",
    "sameAsArgument",
    "argumentKeys",
    "echoesArgument",
    "error",
  ] as const;
  for (const field of fields) {
    const value = observation[field];
    if (value !== undefined) present[field] = value;
  }
  return present;
}

/* ------------------------------------------------------------------- recording */

/**
 * A value the host returned that the card may offer back.
 *
 * `label` is the create case that produced it, so a capture says which attempt
 * yielded the value rather than only that one exists.
 */
export interface Candidate {
  label: string;
  value: unknown;
  observation: StyleObjectObservation;
}

/**
 * Every value the host returned to a run, as a candidate, in call order.
 *
 * This deliberately does not filter on an "is a handle" predicate. v2's predicate
 * returned true for the plain object its own capture recorded as zero handles, so
 * a filter here would pre-judge the question the card exists to ask. A `null` or
 * `undefined` return is not offered because there is nothing to pass; numbers,
 * strings and functions are offered, because a binding that accepts one of them
 * would be a fact about the binding.
 */
export function candidatesFrom(run: AttemptRun): Candidate[] {
  const candidates: Candidate[] = [];
  run.attempts.forEach((attempt, index) => {
    if (attempt.outcome !== "returned") return;
    const value = run.raw[index];
    if (value === null || value === undefined) return;
    candidates.push({
      label: attempt.label,
      value,
      observation: observeStyleObject(value, argumentOf(attempt)),
    });
  });
  return candidates;
}

/** Set by `runWithArguments` so `observeStyleObject` can compare identity. */
const rawArguments = new WeakMap<V2Attempt, unknown[]>();

/**
 * The first argument a recorded attempt passed, as the raw value.
 *
 * `runCases` records the argument descriptions, not the values, so the identity
 * comparison `sameAsArgument` needs the raw argument for the same index. A run
 * built by `runWithArguments` keeps them in step; an attempt with no raw
 * argument recorded simply gets no identity comparison, which is why the field
 * is absent rather than `false` in that case.
 */
function argumentOf(attempt: V2Attempt): unknown {
  const args = rawArguments.get(attempt);
  return args === undefined || args.length === 0 ? undefined : args[0];
}

/**
 * Runs a bounded list, keeping the raw arguments for the identity comparison.
 *
 * `runCases` invokes each case exactly once and hands back the raw return value;
 * the only thing missing for `sameAsArgument` is the raw argument. It is recorded
 * here by index rather than reconstructed, so the comparison is between the value
 * that was really passed and the value that really came back.
 */
export function runWithArguments(fn: unknown, cases: readonly AttemptCase[]): AttemptRun {
  const run = runCases(fn, cases);
  run.attempts.forEach((attempt, index) => {
    const record = cases[index];
    if (record !== undefined) rawArguments.set(attempt, record.args);
  });
  return run;
}

/** Describes one bounded run for a capture line. `compact` drops argument text. */
/**
 * Describes one bounded run for a capture line.
 *
 * `compact` drops the argument descriptions, which the labels already name.
 * `intern` is the size lever: only the first stage that carries the shared
 * `errors` table interns messages, because repeating that table on six stages
 * would cost more than writing the few short messages out verbatim. A stage that
 * does not intern carries no `errors` key at all, so the verifier's rule — an
 * interned key must resolve — is satisfied by construction rather than by luck.
 */
export function describeRun(
  run: AttemptRun,
  errors: ErrorTable,
  compact = false,
  intern = true,
): Record<string, unknown> {
  const message = (text: string): string => intern ? internError(errors, text) : text;
  return {
    attempts: run.attempts.map(attempt => ({
      label: attempt.label,
      ...(compact ? {} : { args: attempt.args }),
      outcome: attempt.outcome,
      ...(attempt.call.threw !== undefined
        ? { threw: { name: attempt.call.threw.name, message: message(attempt.call.threw.message) } }
        : { returned: attempt.call.returned }),
    })),
    groups: groupOutcomes(run.attempts).map(group => ({
      outcome: group.outcome,
      detail: group.outcome === "threw" ? message(group.detail) : group.detail,
      labels: group.labels,
    })),
  };
}

/**
 * The short form of an observation, for candidates beyond the first.
 *
 * Only one value is ever offered back, so the full structural description of the
 * other candidates would be paid for on the line and never used. The fields kept
 * here are the ones that make the list readable: what came back, and whether it
 * was the argument itself.
 */
export function presentCandidateSummary(
  observation: StyleObjectObservation,
): Record<string, unknown> {
  const summary: Record<string, unknown> = { typeofValue: observation.typeofValue };
  for (const field of ["tag", "sameAsArgument", "echoesArgument"] as const) {
    const value = observation[field];
    if (value !== undefined) summary[field] = value;
  }
  return summary;
}

/**
 * The stage payload for one offered value, with the same richest-first fallback
 * v2 uses: full, then without the per-attempt argument descriptions.
 */
export function fitStage(
  stage: string,
  full: Record<string, unknown>,
  lean: Record<string, unknown>,
  budget = LOAD_STAGE_BYTES,
): Record<string, unknown> {
  const candidates: BudgetCandidate[] = [
    { form: "full", payload: full },
    { form: "lean", payload: lean },
  ];
  return fitToBudgetWith(v3ReportLine, stage, candidates, budget).payload;
}

/* ------------------------------------------------------------------- verdict */

/** What one offered value produced, per binding. */
export interface OfferOutcome {
  /** The binding that was called. */
  binding: string;
  /** The case label, so two cases of one binding stay apart. */
  label: string;
  outcome: "returned" | "threw";
  /** The engine's message when it threw, so a type demand stays verbatim. */
  message?: string;
  /**
   * Whether the candidate value itself was the first argument.
   *
   * Only a direct offer answers "is this value a handle". An array that contains
   * the value is a different question, and the API 33 capture proved why it
   * matters: `__AdoptStyleSheet([value])` *returned* while
   * `__AdoptStyleSheet(value)` threw `param 0 should be RefCounted`. Counting the
   * array case would have reported a stylesheet handle the host never handed out.
   */
  direct: boolean;
}

/**
 * The bindings whose return is evidence that a value is a usable **style object**.
 *
 * A style object and a stylesheet handle are different things on this host, and
 * conflating them is what a previous card did. These four bindings take a style
 * object; their return is an answer about whether the value is one.
 */
export const STYLE_OBJECT_BINDINGS = [
  "__SetStyleObject",
  "__GetComputedStyleByKey",
  "__SetParsedStyles",
  "__UpdateStyleObject",
] as const;

/**
 * The only binding whose return is evidence of a **stylesheet handle**.
 *
 * Adopt's own error text names the type it wants — `param 0 should be RefCounted`
 * — so whether it accepts a value is the host answering the stylesheet-handle
 * question directly. Nothing else in the fourteen-name surface does.
 */
export const STYLESHEET_HANDLE_BINDINGS = ["__AdoptStyleSheet"] as const;

/**
 * The bindings that are called but deliberately excluded from both verdicts.
 *
 * Listed with the reason so a capture reader does not have to reconstruct why a
 * returned `null` from replace did not count as an accepted handle.
 */
export const VERDICT_EXCLUDED_BINDINGS = [
  "__ReplaceStyleSheets",
  "__LoadStyleSheet",
] as const;

/** Which of the two answers a binding's return speaks to. */
export type VerdictCategory = "style-object" | "stylesheet-handle" | "excluded";

/**
 * Categorises a binding for the verdict.
 *
 * Exported so the card, the verifier's rules and the tests read one list rather
 * than three copies, and so a binding added to the surface is not silently
 * counted as evidence for a question it does not answer.
 */
export function offerCategory(name: string): VerdictCategory {
  if ((STYLE_OBJECT_BINDINGS as readonly string[]).includes(name)) return "style-object";
  if ((STYLESHEET_HANDLE_BINDINGS as readonly string[]).includes(name)) {
    return "stylesheet-handle";
  }
  return "excluded";
}

/**
 * The two answers this card can give, each derived only from calls it recorded.
 *
 * They are kept apart because the first API 33 run of this card showed they have
 * different answers: the value `__CreateStyleObject` returns is accepted by the
 * style bindings — so it is a usable opaque **style object** — while
 * `__AdoptStyleSheet` rejects the same value by naming `RefCounted`, so it is not
 * a **stylesheet handle**. One field for both would have hidden that.
 *
 * Every rejection is recorded with the host's own words, and no field here
 * paraphrases them.
 */
export interface HandleVerdict {
  /** How many candidate values the host returned. */
  candidatesReturned: number;
  /** The create cases that produced them. */
  candidateLabels: string[];
  /** Bindings that accepted the value as a style object. */
  styleObjectAcceptedBy: string[];
  /** Bindings that rejected it as a style object, with the engine's message. */
  styleObjectRejectedBy: { binding: string; message: string }[];
  /** Bindings that accepted it as a stylesheet handle (adopt is the only one). */
  stylesheetHandleAcceptedBy: string[];
  /** Bindings that rejected it as a stylesheet handle. */
  stylesheetHandleRejectedBy: { binding: string; message: string }[];
  /**
   * Handle-binding calls that did not pass the value itself, recorded but not read
   * as evidence. An array holding the value is a different question.
   */
  nonDirectHandleOffers: { binding: string; label: string; outcome: string }[];
  /** Bindings that were called but whose return answers neither question. */
  excludedBindings: string[];
  /** Whether any rejection named the native type adopt demands. */
  refCountedDemandRecorded: boolean;
  /** Whether a load call returned a non-null object, the only handle source left. */
  loadReturnedObject: boolean;
  styleObjectVerdict: "style-binding-accepted-the-value" | "no-style-binding-accepted-the-value";
  stylesheetHandleVerdict: "adopt-accepted-the-value" | "no-adopt-accepted-the-value";
  /** The rule the verdict was computed by, so it is not re-derived by a reader. */
  rule: string;
}

export interface VerdictInput {
  candidates: readonly Candidate[];
  /** Every offer made to a binding, in call order. */
  offers: readonly OfferOutcome[];
  /** Whether `__LoadStyleSheet` returned anything other than `null`/`undefined`. */
  loadReturnedObject: boolean;
  /** The word the host uses for the native type it demands, if it used one. */
  nativeTypeDemand?: string;
}

export function deriveHandleVerdict(input: VerdictInput): HandleVerdict {
  const demand = input.nativeTypeDemand ?? "RefCounted";

  const styleObjectOffers = input.offers.filter(offer => offerCategory(offer.binding)
    === "style-object");
  const handleOffers = input.offers.filter(offer => offerCategory(offer.binding)
    === "stylesheet-handle" && offer.direct);
  const nonDirectHandleOffers = input.offers.filter(offer => offerCategory(offer.binding)
    === "stylesheet-handle" && !offer.direct);

  const acceptedBindings = (offers: readonly OfferOutcome[]): string[] =>
    [...new Set(offers.filter(offer => offer.outcome === "returned")
      .map(offer => offer.binding))];
  const rejections = (offers: readonly OfferOutcome[]): { binding: string; message: string }[] =>
    offers.filter(offer => offer.outcome === "threw")
      .map(offer => ({ binding: offer.binding, message: offer.message ?? "" }));

  const styleObjectAcceptedBy = acceptedBindings(styleObjectOffers);
  const stylesheetHandleAcceptedBy = acceptedBindings(handleOffers);
  const rejected = rejections(input.offers);

  return {
    candidatesReturned: input.candidates.length,
    candidateLabels: input.candidates.map(candidate => candidate.label),
    styleObjectAcceptedBy,
    styleObjectRejectedBy: rejections(styleObjectOffers),
    stylesheetHandleAcceptedBy,
    stylesheetHandleRejectedBy: rejections(handleOffers),
    nonDirectHandleOffers: nonDirectHandleOffers.map(offer => ({
      binding: offer.binding,
      label: offer.label,
      outcome: offer.outcome,
    })),
    excludedBindings: [...new Set(input.offers
      .filter(offer => offerCategory(offer.binding) === "excluded")
      .map(offer => offer.binding))],
    refCountedDemandRecorded: rejected.some(entry => entry.message.includes(demand)),
    loadReturnedObject: input.loadReturnedObject,
    styleObjectVerdict: styleObjectAcceptedBy.length > 0
      ? "style-binding-accepted-the-value"
      : "no-style-binding-accepted-the-value",
    stylesheetHandleVerdict: stylesheetHandleAcceptedBy.length > 0
      ? "adopt-accepted-the-value"
      : "no-adopt-accepted-the-value",
    rule: "A value is a usable style object only when one of "
      + STYLE_OBJECT_BINDINGS.join(", ") + " accepted it, and a stylesheet handle only"
      + " when " + STYLESHEET_HANDLE_BINDINGS.join(", ") + " accepted it; the two are"
      + " separate answers and are reported separately."
      + " A handle-binding call is evidence only when the value itself was its first"
      + " argument; an array holding the value is recorded as a different question."
      + " __ReplaceStyleSheets and __LoadStyleSheet are recorded but excluded:"
      + " replace returned null for [] as well, so its return says nothing about the"
      + " value. Rejections keep the engine's own words, and a message naming " + demand
      + " is the host saying which native type it requires. No handle is inferred from a"
      + " name, a return shape, or an arity.",
  };
}

/**
 * Attempts that were offered a card-created value, flattened to one list.
 *
 * Used by the verdict so `accepted` and `rejected` are read off real calls rather
 * than counted by hand in the card. Read-only bindings are included: a
 * `__GetComputedStyleByKey` that returned with the candidate as its first
 * argument is evidence the host resolved it.
 */
export function offersFrom(
  tables: readonly { name: string; run: AttemptRun }[],
  candidate?: unknown,
): OfferOutcome[] {
  const offers: OfferOutcome[] = [];
  for (const table of tables) {
    table.run.attempts.forEach(attempt => {
      offers.push({
        binding: table.name,
        label: attempt.label,
        outcome: attempt.outcome,
        ...(attempt.call.threw !== undefined
          ? { message: attempt.call.threw.message }
          : {}),
        direct: candidate !== undefined && argumentOf(attempt) === candidate,
      });
    });
  }
  return offers;
}

/** Splits offers into the accepted and rejected lists, for callers that need both. */
export function splitOffers(offers: readonly OfferOutcome[]): {
  accepted: OfferOutcome[];
  rejected: OfferOutcome[];
} {
  return {
    accepted: offers.filter(offer => offer.outcome === "returned"),
    rejected: offers.filter(offer => offer.outcome === "threw"),
  };
}


/**
 * Whether a returned value is anything other than a nullish primitive.
 *
 * `typeof` can report `"unknown"` on this engine: a host object created by the
 * native side has a class ID QuickJS does not recognise, and QuickJS answers with
 * that word rather than `"object"`. It is still an object for this purpose, and
 * treating it as a primitive is exactly the mistake that made a previous card
 * record zero handles for a value the host had handed it.
 */
export function isObjectish(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  // `typeof` is typed as the standard set, but QuickJS answers "unknown" for a
  // host object whose class ID it does not know, so the string is compared as one.
  const type = typeof value as string;
  return type === "object" || type === "function" || type === "unknown";
}

/** The cleanup verbs the host's own style-named surface contains, if any. */
export function releaseScopedNames(scope: object): string[] {
  return styleGlobalNames(scope).filter(name => RELEASE_VERB.test(name));
}

/** The style globals this card describes, for the inventory stage. */
export function describeInventory(scope: object): V2Inventory {
  return describeGlobalInventory(scope);
}

/** The report line for one stage of this card. */
export function v3ReportLine(stage: string, payload: Record<string, unknown>): string {
  return `${STYLESHEET_V3_MARKER} ${JSON.stringify({
    probe: STYLESHEET_V3_PROBE,
    stage,
    ...payload,
  })}`;
}

/** Re-exported so the card imports its value descriptions from one place. */
export {
  LOAD_STAGE_BYTES,
  describeValue,
  styleGlobalNames,
  type AttemptRun,
  type BudgetCandidate,
  type ErrorTable,
  type ProbeCall,
  type ProbeValue,
  type V2Attempt,
};