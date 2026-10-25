/**
 * Native stylesheet PAPI probe, second attempt.
 *
 * The v1 card (`stylesheet-probe.ts`) measured what it could without a handle and
 * left one question open. Its device capture is the starting point here, and it
 * settled two things:
 *
 * - `__LoadStyleSheet`, `__AdoptStyleSheet` and `__ReplaceStyleSheets` all report
 *   `fn.length === 0`, so an arity is not a signature.
 * - `__LoadStyleSheet` throws `error code: 111101 / error message: LoadStyleSheet
 *   param size should >= 2` for a call with no arguments **and** for a call with a
 *   single string URL. So the second parameter is not optional, and v1 never
 *   identified it. `__AdoptStyleSheet` reports
 *   `AdoptStyleSheet param size should >= 1`, and `__ReplaceStyleSheets` returned
 *   `null` with no arguments rather than throwing.
 *
 * This card answers one question — what is that second parameter — with a bounded
 * list of experiments whose arguments the card constructs itself, and asks a
 * second: is there a style-object path through `__CreateStyleObject` and
 * `__SetParsedStyles` that never needs a stylesheet handle at all? v1's inventory
 * listed eight such globals and examined none of them.
 *
 * What keeps this a measurement rather than an integration:
 *
 * - every argument is a URL this card really serves, a primitive, or a value the
 *   card itself produced. Nothing is fabricated and passed off as a host handle;
 * - the card is disposable and its own styles are read back through read-only
 *   bindings, so a successful load is observed rather than assumed;
 * - every stage is wrapped, so a throwing binding logs its own line and the stages
 *   after it still run. A stage that fails is a result, not a crash;
 * - the report says which of the eight load attempts separated and which did not.
 *   If all eight produce the identical error, that is the finding: the binding
 *   needs a parameter this probe cannot supply, and it is recorded that way
 *   instead of being papered over.
 */

import { createLynxRoot, ensureLynxEnvironmentBasics } from "solid-lynx";
import type { LynxNode, LynxRoot } from "solid-lynx";
import { describeValue, safeCall } from "./stylesheet-probe-report.js";
import {
  LOAD_STAGE_BYTES,
  STYLESHEET_V2_READBACK_GLOBALS,
  adoptStyleSheetCases,
  describeGlobalInventory,
  firstArrayHandle,
  firstHandle,
  fitToBudget,
  groupOutcomes,
  internError,
  loadStyleSheetCases,
  replaceStyleSheetsCases,
  runCases,
  styleGlobalNames,
  v2ReportLine,
  type AttemptCase,
  type AttemptRun,
  type CapturedHandle,
} from "./stylesheet-probe-v2-report.js";

interface LynxEngine {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

declare const lynx: {
  getEngine(): LynxEngine;
};

/**
 * Served beside the bundle by the loopback server the device run uses.
 *
 * Both are inert on their own: the rules in them match nothing the card renders,
 * so a load that succeeds cannot change what a later readback reports. The second
 * URL exists because `[url, url2]` has to be a *different* stylesheet from
 * `[url]` — passing the same URL twice would not separate "the second parameter
 * is a stylesheet URL" from "the binding ignores its second parameter".
 */
const CSS_URL = "http://127.0.0.1:8099/probe.css";
const CSS_URL_2 = "http://127.0.0.1:8099/probe-2.css";

const scope = globalThis as unknown as Record<string, unknown>;

ensureLynxEnvironmentBasics();

/** Every bounded run this card performed, in stage order. */
const runs: AttemptRun[] = [];
/** The handles `__CreateStyleObject` handed back, which only this card has seen. */
let styleObjectHandles: CapturedHandle[] = [];
/** What the lifecycle stage found once everything else had run. */
let lifecycle: Record<string, unknown> | undefined;

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
 * The guard is per stage rather than around the whole card because the evidence
 * is in the earlier lines: a stage that throws must not take the capture with it.
 *
 * A stage that has already logged is not run again. `__RenderPage` can fire more
 * than once in an Explorer session, and v1's capture shows a card rendering twice;
 * a second pass would emit every stage twice and every bounded experiment would
 * run against a card a first pass had already called those bindings on. The
 * verifier treats a repeated stage as a finding for the same reason.
 */
function stage(name: string, build: () => Record<string, unknown>): void {
  if (logged.has(name)) return;
  logged.add(name);
  try {
    console.log(v2ReportLine(name, build()));
  } catch (error) {
    const thrown = error as { name?: unknown; message?: unknown } | null;
    console.log(v2ReportLine(name, {
      threw: {
        name: typeof thrown?.name === "string" ? thrown.name : "Error",
        message: typeof thrown?.message === "string" ? thrown.message : String(error),
      },
    }));
  }
}

/**
 * The same description without its grouping echo.
 *
 * `groups` only restates which attempts produced the same answer, and a reader can
 * derive it from the attempts; the argument descriptions cannot be derived from
 * anything, so they are the last thing to go rather than the first.
 */
function withoutGroups(described: Record<string, unknown>): Record<string, unknown> {
  const { groups: _groups, ...rest } = described;
  return rest;
}

/**
 * The error text this card has already written, keyed `e0`, `e1`, ….
 *
 * A run where every case failed with the identical engine error would otherwise
 * repeat that error eight times and put the stage line over the size the console
 * bridge has been observed to deliver. Interning keeps the message verbatim and
 * written once; each attempt references its key.
 */
const errors: Record<string, string> = {};

/** Describes a bounded run for a capture line. `compact` drops argument descriptions. */
function describeRun(run: AttemptRun, compact = false): Record<string, unknown> {
  return {
    attempts: run.attempts.map(attempt => ({
      label: attempt.label,
      ...(compact ? {} : { args: attempt.args }),
      outcome: attempt.outcome,
      ...(attempt.call.threw !== undefined
        ? {
          threw: {
            name: attempt.call.threw.name,
            message: internError(errors, attempt.call.threw.message),
          },
        }
        : { returned: attempt.call.returned }),
    })),
    // Which of the bounded cases separated, and which produced the same answer.
    groups: groupOutcomes(run.attempts).map(group => ({
      outcome: group.outcome,
      detail: group.outcome === "threw" ? internError(errors, group.detail) : group.detail,
      labels: group.labels,
    })),
    returnedHandles: run.handles.length,
  };
}

/* ------------------------------------------------------------------- stages */

/**
 * Stage 1: every style-named global, described from the host's own binding.
 *
 * No call is made, so nothing here can mutate the card. v1 recorded three
 * bindings and a list of fourteen names; this records a description of all
 * fourteen, because the style-object path this card asks about runs through
 * bindings v1 never read.
 */
function probeInventory(): void {
  stage("inventory-v2", () => {
    const inventory = describeGlobalInventory(scope);
    const names = styleGlobalNames(scope);
    // Interning the repeated source and shape text is what keeps this under the
    // budget; `names` is dropped only if a host somehow still overruns, because
    // every name in it is already a `globals` entry.
    const fitted = fitToBudget("inventory-v2", [
      { form: "full", payload: { ...inventory, names, stageBytes: LOAD_STAGE_BYTES } },
      {
        form: "lean",
        payload: {
          ...inventory,
          stageBytes: LOAD_STAGE_BYTES,
          namesOmitted: names.length,
        },
      },
    ]);
    return fitted.payload;
  });
}

/**
 * Stage 2: the core experiment — what the missing second parameter is.
 *
 * Eight argument lists, each one disposable and each one recorded. The cases are
 * ordered so that the load with no second parameter repeats v1's failing call
 * first: if the runtime has changed, that is visible immediately rather than
 * being read as a difference between cases.
 */
function probeLoadStyleSheetArity(): void {
  stage("loadstyle-arity", () => {
    const run = track(runCases(binding("__LoadStyleSheet"),
      loadStyleSheetCases(CSS_URL, CSS_URL_2)));
    // The one stage whose size can overflow the line the bridge delivers, so it is
    // the one stage that measures itself before logging. Richest first.
    const fitted = fitToBudget("loadstyle-arity", [
      { form: "full", payload: { ...describeRun(run), errors, stageBytes: LOAD_STAGE_BYTES } },
      {
        form: "terse",
        payload: {
          ...describeRun(run, true),
          errors,
          stageBytes: LOAD_STAGE_BYTES,
          argumentsOmitted: run.attempts.map(attempt => attempt.label),
        },
      },
      {
        form: "lean",
        payload: {
          ...withoutGroups(describeRun(run, true)),
          errors,
          stageBytes: LOAD_STAGE_BYTES,
          argumentsOmitted: run.attempts.map(attempt => attempt.label),
        },
      },
    ]);
    return fitted.payload;
  });
}

/**
 * Stage 3: what `__AdoptStyleSheet` accepts.
 *
 * Adopting needs a stylesheet handle. The handle case is only attempted when the
 * load stage handed this card a real one, because adopting a fabricated value
 * measures the probe rather than the host.
 */
function probeAdoptArity(): void {
  stage("adopt-arity", () => {
    const loadRun = runs[0];
    const handle = loadRun === undefined ? undefined : firstHandle(loadRun.handles);
    const run = track(runCases(binding("__AdoptStyleSheet"),
      adoptStyleSheetCases(handle)));
    return {
      ...describeRun(run),
      errors,
      // Stated rather than left to be inferred from the labels: whether the
      // handle case was even available is the difference between "the host
      // rejected this handle" and "this card never had one to offer".
      handleAvailable: handle !== undefined,
    };
  });
}

/**
 * Stage 4: what `__ReplaceStyleSheets` accepts.
 *
 * v1 recorded `null` for a call with no arguments, which is why "no arguments" and
 * "an empty array" are separate cases here: one binding could plausibly accept
 * both, and they mean different things.
 */
function probeReplaceArity(): void {
  stage("replace-arity", () => {
    // Anything an earlier stage returned that is array-shaped is the only
    // "stylesheet set" this card has ever seen.
    const candidates = runs.flatMap(run => run.handles);
    const set = firstArrayHandle(candidates);
    const run = track(runCases(binding("__ReplaceStyleSheets"),
      replaceStyleSheetsCases(set)));
    return {
      ...describeRun(run),
      errors,
      setAvailable: set !== undefined,
    };
  });
}

/**
 * Stage 5: does a style-object path exist that needs no stylesheet at all?
 *
 * Only handles this card created are ever passed on. A `__CreateStyleObject`
 * that returns a primitive or `null` did not hand out an opaque handle, and the
 * follow-up calls say so rather than substituting a fabricated value.
 */
function probeStyleObjectPath(): void {
  stage("style-object-path", () => {
    const create = binding("__CreateStyleObject");
    if (typeof create !== "function") {
      return {
        exposed: false,
        typeofCreate: typeof create,
        note: "The host exposes no __CreateStyleObject, so no style-object path can be"
          + " attempted. This is the answer for this engine, not a gap in the probe.",
      };
    }

    const createCases: AttemptCase[] = [
      { label: "no arguments", args: [] },
      { label: "one argument an empty object", args: [{}] },
    ];
    const createRun = track(runCases(create, createCases));
    styleObjectHandles = createRun.handles;

    const { value: handle } = styleObjectHandles.length > 0
      ? styleObjectHandles[0]
      : { value: undefined as unknown };

    // The setters are only called with a handle this card holds. Each is a
    // separate bounded run so one rejecting the handle does not hide the other's
    // answer.
    const setParsedStyles = handle === undefined
      ? undefined
      : track(runCases(binding("__SetParsedStyles"), [
        { label: "one argument the style object this card created", args: [handle] },
        {
          label: "the style object and a parsed style map",
          // The style map is this card's own literal, not a host value: it states
          // what the probe asked to set, and nothing here reads it back as if the
          // host had confirmed it.
          args: [handle, { "probe-marker": [["color", "rgb(1, 1, 1)"]] }],
        },
      ]));

    const setStyleObject = handle === undefined
      ? undefined
      : track(runCases(binding("__SetStyleObject"), [
        { label: "one argument the style object this card created", args: [handle] },
      ]));

    const updateStyleObject = handle === undefined
      ? undefined
      : track(runCases(binding("__UpdateStyleObject"), [
        { label: "one argument the style object this card created", args: [handle] },
      ]));

    return {
      exposed: true,
      ...describeRun(createRun),
      errors,
      handleKind: handle === undefined ? "none" : describeValue(handle).kind,
      handleTypeof: typeof handle,
      followUps: [
        ...(setParsedStyles === undefined
          ? []
          : [{ name: "__SetParsedStyles", ...describeRun(setParsedStyles) }]),
        ...(setStyleObject === undefined
          ? []
          : [{ name: "__SetStyleObject", ...describeRun(setStyleObject) }]),
        ...(updateStyleObject === undefined
          ? []
          : [{ name: "__UpdateStyleObject", ...describeRun(updateStyleObject) }]),
      ],
      followUpsSkipped: handle === undefined
        ? "__CreateStyleObject returned no opaque handle, so no setter was called: a"
          + " fabricated handle would measure the probe rather than the host."
        : null,
    };
  });
}

/**
 * Stage 6: what, if anything, changed.
 *
 * Runs only after every write the card performs, and reads the card back through
 * bindings that cannot mutate anything. A read that throws is recorded, because a
 * binding that cannot even be read is a different answer from one that returns an
 * empty value.
 */
function probeLifecycle(): void {
  stage("lifecycle", () => {
    const succeeded = runs.reduce((total, run) =>
      total + run.attempts.filter(attempt => attempt.outcome === "returned").length, 0);
    const anyHandle = runs.some(run => run.handles.length > 0);

    const readbacks = STYLESHEET_V2_READBACK_GLOBALS.map(name => {
      const fn = binding(name);
      const call = safeCall(fn, []);
      return {
        name,
        exposed: typeof fn === "function",
        ...(call.threw !== undefined ? { threw: call.threw } : { returned: call.returned }),
      };
    });

    // No stylesheet lifecycle is claimed anywhere in this payload. The fields say
    // what was called and what came back; whether the host applied a rule is a
    // question only a rendered, inspected style could answer, and this card has
    // no binding that reports one.
    lifecycle = {
      callsThatReturned: succeeded,
      anyHandleReturned: anyHandle,
      readbacks,
      claim: "measured calls only",
      note: "These are the card's own styles read back through read-only bindings after"
        + " every write this card performed. A successful load and an unchanged readback"
        + " are compatible with each other: the stylesheets served have rules that match"
        + " nothing this card renders, so this stage can show that a call did not break"
        + " the card, and cannot show that a rule was applied.",
    };
    return lifecycle;
  });
}

/**
 * Stage 7: what was measured, and what was not — with the reason.
 *
 * Stated explicitly so the capture cannot be read as claiming a lifecycle it did
 * not observe. Every entry here is derived from what the earlier stages actually
 * recorded, not written in advance.
 */
function probeSummary(): void {
  stage("summary", () => {
    const loadRun = runs[0];
    const loadGroups = loadRun === undefined ? [] : groupOutcomes(loadRun.attempts);
    const distinctAnswers = loadGroups.length;

    const unmeasured: { operation: string; reason: string }[] = [];

    if (distinctAnswers <= 1 && loadRun !== undefined) {
      unmeasured.push({
        operation: "what __LoadStyleSheet's second parameter is",
        reason: "All " + loadRun.attempts.length + " bounded attempts produced the same"
          + " answer, so none of the eight shapes this probe could construct was accepted."
          + " The binding requires a parameter this probe cannot fabricate — most likely a"
          + " host-owned instance or context handle — and that is the finding rather than a"
          + " gap: a value invented to satisfy the arity would measure the probe, not the"
          + " engine.",
      });
    }

    if (!runs.some(run => run.handles.length > 0)) {
      unmeasured.push({
        operation: "adopting and replacing with a real handle",
        reason: "No call in this card returned a handle, so there is nothing to adopt and no"
          + " set to replace with. The cases that could run (null, {}, []) were run and are"
          + " recorded above; the handle cases were skipped rather than fabricated.",
      });
    }

    if (styleObjectHandles.length === 0) {
      unmeasured.push({
        operation: "the style-object setter path",
        reason: typeof binding("__CreateStyleObject") === "function"
          ? "__CreateStyleObject exists but returned no opaque handle, so no setter was"
            + " called with it. Whether a handle is required, and what it looks like when"
            + " one is produced, is left for a probe that has a way to create one."
          : "The host exposes no __CreateStyleObject at all, so there is no style-object"
            + " path to exercise on this engine.",
      });
    }

    unmeasured.push({
      operation: "any stylesheet lifecycle",
      reason: "No ordering, ownership, or cleanup relationship between these operations was"
        + " proven. The card called bindings and recorded their answers; it did not establish"
        + " that a loaded sheet is owned by anything, that it can be removed, or that a rule"
        + " in it was applied.",
    });

    return {
      stagesLogged: [
        "inventory-v2",
        "loadstyle-arity",
        "adopt-arity",
        "replace-arity",
        "style-object-path",
        "lifecycle",
        "summary",
        "done",
      ],
      globalsDescribed: styleGlobalNames(scope).length,
      boundedRuns: runs.length,
      attemptsRecorded: runs.reduce((total, run) => total + run.attempts.length, 0),
      callsThatThrew: runs.reduce((total, run) => total + run.attempts
        .filter(attempt => attempt.outcome === "threw").length, 0),
      callsThatReturned: runs.reduce((total, run) => total + run.attempts
        .filter(attempt => attempt.outcome === "returned").length, 0),
      handlesReturned: runs.reduce((total, run) => total + run.handles.length, 0),
      distinctLoadAnswers: distinctAnswers,
      loadAnswers: loadGroups.map(group => ({
        outcome: group.outcome,
        detail: group.detail,
        labels: group.labels,
      })),
      // Carried through so the summary is readable without paging back to an
      // earlier line whose size the console may have truncated.
      lifecycleObserved: lifecycle !== undefined,
      unmeasured,
    };
  });
}

/* --------------------------------------------------------------------- card */

function renderCard(): void {
  const host = scope as {
    __GetPageElement?: () => LynxNode | null | undefined;
    __CreatePage?: (componentId: string, cssId: number) => LynxNode;
  };
  const page = host.__GetPageElement?.() ?? host.__CreatePage?.("0", 0);
  if (!page) throw new Error("solid-lynx stylesheet probe v2: no page element");

  const root: LynxRoot = createLynxRoot({ page });

  root.render(() => {
    const card = root.renderer.createElement("view");
    const label = root.renderer.createElement("text");
    root.renderer.setProp(card, "id", "stylesheet-probe-v2");
    root.renderer.setProp(label, "id", "stylesheet-probe-v2-label");
    root.renderer.insert(label, "Native stylesheet PAPI probe v2");
    root.renderer.insert(card, label);
    return card;
  });
  root.flush();

  probeInventory();
  probeLoadStyleSheetArity();
  probeAdoptArity();
  probeReplaceArity();
  probeStyleObjectPath();
  probeLifecycle();
  probeSummary();

  console.log(v2ReportLine("done", { status: "all stages logged" }));
}

const engine = lynx.getEngine();
engine.addEventListener("__RenderPage", renderCard);
engine.addEventListener("__DestroyLifetime", () => {
  // The page owns the card for the life of the Explorer session; this probe holds
  // no host resource of its own that has to be released here, and it deliberately
  // does not attempt to release a stylesheet it may have loaded: no cleanup
  // contract was measured, so calling one would be a guess.
});
