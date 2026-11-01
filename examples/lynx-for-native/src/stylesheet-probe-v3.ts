/**
 * Native stylesheet PAPI probe, third attempt: the handle question.
 *
 * v1 measured that `__LoadStyleSheet`, `__AdoptStyleSheet` and
 * `__ReplaceStyleSheets` exist and that a one-argument load throws. v2 measured
 * what the load's second parameter is — a String — and that a load that reaches a
 * served stylesheet returns `null`. Neither card ever handed a value back to the
 * host and watched what the host did with it, so adoption, replacement, ownership
 * and cleanup were never exercised. This card does exactly that, and nothing else.
 *
 * The chain it runs, in order:
 *
 * 1. `__CreateStyleObject` with eight argument shapes, six of which v2 never
 *    tried. The arguments carry a marker, so the capture can separate "the host
 *    echoed what it was given" from "the host built something new".
 * 2. Every value the host returned is kept as a **candidate** — no predicate
 *    decides in advance that it is not a handle. v2's own capture recorded
 *    `returnedHandles: 0` for a returned plain object even though the committed
 *    `isOpaqueHandle` predicate is true for exactly that value; whatever caused
 *    that, this card does not repeat it.
 * 3. Each candidate is offered, alone, to `__SetStyleObject`,
 *    `__UpdateStyleObject`, `__SetParsedStyles` and `__GetComputedStyleByKey`.
 *    A return is acceptance; a throw is the host's own type check, recorded
 *    verbatim.
 * 4. `__LoadStyleSheet`, `__AdoptStyleSheet` and `__ReplaceStyleSheets` are
 *    retried with the shapes v2 measured, plus shapes carrying the candidate.
 * 5. `handle-verdict` derives the answer from those calls only, and the summary
 *    says what is still unmeasured even if the answer is complete.
 *
 * What keeps this a measurement: every argument is a literal the card builds, a
 * URL this card really serves, or a value the host returned to this card in this
 * run. Nothing is fabricated to satisfy an arity, and no stage claims a rule was
 * applied, a sheet is owned, or a sheet can be removed.
 */

import { createLynxRoot, ensureLynxEnvironmentBasics } from "@apothic-ai/solid-lynx";
import type { LynxNode, LynxRoot } from "@apothic-ai/solid-lynx";
import { safeCall } from "./stylesheet-probe-report.js";
import {
  LOAD_STAGE_BYTES,
  STYLESHEET_V3_READBACK_GLOBALS,
  STYLESHEET_V3_STAGES,
  STYLE_OBJECT_SETTERS,
  adoptRetryCases,
  candidatesFrom,
  createStyleObjectCases,
  deriveHandleVerdict,
  describeInventory,
  describeRun,
  fitStage,
  isObjectish,
  loadRetryCases,
  offersFrom,
  presentCandidateSummary,
  presentObservation,
  releaseScopedNames,
  replaceRetryCases,
  runWithArguments,
  splitOffers,
  styleGlobalNames,
  styleObjectSetterCases,
  v3ReportLine,
  type AttemptRun,
  type Candidate,
  type ErrorTable,
  type HandleVerdict,
  type OfferOutcome,
  type SetterTable,
} from "./stylesheet-probe-v3-report.js";

interface LynxEngine {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

declare const lynx: {
  getEngine(): LynxEngine;
};

/**
 * Served beside the bundle by the loopback server the run uses.
 *
 * Both files already exist for v1 and v2, and both match nothing this card
 * renders. Passing `url2` again keeps this run's `[url, url2]` case at the same
 * target v2 measured, so the two captures are comparable rather than merely
 * similar.
 */
const CSS_URL = "http://127.0.0.1:8099/probe.css";
const CSS_URL_2 = "http://127.0.0.1:8099/probe-2.css";

const scope = globalThis as unknown as Record<string, unknown>;

ensureLynxEnvironmentBasics();

/** Every bounded run this card performed, in stage order. */
const runs: AttemptRun[] = [];
/** The interned engine errors, keyed `e0`, `e1`, …. */
const errors: ErrorTable = {};
/** Values the host returned from `__CreateStyleObject`. */
let candidates: Candidate[] = [];
/** Every candidate offer made to a binding, accepted or rejected. */
const offers: OfferOutcome[] = [];
/** The derived answer, carried into the summary so a reader does not page back. */
let verdict: HandleVerdict | undefined;
/** Whether a load ever returned something other than `null`. */
let loadReturnedObject = false;

function binding(name: string): unknown {
  return scope[name];
}

/** Records one bounded run so the summary can count what was attempted. */
function track(run: AttemptRun): AttemptRun {
  runs.push(run);
  return run;
}

/** Stages already logged in this card. */
const logged = new Set<string>();

/**
 * Logs one stage, catching anything the stage itself throws.
 *
 * Per stage rather than around the whole card, for the same reason v1 and v2 do
 * it: the evidence is in the earlier lines, so a stage that throws must not take
 * the capture with it. A repeated stage is dropped rather than logged twice,
 * because `__RenderPage` can fire more than once in an Explorer session and two
 * runs in one capture would make every bounded experiment ambiguous.
 */
function stage(name: string, build: () => Record<string, unknown>): void {
  if (logged.has(name)) return;
  logged.add(name);
  try {
    console.log(v3ReportLine(name, build()));
  } catch (error) {
    const thrown = error as { name?: unknown; message?: unknown } | null;
    console.log(v3ReportLine(name, {
      threw: {
        name: typeof thrown?.name === "string" ? thrown.name : "Error",
        message: typeof thrown?.message === "string" ? thrown.message : String(error),
      },
    }));
  }
}

/** A budget-checked stage payload, with v2's richest-first fallback. */
function fitted(stageName: string, full: Record<string, unknown>,
  lean: Record<string, unknown>): Record<string, unknown> {
  return fitStage(stageName, full, lean);
}

/* ------------------------------------------------------------------- stages */

/**
 * Stage 1: every style-named global, described from the host's own binding.
 *
 * The payload is v2's inventory payload under this card's stage name, on purpose:
 * the two captures then compare field for field, and the verifier can apply the
 * same checks to both.
 */
function probeInventory(): void {
  stage("inventory-v3", () => {
    const inventory = describeInventory(scope);
    const names = styleGlobalNames(scope);
    return fitted("inventory-v3",
      { ...inventory, names, stageBytes: LOAD_STAGE_BYTES },
      { ...inventory, stageBytes: LOAD_STAGE_BYTES, namesOmitted: names.length });
  });
}

/** The style-named globals, read from the host at call time. */
function scopeStyleNames(): string[] {
  return styleGlobalNames(scope);
}

/**
 * Stage 2: does `__CreateStyleObject` hand back a handle, or build a plain object?
 *
 * Six of the eight shapes are new. The marker in each argument is what makes the
 * answer readable: if the returned value carries it, the binding echoed its
 * input; if the returned value is a fresh object with no readable keys, it built
 * something this card now has to offer back to a binding to learn what it is.
 */
function probeCreateStyleObject(): void {
  stage("create-style-object", () => {
    const create = binding("__CreateStyleObject");
    if (typeof create !== "function") {
      return {
        exposed: false,
        typeofCreate: typeof create,
        candidatesReturned: 0,
        note: "The host exposes no __CreateStyleObject, so there is no value to offer"
          + " back and no handle question to answer on this engine.",
      };
    }

    const run = track(runWithArguments(create, createStyleObjectCases()));
    candidates = candidatesFrom(run);

    const observations = candidates.map((candidate, index) => ({
      label: candidate.label,
      ...(index === 0
        ? presentObservation(candidate.observation)
        : presentCandidateSummary(candidate.observation)),
    }));

    const full = {
      exposed: true,
      ...describeRun(run, errors),
      errors,
      candidatesReturned: candidates.length,
      candidates: observations,
      stageBytes: LOAD_STAGE_BYTES,
    };
    const lean = {
      exposed: true,
      // The argument descriptions and the grouping echo are the two things a
      // reader can derive from the labels and the attempts, so they are what the
      // budget fallback gives up first.
      ...withoutGroups(describeRun(run, errors, true, false)),
      argumentsOmitted: run.attempts.map(attempt => attempt.label),
      candidatesReturned: candidates.length,
      candidates: observations,
      stageBytes: LOAD_STAGE_BYTES,
    };
    return fitted("create-style-object", full, lean);
  });
}

/**
 * Stage 3: offer each candidate, alone, to every setter.
 *
 * Only values the host returned are passed. A binding that returns is recorded as
 * accepting the value; a binding that throws is recorded with its own message,
 * which for `__AdoptStyleSheet` names the native type it requires. One rejecting
 * binding does not stop the others, and the candidate is never re-created or
 * wrapped to make a call succeed.
 */
function probeStyleObjectSetters(): void {
  stage("style-object-setters", () => {
    const candidate = candidates[0];
    if (candidate === undefined) {
      return {
        candidateAvailable: false,
        skipped: "No __CreateStyleObject case returned a value, so no setter was called:"
          + " there is nothing to offer, and inventing one would measure the probe rather"
          + " than the host.",
      };
    }

    const tables: { name: string; run: AttemptRun }[] = [];
    const followUps = styleObjectSetterCases(candidate.value).map((table: SetterTable) => {
      // Written before the call, so a native crash mid-call still names the binding
      // that was being offered the value. These are extras to the verifier, not
      // required stages: they exist because the first run of this card died with a
      // SIGSEGV inside the setter stage and the capture could not say which call
      // did it.
      console.log(v3ReportLine("offer-start", {
        binding: table.name,
        candidateLabel: candidate.label,
      }));
      const run = track(runWithArguments(binding(table.name), table.cases));
      tables.push({ name: table.name, run });
      // The shared error table lives on `create-style-object`; repeating it here
      // would cost more than the four short messages this stage writes out.
      return { name: table.name, ...describeRun(run, errors, false, false) };
    });

    offers.push(...offersFrom(tables, candidate.value));

    const payload = {
      candidateAvailable: true,
      candidateLabel: candidate.label,
      candidate: presentObservation(candidate.observation),
      followUps,
      setterNames: [...STYLE_OBJECT_SETTERS],
    } as const;
    const plain = { ...payload } as Record<string, unknown>;
    const leanUps = followUps.map(entry => {
      const copy: Record<string, unknown> = { ...entry };
      delete copy.groups;
      return copy;
    });
    return fitted("style-object-setters", plain,
      { ...plain, followUps: leanUps, candidateOmitted: true });
  });
}

/**
 * Stage 4: `__LoadStyleSheet`, at the shapes v2 measured plus two new ones.
 *
 * If a load could hand out a handle, this is the binding to ask: it is the one
 * that reaches a stylesheet. The repeated cases make this run comparable with
 * v2's; the candidate cases are the experiment.
 */
function probeLoadRetry(): void {
  stage("load-retry", () => {
    const candidate = candidates[0]?.value;
    const run = track(runWithArguments(binding("__LoadStyleSheet"),
      loadRetryCases(CSS_URL, CSS_URL_2, candidate)));
    loadReturnedObject = run.raw.some(isObjectish);

    return fitted("load-retry",
      {
        ...describeRun(run, errors, true, false),
        candidateAvailable: candidate !== undefined,
        loadReturnedObject,
        stageBytes: LOAD_STAGE_BYTES,
      },
      {
        ...withoutGroups(describeRun(run, errors, true, false)),
        candidateAvailable: candidate !== undefined,
        loadReturnedObject,
        stageBytes: LOAD_STAGE_BYTES,
      });
  });
}

/**
 * Stage 5: `__AdoptStyleSheet`, which is where the host names its native type.
 *
 * v2 measured `AdoptStyleSheet param 0 should be RefCounted` for `null` and `{}`.
 * Offering the candidate is the direct question: is a value this host produced
 * itself a `RefCounted`?
 */
function probeAdoptRetry(): void {
  stage("adopt-retry", () => {
    const candidate = candidates[0]?.value;
    const run = track(runWithArguments(binding("__AdoptStyleSheet"),
      adoptRetryCases(candidate)));
    offers.push(...offersFrom([{ name: "__AdoptStyleSheet", run }], candidate));

    return {
      ...withoutGroups(describeRun(run, errors, false, false)),
      candidateAvailable: candidate !== undefined,
    };
  });
}

/**
 * Stage 6: `__ReplaceStyleSheets` with sets the card can build.
 *
 * A set holding the candidate is a real question even though v2 measured empty
 * sets returning `null`: a binding that silently accepts anything has not been
 * shown to accept a stylesheet.
 */
function probeReplaceRetry(): void {
  stage("replace-retry", () => {
    const candidate = candidates[0]?.value;
    const run = track(runWithArguments(binding("__ReplaceStyleSheets"),
      replaceRetryCases(candidate)));
    offers.push(...offersFrom([{ name: "__ReplaceStyleSheets", run }], candidate));

    return {
      ...withoutGroups(describeRun(run, errors, false, false)),
      candidateAvailable: candidate !== undefined,
    };
  });
}

/**
 * Stage 7: the answer, derived only from the calls above.
 *
 * `deriveHandleVerdict` is the single place the rule lives: a value is an opaque
 * handle only if a binding accepted it. The fields beside the verdict are the
 * evidence it was computed from, so a reader does not have to re-derive it and
 * the verifier can check the verdict against its own inputs.
 */
function probeHandleVerdict(): void {
  stage("handle-verdict", () => {
    verdict = deriveHandleVerdict({
      candidates,
      offers,
      loadReturnedObject,
      // The word comes from the engine, not from this card: adopt's type check is
      // where it was measured (`AdoptStyleSheet param 0 should be RefCounted`).
      nativeTypeDemand: "RefCounted",
    });

    return {
      ...verdict,
      candidate: candidates[0] === undefined
        ? null
        : { label: candidates[0].label, ...presentObservation(candidates[0].observation) },
    };
  });
}

/** The same description without its grouping echo. */
function withoutGroups(described: Record<string, unknown>): Record<string, unknown> {
  const { groups: _groups, ...rest } = described;
  return rest;
}

/**
 * Stage 8: what the card's own styles look like afterwards, and what cleanup the
 * host even names.
 *
 * Read-only bindings only, run last. `releaseScopedNames` is derived from the
 * host's own property names: a surface with no cleanup verb in it is a measured
 * statement about cleanup, not an inference about ownership.
 */
function probeLifecycle(): void {
  stage("lifecycle", () => {
    const readbacks = STYLESHEET_V3_READBACK_GLOBALS.map(name => {
      const fn = binding(name);
      const call = safeCall(fn, []);
      return {
        name,
        exposed: typeof fn === "function",
        ...(call.threw !== undefined ? { threw: call.threw } : { returned: call.returned }),
      };
    });

    return {
      callsThatReturned: runs.reduce((total, run) =>
        total + run.attempts.filter(attempt => attempt.outcome === "returned").length, 0),
      anyHandleReturned: verdict?.stylesheetHandleVerdict === "adopt-accepted-the-value",
      styleObjectHandleObserved: verdict?.styleObjectVerdict
        === "style-binding-accepted-the-value",
      readbacks,
      releaseScopedNames: releaseScopedNames(scope),
      styleGlobalsDescribed: scopeStyleNames().length,
      claim: "measured calls only",
      note: "These are the card's own styles read back through read-only bindings after"
        + " every write this card performed. The stylesheets served match nothing this"
        + " card renders, so a successful load and an unchanged readback are compatible"
        + " with each other: this stage can show that a call did not break the card, and"
        + " cannot show that a rule was applied.",
    };
  });
}

/**
 * Stage 9: counters, the answer, and what is still unmeasured.
 *
 * The `unmeasured` entries are built from the verdict rather than written in
 * advance, so a run that found a handle would not claim it found none.
 */
function probeSummary(): void {
  stage("summary", () => {
    const measuredThrew = runs.reduce((total, run) =>
      total + run.attempts.filter(attempt => attempt.outcome === "threw").length, 0);
    const measuredReturned = runs.reduce((total, run) =>
      total + run.attempts.filter(attempt => attempt.outcome === "returned").length, 0);

    const handleAnswer = verdict?.stylesheetHandleVerdict ?? "no-adopt-accepted-the-value";
    const styleObjectAnswer = verdict?.styleObjectVerdict ?? "no-style-binding-accepted-the-value";
    const unmeasured: { operation: string; reason: string }[] = [];

    if (handleAnswer === "no-adopt-accepted-the-value") {
      unmeasured.push({
        operation: "adopting, replacing, or releasing a real stylesheet",
        reason: "No binding accepted a value this card received as a stylesheet handle, so"
          + " nothing was adopted and no set was replaced with a member. The calls that"
          + " could run are recorded above and each rejection carries the engine's own"
          + " message.",
      });
    }

    if (styleObjectAnswer === "no-style-binding-accepted-the-value") {
      unmeasured.push({
        operation: "what the value __CreateStyleObject returns can be used for",
        reason: "None of the style bindings accepted it, so this run did not establish that"
          + " the value is a style object either.",
      });
    }

    unmeasured.push({
      operation: "whether a loaded stylesheet's rules are applied",
      reason: "This card has no binding that reports an applied rule. The stylesheets it"
        + " serves match nothing it renders, so a load that returns and an unchanged"
        + " readback are compatible with each other and neither proves application.",
    });

    unmeasured.push({
      operation: "cleanup of a loaded stylesheet",
      reason: "The lifecycle stage records every style-named global whose name carries a"
        + " release, destroy, free, unload, remove, dispose, delete or cleanup verb. An"
        + " empty list is the measurement that there is no cleanup call this card could"
        + " make; it is not evidence about whether the engine cleans up on its own.",
    });

    return {
      stagesLogged: [...STYLESHEET_V3_STAGES],
      globalsDescribed: scopeStyleNames().length,
      boundedRuns: runs.length,
      attemptsRecorded: runs.reduce((total, run) => total + run.attempts.length, 0),
      callsThatThrew: measuredThrew,
      callsThatReturned: measuredReturned,
      candidatesReturned: candidates.length,
      offersMade: offers.length,
      handleQuestion: handleAnswer,
      styleObjectQuestion: styleObjectAnswer,
      loadReturnedObject,
      verdictFields: verdict === undefined ? null : {
        styleObjectAcceptedBy: verdict.styleObjectAcceptedBy,
        stylesheetHandleAcceptedBy: verdict.stylesheetHandleAcceptedBy,
        rejectedBindings: [...new Set([
          ...verdict.styleObjectRejectedBy,
          ...verdict.stylesheetHandleRejectedBy,
        ].map(entry => entry.binding))],
        refCountedDemandRecorded: verdict.refCountedDemandRecorded,
      },
      unmeasured,
    };
  });
}

/** The stages this card has logged, in order. */
function loggedStages(): string[] {
  return [...logged];
}

/* --------------------------------------------------------------------- card */

function renderCard(): void {
  const host = scope as {
    __GetPageElement?: () => LynxNode | null | undefined;
    __CreatePage?: (componentId: string, cssId: number) => LynxNode;
  };
  const page = host.__GetPageElement?.() ?? host.__CreatePage?.("0", 0);
  if (!page) throw new Error("solid-lynx stylesheet probe v3: no page element");

  const root: LynxRoot = createLynxRoot({ page });

  root.render(() => {
    const card = root.renderer.createElement("view");
    const label = root.renderer.createElement("text");
    root.renderer.setProp(card, "id", "stylesheet-probe-v3");
    root.renderer.setProp(label, "id", "stylesheet-probe-v3-label");
    root.renderer.insert(label, "Native stylesheet PAPI probe v3");
    root.renderer.insert(card, label);
    return card;
  });
  root.flush();

  probeInventory();
  probeCreateStyleObject();
  probeStyleObjectSetters();
  probeLoadRetry();
  probeAdoptRetry();
  probeReplaceRetry();
  probeHandleVerdict();
  probeLifecycle();
  probeSummary();

  console.log(v3ReportLine("done", { status: "all stages logged" }));
}

const engine = lynx.getEngine();
engine.addEventListener("__RenderPage", renderCard);
engine.addEventListener("__DestroyLifetime", () => {
  // The card holds no host resource of its own, and it deliberately does not try
  // to release a stylesheet: no cleanup contract was measured, so calling one
  // would be a guess.
});