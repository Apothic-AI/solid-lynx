/**
 * Recording helpers for the native list-recycling probe.
 *
 * The list card measured create / materialize / keyed reorder / shrink on the
 * API 33 emulator, and in every capture `enqueueComponent` was `0`. Its own
 * summary said why that zero could not be read as an inability: nothing in the
 * card scrolled, and a native list recycles cells in response to a viewport
 * asking for them. This module is the recorder for the card that supplies that
 * viewport and asks for the scroll — and then reports what the host did, which
 * may still be nothing.
 *
 * Two rules shape everything here:
 *
 * - **a zero is a measurement, not an inability.** `recyclingAnswer` always
 *   produces a `reason` when the count is zero, and the verifier requires it.
 *   "The host never called `enqueueComponent` while this card scrolled" is an
 *   answer; "the host cannot recycle" is not something a zero can say.
 * - **nothing is fabricated.** A scroll is attempted through a PAPI the capture
 *   measured as present, with arguments this card builds, and a callback is only
 *   counted when the host actually called it. A `__InvokeUIMethod` that does not
 *   exist is recorded as absent, not stood in for.
 */

import {
  describeValue,
  safeCall,
  type ProbeValue,
} from "./stylesheet-probe-report.js";
import {
  LIST_PAPI_NAMES,
  describeListInventory,
  findListRelatedGlobals,
  type ListInventoryEntry,
} from "./list-probe-report.js";

/** The marker this card logs under. Not a prefix of `[solid-lynx lp]`. */
export const LIST_RECYCLE_MARKER = "[solid-lynx lr]";

/** The `probe` field on every line this card writes. */
export const LIST_RECYCLE_PROBE = "native-list-recycle";

/** The stages this card emits, in order. */
export const LIST_RECYCLE_STAGES = [
  "inventory",
  "create",
  "viewport",
  "scroll",
  "recycle",
  "reorder",
  "summary",
  "done",
] as const;

export type ListRecycleStage = (typeof LIST_RECYCLE_STAGES)[number];

/**
 * Globals that could carry a scroll, recorded whether or not they exist.
 *
 * `__InvokeUIMethod` is the Element PAPI entry point for UI methods on the web
 * host, and it is the only name known to this repository that could move a list
 * from the main thread. The others are recorded because an engine that exposes a
 * direct scroll binding would otherwise look like an engine with none, and the
 * difference between "absent" and "unasked" is exactly what the last list card's
 * summary got right.
 */
export const SCROLL_CANDIDATE_NAMES = [
  "__InvokeUIMethod",
  "__ScrollBy",
  "__ElementScrollBy",
  "__GetScrollInfo",
  "__GetElementUniqueID",
] as const;

/** One bounded scroll attempt. All arguments are built by this card. */
export interface ScrollAttemptCase {
  label: string;
  method: string;
  params: Record<string, unknown>;
}

/**
 * The four UI-method shapes the card tries, in order.
 *
 * The list is bounded and the methods are the ones a Lynx list or scroll view is
 * documented to answer: an absolute offset, a cell index, and a position. Each
 * attempt is separated in the capture so a method that throws does not hide the
 * next one's answer, and none of them is retried — one call, one record.
 */
export function scrollAttemptCases(): ScrollAttemptCase[] {
  return [
    { label: "scrollTo offset 0", method: "scrollTo", params: { offset: 0 } },
    { label: "scrollTo offset 900", method: "scrollTo", params: { offset: 900 } },
    { label: "scrollToIndex 20", method: "scrollToIndex", params: { index: 20 } },
    {
      label: "scrollToPosition 20",
      method: "scrollToPosition",
      params: { position: 20 },
    },
  ];
}

/** Which coordinate a scroll attempt names, and its value. */
export interface ScrollTarget {
  field: "offset" | "index" | "position";
  value: number;
}

/** The coordinate an attempt names, read from the card's own literal. */
export function scrollTarget(attempt: ScrollAttemptCase): ScrollTarget {
  const offset = attempt.params.offset;
  if (typeof offset === "number") return { field: "offset", value: offset };
  const index = attempt.params.index;
  if (typeof index === "number") return { field: "index", value: index };
  const position = attempt.params.position;
  return { field: "position", value: typeof position === "number" ? position : -1 };
}

/**
 * Whether an attempt points inside the list's own content.
 *
 * This is the difference between an attempt that could tell us something and one
 * that cannot: a scroll to 900 px on a list whose whole content is 400 px is
 * out of range, so its zero is expected and says nothing about virtualization.
 * The card records the answer per attempt so a later reader does not have to
 * reconstruct it from the offset and the content height.
 */
export function withinRange(
  attempt: ScrollAttemptCase,
  contentHeight: number,
  maxOffset: number,
  rows: number,
): boolean {
  const target = scrollTarget(attempt);
  if (target.field === "offset") {
    return target.value >= 0 && target.value <= maxOffset;
  }
  return target.value >= 0 && target.value < rows;
}

/** Counters for the two list callbacks, plus what the host passed to them. */
export interface HostCallCounts {
  componentAtIndex: number;
  enqueueComponent: number;
  updateListCallbacks: number;
  /** `componentAtIndex` calls whose `enableReuseNotification` was true. */
  reuseNotifications: number;
  /** The `cellIndex` of each `componentAtIndex` call, in order. */
  cellIndices: number[];
  /** The `sign` (element unique id) of each `enqueueComponent` call, in order. */
  releasedSigns: number[];
  /** Non-null `operationId` values seen on `componentAtIndex`, distinct. */
  operationIds: number[];
}

export function emptyHostCallCounts(): HostCallCounts {
  return {
    componentAtIndex: 0,
    enqueueComponent: 0,
    updateListCallbacks: 0,
    reuseNotifications: 0,
    cellIndices: [],
    releasedSigns: [],
    operationIds: [],
  };
}

/** A copy, so a before/after pair cannot alias one object. */
export function copyCounts(counts: HostCallCounts): HostCallCounts {
  return {
    ...counts,
    cellIndices: [...counts.cellIndices],
    releasedSigns: [...counts.releasedSigns],
    operationIds: [...counts.operationIds],
  };
}

/** What one callback did between two counter snapshots. */
export interface CountDelta {
  componentAtIndex: number;
  enqueueComponent: number;
  reuseNotifications: number;
  cellIndices: number[];
  releasedSigns: number[];
}

/**
 * The calls a snapshot pair accounts for.
 *
 * A delta is recorded rather than the raw totals because the stage that scrolls
 * has to say whether *that* scroll reached the host; a running total cannot
 * separate a call made at create from one made while scrolling.
 */
export function deltaCounts(before: HostCallCounts, after: HostCallCounts): CountDelta {
  return {
    componentAtIndex: after.componentAtIndex - before.componentAtIndex,
    enqueueComponent: after.enqueueComponent - before.enqueueComponent,
    reuseNotifications: after.reuseNotifications - before.reuseNotifications,
    cellIndices: after.cellIndices.slice(before.cellIndices.length),
    releasedSigns: after.releasedSigns.slice(before.releasedSigns.length),
  };
}

/**
 * The recycling answer, derived only from counts the host produced.
 *
 * `hostRecycled` is exactly `enqueueComponent > 0`: the host tells a list which
 * cell it is removing by calling that callback, so a positive count is the only
 * evidence of a release this card can observe, and a zero is the only evidence
 * of none. What the zero means is `reason`'s job, and it is required whenever
 * the answer is zero — the verifier refuses a capture that leaves it out, so the
 * card cannot record a bare `0` that a reader might turn into "cannot".
 */
export interface RecyclingAnswer {
  /** `enqueueComponent` calls during the scroll window, the release signal. */
  enqueueComponent: number;
  /** `componentAtIndex` calls during the scroll window. */
  componentAtIndex: number;
  /** Those `componentAtIndex` calls that carried `enableReuseNotification`. */
  reuseNotifications: number;
  /** Rows the model released because the host named them, if any. */
  releasedRows: number;
  /** `true` only when the host called `enqueueComponent` at least once. */
  hostRecycled: boolean;
  /** `true` when the host made no release call in this window. */
  measuredZero: boolean;
  /** Required when `measuredZero`: what the zero does and does not say. */
  reason: string | null;
}

export interface RecyclingInput {
  delta: CountDelta;
  releasedRows: number;
  /** Whether a scroll was actually attempted, so a zero can be attributed. */
  scrollAttempted: boolean;
  /** Whether `__InvokeUIMethod` (or a direct scroll binding) was present. */
  scrollApiExposed: boolean;
  /** The model's row count at the time of the window. */
  rowCount: number;
  /** How many attempts were made, so the reason can say what was tried. */
  attempts?: number;
  /** The callback codes the host reported, in attempt order. */
  attemptCodes?: number[];
  /** The viewport height the list was given. */
  viewportHeight?: number;
}

export function recyclingAnswer(input: RecyclingInput): RecyclingAnswer {
  const enqueueComponent = input.delta.enqueueComponent;
  const measuredZero = enqueueComponent === 0;
  let reason: string | null = null;
  if (measuredZero) {
    if (!input.scrollApiExposed) {
      reason = "No scroll entry point was exposed by this host, so the viewport was never"
        + " asked to move. This is a measured zero for a card that could not scroll, and"
        + " says nothing about whether the host can recycle.";
    } else if (!input.scrollAttempted) {
      reason = "A scroll entry point is exposed but no attempt was made in this run, so the"
        + " viewport was not moved. A zero here is a gap in the run, not a finding about"
        + " the host.";
    } else {
      const codes = (input.attemptCodes ?? []).join(", ");
      const attempts = input.attempts ?? 1;
      reason = "The " + attempts + " scroll attempt(s) returned and their callbacks fired"
        + (codes === "" ? "" : " with code(s) " + codes)
        + "; the host then made no release call and asked for "
        + input.delta.componentAtIndex + " cell(s) while the card held "
        + input.rowCount + " rows in a " + (input.viewportHeight ?? 0) + " px viewport."
        + " Nothing here reads a scroll offset back, so this shows the calls were accepted,"
        + " not that the viewport moved. A zero records that this engine did not recycle in"
        + " this window on this card; it is not evidence that the engine cannot recycle,"
        + " and it does not identify which of layout, timing, or the list's own policy kept"
        + " the cells.";
    }
  }

  return {
    enqueueComponent,
    componentAtIndex: input.delta.componentAtIndex,
    reuseNotifications: input.delta.reuseNotifications,
    releasedRows: input.releasedRows,
    hostRecycled: enqueueComponent > 0,
    measuredZero,
    reason,
  };
}

/** What one scroll attempt did, as the capture records it. */
export interface ScrollAttemptRecord {
  label: string;
  /** The binding that carried the attempt, e.g. `__InvokeUIMethod`. */
  api: string;
  /** The UI method name, or the binding's own name for a direct call. */
  method: string;
  /** `false` when the binding does not exist on this host. */
  exposed: boolean;
  outcome: "returned" | "threw" | "absent";
  /** How the call's return value is described. */
  returned?: ProbeValue;
  /** The engine's own message when it threw. */
  threw?: { name: string; message: string };
  /** Whether the callback this card passed was actually invoked. */
  callbackFired: boolean;
  /** The callback's `code`, when it carried one. */
  callbackCode?: number;
  /** The call counts this attempt produced, from the counter snapshot pair. */
  delta?: CountDelta;
  /** The coordinate this attempt names, so a reader need not parse the label. */
  target?: ScrollTarget;
  /** Whether that coordinate lies inside the list's content. */
  withinRange?: boolean;
}

/**
 * Runs one bounded attempt through `__InvokeUIMethod`.
 *
 * The callback is this card's own function and it counts. Whether the host calls
 * it is recorded as `callbackFired`, never assumed: a `__InvokeUIMethod` that
 * returns without invoking its callback is a different answer from one that
 * invokes it with an error code, and the capture keeps the two apart.
 */
export function invokeUiMethod(
  api: unknown,
  element: unknown,
  attempt: ScrollAttemptCase,
  onCallback: (code: number | undefined) => void,
): ScrollAttemptRecord {
  const record: ScrollAttemptRecord = {
    label: attempt.label,
    api: "__InvokeUIMethod",
    method: attempt.method,
    exposed: typeof api === "function",
    outcome: "absent",
    callbackFired: false,
  };

  if (typeof api !== "function") return record;

  let fired = false;
  const callback = (result: unknown): void => {
    fired = true;
    const code = (result as { code?: unknown } | null)?.code;
    record.callbackFired = true;
    if (typeof code === "number") {
      record.callbackCode = code;
      onCallback(code);
    } else {
      onCallback(undefined);
    }
  };

  const call = safeCall(api, [element, attempt.method, attempt.params, callback]);
  record.callbackFired = fired;
  if (call.threw !== undefined) {
    record.outcome = "threw";
    record.threw = call.threw;
  } else {
    record.outcome = "returned";
    if (call.returned !== undefined) record.returned = call.returned;
  }
  return record;
}

/**
 * Runs a direct scroll binding, for an engine that exposes one instead of (or as
 * well as) `__InvokeUIMethod`.
 *
 * Kept separate because the argument shape is the binding's own, and inventing
 * an `__InvokeUIMethod`-shaped call for it would be the fabrication this card
 * refuses. A binding that is absent is recorded as absent.
 */
export function callDirectScroll(
  api: unknown,
  element: unknown,
  attempt: ScrollAttemptCase,
): ScrollAttemptRecord {
  const record: ScrollAttemptRecord = {
    label: attempt.label,
    api: String(attempt.method),
    method: attempt.method,
    exposed: typeof api === "function",
    outcome: "absent",
    callbackFired: false,
  };
  if (typeof api !== "function") return record;
  const call = safeCall(api, [element, attempt.params]);
  if (call.threw !== undefined) {
    record.outcome = "threw";
    record.threw = call.threw;
  } else {
    record.outcome = "returned";
    if (call.returned !== undefined) record.returned = call.returned;
  }
  return record;
}

/** The scroll candidates, described from the host's own bindings. */
export function describeScrollCandidates(scope: object): {
  name: string;
  typeof: string;
  arity?: number;
}[] {
  return SCROLL_CANDIDATE_NAMES.map(name => {
    let value: unknown;
    try {
      value = (scope as Record<string, unknown>)[name];
    } catch {
      return { name, typeof: "unreadable" };
    }
    if (typeof value !== "function") return { name, typeof: typeof value };
    const arity = (() => {
      try {
        return (value as { length?: unknown }).length;
      } catch {
        return undefined;
      }
    })();
    return {
      name,
      typeof: "function",
      ...(typeof arity === "number" ? { arity } : {}),
    };
  });
}

/** The list bindings and the scroll candidates, for the inventory stage. */
export function describeListRecycleInventory(scope: object): {
  operations: ListInventoryEntry[];
  relatedGlobals: string[];
  scrollCandidates: { name: string; typeof: string; arity?: number }[];
} {
  return {
    operations: describeListInventory(scope),
    relatedGlobals: findListRelatedGlobals(scope),
    scrollCandidates: describeScrollCandidates(scope),
  };
}

/** The report line for one stage of this card. */
export function lrReportLine(stage: string, payload: Record<string, unknown>): string {
  return `${LIST_RECYCLE_MARKER} ${JSON.stringify({
    probe: LIST_RECYCLE_PROBE,
    stage,
    ...payload,
  })}`;
}

/** Re-exported so the card imports its value descriptions from one place. */
export {
  LIST_PAPI_NAMES,
  describeValue,
  safeCall,
  type ListInventoryEntry,
  type ProbeValue,
};