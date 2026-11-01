/**
 * Native list recycling probe: give the list a viewport and ask it to scroll.
 *
 * The existing list card measured create / materialize / keyed reorder / shrink,
 * and in every capture `enqueueComponent` was `0`. Its own summary named the
 * reason: nothing in that card scrolled, and a native list recycles cells in
 * response to a viewport asking for them. So the answer to "does this host
 * recycle cells?" was *unobserved*, not *disproven*. This card supplies the one
 * thing the earlier card lacked and reports what the host does with it.
 *
 * What it does, in order:
 *
 * 1. describes the list bindings and every global that could carry a scroll,
 *    recording absence as absence;
 * 2. creates a list of {@link ITEM_COUNT} rows, sets a {@link VIEWPORT_HEIGHT}
 *    viewport on it, and records how many cells the host asks for on its own —
 *    a list that virtualizes should not ask for forty;
 * 3. attempts a bounded list of scrolls through `__InvokeUIMethod` (or a direct
 *    scroll binding if the host exposes one), each recorded separately, each
 *    with the counter delta it produced;
 * 4. derives the recycling answer from the host's own calls, and states why when
 *    the answer is zero rather than turning a zero into "cannot";
 * 5. permutes the model after the scroll and checks that element identity
 *    survived, the same comparison the earlier card makes.
 *
 * What keeps this a measurement: every argument is built by this card, the
 * callback a scroll attempt passes is this card's own function and is counted
 * only when the host invokes it, and no stage claims more than the counters say.
 * A run where nothing fires is a result, and the capture records it as one.
 */

import { createLynxRoot, ensureLynxEnvironmentBasics } from "@apothic-ai/solid-lynx";
import type { LynxList, LynxNode, LynxRoot } from "@apothic-ai/solid-lynx";
import {
  LIST_RECYCLE_PROBE,
  LIST_RECYCLE_STAGES,
  SCROLL_CANDIDATE_NAMES,
  callDirectScroll,
  copyCounts,
  deltaCounts,
  describeListRecycleInventory,
  describeValue,
  emptyHostCallCounts,
  invokeUiMethod,
  lrReportLine,
  recyclingAnswer,
  safeCall,
  scrollAttemptCases,
  type CountDelta,
  type HostCallCounts,
  type RecyclingAnswer,
  type ScrollAttemptRecord,
} from "./list-recycle-probe-report.js";

interface LynxEngine {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

declare const lynx: {
  getEngine(): LynxEngine;
};

/**
 * Forty rows, taller than the viewport in total.
 *
 * The count matters only in contrast with the viewport: a list that asks for
 * forty-odd cells at once is not virtualizing, and one that asks for a viewport's
 * worth is. Forty rows of {@link ROW_HEIGHT} against a
 * {@link VIEWPORT_HEIGHT} viewport leave plenty of unscrolled content for the
 * scroll attempts to reach.
 */
const ITEM_COUNT = 40;
const ROW_HEIGHT = 100;
const VIEWPORT_HEIGHT = 200;
const VIEWPORT_WIDTH = 300;
/** Rows the card materializes itself when the host asks for none. */
const PROBE_MATERIALIZE = 4;

const scope = globalThis as unknown as Record<string, unknown>;

ensureLynxEnvironmentBasics();

/** The row model. Replaced, never mutated, so `items()` reads the current one. */
let model: readonly string[] = Array.from(
  { length: ITEM_COUNT },
  (_unused, index) => `row-${String(index).padStart(2, "0")}`,
);

/** Counters fed by the wrapper this card installs around the list PAPI. */
const hostCalls = emptyHostCallCounts();
let counting = false;
let list: LynxList<string> | undefined;
let recycle: RecyclingAnswer | undefined;

function binding(name: string): unknown {
  return scope[name];
}

/** Stages already logged in this card. */
const logged = new Set<string>();

/**
 * Logs one stage, catching anything the stage itself throws.
 *
 * Per stage, for the reason the other cards do it: the evidence is in the earlier
 * lines, so a stage that throws must not take the capture with it. A repeated
 * stage is dropped rather than logged twice, because an Explorer session can fire
 * `__RenderPage` more than once and two runs in one capture would make every
 * counter ambiguous.
 */
function stage(name: string, build: () => Record<string, unknown>): void {
  if (logged.has(name)) return;
  logged.add(name);
  try {
    console.log(lrReportLine(name, build()));
  } catch (error) {
    const thrown = error as { name?: unknown; message?: unknown } | null;
    console.log(lrReportLine(name, {
      threw: {
        name: typeof thrown?.name === "string" ? thrown.name : "Error",
        message: typeof thrown?.message === "string" ? thrown.message : String(error),
      },
    }));
  }
}

/**
 * Installs a counting layer around the list PAPI, and returns the restore.
 *
 * Both callbacks are forwarded with the arguments they were given, so the row
 * model still receives the host's call; only counts and the arguments this card
 * needs are recorded. Wrapping rather than re-implementing keeps this a
 * measurement of the host: the renderer, the root and the row model are
 * unchanged, and what is counted is what reached the PAPI.
 *
 * `enableReuseNotification` and `operationId` are recorded because they are the
 * host's own reuse bookkeeping. Recording them is not the same as giving them
 * meaning, which this card does not.
 */
function installCountingPapi(): () => void {
  const originalCreate = scope["__CreateList"];
  const originalUpdate = scope["__UpdateListCallbacks"];

  const countAtIndex = (fn: unknown) => (...args: unknown[]) => {
    hostCalls.componentAtIndex += 1;
    const cellIndex = args[2];
    if (typeof cellIndex === "number") hostCalls.cellIndices.push(cellIndex);
    const operationId = args[3];
    if (typeof operationId === "number" && operationId >= 0
      && !hostCalls.operationIds.includes(operationId)) {
      hostCalls.operationIds.push(operationId);
    }
    const reuse = args[4];
    if (reuse === true) hostCalls.reuseNotifications += 1;
    return (fn as (...rest: unknown[]) => unknown)(...args);
  };
  const countEnqueue = (fn: unknown) => (...args: unknown[]) => {
    hostCalls.enqueueComponent += 1;
    const sign = args[2];
    if (typeof sign === "number") hostCalls.releasedSigns.push(sign);
    return (fn as (...rest: unknown[]) => unknown)(...args);
  };

  if (typeof originalCreate === "function") {
    scope["__CreateList"] = (
      parentComponentUniqueId: unknown,
      componentAtIndex: unknown,
      enqueueComponent: unknown,
    ) => (originalCreate as (...a: unknown[]) => unknown)(
      parentComponentUniqueId,
      countAtIndex(componentAtIndex),
      countEnqueue(enqueueComponent),
    );
  }
  if (typeof originalUpdate === "function") {
    scope["__UpdateListCallbacks"] = (
      element: unknown,
      componentAtIndex: unknown,
      enqueueComponent: unknown,
    ) => {
      hostCalls.updateListCallbacks += 1;
      return (originalUpdate as (...a: unknown[]) => unknown)(
        element,
        countAtIndex(componentAtIndex),
        countEnqueue(enqueueComponent),
      );
    };
  }

  counting = typeof originalCreate === "function";
  return () => {
    scope["__CreateList"] = originalCreate;
    scope["__UpdateListCallbacks"] = originalUpdate;
    counting = false;
  };
}

/** Node unique id, when the host exposes `__GetElementUniqueID`. */
function readId(node: unknown): number | undefined {
  const get = scope["__GetElementUniqueID"];
  if (typeof get !== "function") return undefined;
  const returned = safeCall(get, [node]).returned?.value;
  return typeof returned === "number" ? returned : undefined;
}

/** Every row's key and element id, in list order. */
function rowIds(): { key: string; id?: number }[] {
  if (list === undefined) return [];
  return list.rows.map(row => {
    const id = readId(row.node);
    return {
      key: typeof row.key === "string" ? row.key : String(row.key),
      ...(id === undefined ? {} : { id }),
    };
  });
}

/** How many rows the model currently holds. */
function rowCount(): number {
  return list === undefined ? 0 : list.rows.length;
}

/* ------------------------------------------------------------------- stages */

/**
 * Stage 1: the list bindings, and every global that could carry a scroll.
 *
 * No call is made. `scrollCandidates` records absence as `typeof "undefined"`,
 * which is the difference between "this engine has no scroll entry point" and
 * "this card did not look for one".
 */
function probeInventory(): void {
  stage("inventory", () => {
    const described = describeListRecycleInventory(scope);
    return {
      ...described,
      namedPresent: ["__CreateList", "__UpdateListCallbacks"]
        .filter(name => typeof binding(name) === "function"),
      countingInstalled: counting,
      scrollCandidateNames: [...SCROLL_CANDIDATE_NAMES],
    };
  });
}

/**
 * Stage 2: a forty-row list with a viewport smaller than its content.
 *
 * The list element itself gets the height: without one the host has nothing to
 * lay out against, and a host that asks for no cells would look identical to a
 * host that does not virtualize. Setting the style is recorded, not assumed —
 * if `__SetInlineStyles` rejects the list element, the stage says so.
 */
function probeCreate(root: LynxRoot, page: LynxNode): void {
  stage("create", () => {
    let styleApplied = false;
    let styleError: string | undefined;
    // The list goes inside a sized wrapper rather than straight onto the page.
    // A page with no layout size gives the list no viewport to lay out against,
    // and a host that asks for no cells because nothing is visible looks exactly
    // like a host that does not virtualize. The wrapper is the card's own node.
    const viewport = root.renderer.createElement("view");
    root.renderer.setProp(viewport, "style",
      `height:${VIEWPORT_HEIGHT}px;width:${VIEWPORT_WIDTH}px`);
    root.renderer.insert(page, viewport);
    list = root.createList({
      parent: viewport,
      items: () => model,
      children: item => {
        const row = root.renderer.createElement("view");
        root.renderer.setProp(row, "style", `height:${ROW_HEIGHT}px;width:${VIEWPORT_WIDTH}px`);
        const text = root.renderer.createElement("text");
        root.renderer.setProp(text, "text", item);
        root.renderer.insert(row, text);
        return row;
      },
      getKey: item => item,
    });

    try {
      root.renderer.setProp(list.list, "style",
        `height:${VIEWPORT_HEIGHT}px;width:${VIEWPORT_WIDTH}px`);
      styleApplied = true;
    } catch (error) {
      styleError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
    root.flush();

    return {
      createListExposed: typeof binding("__CreateList") === "function",
      updateListCallbacksExposed: typeof binding("__UpdateListCallbacks") === "function",
      returnedHandle: list.list !== undefined && list.list !== null,
      handleTypeof: typeof list.list,
      handle: describeValue(list.list),
      listId: readId(list.list),
      itemCount: ITEM_COUNT,
      rowHeight: ROW_HEIGHT,
      viewportHeight: VIEWPORT_HEIGHT,
      styleApplied,
      viewportWrapper: true,
      ...(styleError === undefined ? {} : { styleError }),
      hostCallCounts: copyCounts(hostCalls),
    };
  });
}

/**
 * Stage 3: what the host asks for once it has a viewport.
 *
 * The host's own requests are the first virtualization signal, and they arrive
 * (if at all) after a flush, so they are read before this card materializes
 * anything. When the host asks for nothing, a bounded number of rows is
 * materialized through the model so the scroll stage has cells to work with — and
 * the stage says which of the two produced the rows.
 */
function probeViewport(root: LynxRoot): void {
  stage("viewport", () => {
    if (list === undefined) {
      return { listAvailable: false, hostAskedOnItsOwn: false, requestedIndices: [] };
    }
    const before = copyCounts(hostCalls);
    root.flush();
    const afterFlush = copyCounts(hostCalls);
    const hostDelta = deltaCounts(before, afterFlush);
    const hostAskedOnItsOwn = hostDelta.componentAtIndex > 0;

    let probeMaterialized = 0;
    if (!hostAskedOnItsOwn && rowCount() === 0) {
      for (let index = 0; index < Math.min(PROBE_MATERIALIZE, ITEM_COUNT); index += 1) {
        if (list.materialize(index) !== undefined) probeMaterialized += 1;
      }
      root.flush();
    }

    return {
      listAvailable: true,
      viewportHeight: VIEWPORT_HEIGHT,
      hostAskedOnItsOwn,
      hostAskedDelta: hostDelta,
      requestedIndices: hostDelta.cellIndices,
      probeMaterialized,
      rows: rowCount(),
      hostCallCounts: copyCounts(hostCalls),
    };
  });
}

/**
 * The scroll stage's counter delta, and how many attempts really reached the host.
 *
 * Both are written by `probeScroll` and read by the recycle stage, so the window
 * is the same one the scroll stage reported rather than a second computation.
 */
let scrollDelta: CountDelta = {
  componentAtIndex: 0,
  enqueueComponent: 0,
  reuseNotifications: 0,
  cellIndices: [],
  releasedSigns: [],
};
let scrollAttemptCount = 0;

/** True when any scroll entry point the host exposes is a function. */
function scrollApiPresent(): boolean {
  return SCROLL_CANDIDATE_NAMES.some(name => typeof binding(name) === "function");
}

/**
 * Stage 4: bounded scroll attempts, each with the calls it produced.
 *
 * `__InvokeUIMethod` carries every method name this card tries. A host that
 * exposes `__ScrollBy` or `__ElementScrollBy` instead is called through that
 * binding with the same bounded list, because collapsing the two into one
 * invented signature would be a fabricated call. Absence is recorded as
 * `outcome: "absent"`; whether the callback fired is recorded per attempt.
 */
function probeScroll(root: LynxRoot): void {
  stage("scroll", () => {
    const attempts: ScrollAttemptRecord[] = [];
    const cases = scrollAttemptCases();
    // One snapshot pair around the whole stage: the window is "what the host did
    // while this card scrolled", not a running total that also includes setup.
    const windowBefore = copyCounts(hostCalls);
    const invoke = binding("__InvokeUIMethod");
    const directName = ["__ScrollBy", "__ElementScrollBy"]
      .find(name => typeof binding(name) === "function");
    const scrollApiExposed = typeof invoke === "function" || directName !== undefined;
    const target = list?.list;

    if (list === undefined || target === undefined) {
      return {
        listAvailable: false,
        scrollApiExposed,
        attempts,
        attempted: 0,
        note: "No list element exists, so no scroll could be aimed at one.",
      };
    }

    for (const attempt of cases) {
      const before = copyCounts(hostCalls);
      let record: ScrollAttemptRecord;
      if (typeof invoke === "function") {
        record = invokeUiMethod(invoke, target, attempt, () => undefined);
      } else if (directName !== undefined) {
        record = callDirectScroll(binding(directName), target, attempt);
      } else {
        record = {
          label: attempt.label,
          api: "none",
          method: attempt.method,
          exposed: false,
          outcome: "absent",
          callbackFired: false,
        };
      }
      root.flush();
      const after = copyCounts(hostCalls);
      record.delta = deltaCounts(before, after);
      attempts.push(record);
    }

    scrollDelta = deltaCounts(windowBefore, copyCounts(hostCalls));
    scrollAttemptCount = attempts.filter(record => record.outcome !== "absent").length;

    return {
      listAvailable: true,
      scrollApiExposed,
      apiUsed: typeof invoke === "function"
        ? "__InvokeUIMethod"
        : directName ?? "none",
      attempted: scrollAttemptCount,
      attempts,
      callbacksFired: attempts.filter(record => record.callbackFired).length,
      windowDelta: scrollDelta,
    };
  });
}

/**
 * Stage 5: the recycling answer.
 *
 * The window is this card's own scroll stage: `componentAtIndex` and
 * `enqueueComponent` calls made while it scrolled, not a running total. What the
 * host did *not* do is stated in `reason` whenever the release count is zero, so
 * a reader cannot turn the zero into an inability claim.
 */
function probeRecycle(): void {
  stage("recycle", () => {
    const scrollAttempted = scrollAttemptCount > 0;
    const delta: CountDelta = {
      componentAtIndex: scrollDelta.componentAtIndex,
      enqueueComponent: scrollDelta.enqueueComponent,
      reuseNotifications: scrollDelta.reuseNotifications,
      cellIndices: scrollDelta.cellIndices,
      releasedSigns: scrollDelta.releasedSigns,
    };
    recycle = recyclingAnswer({
      delta,
      releasedRows: delta.enqueueComponent,
      scrollAttempted,
      scrollApiExposed: scrollApiPresent(),
      rowCount: rowCount(),
    });

    return {
      ...recycle,
      window: "this card's scroll stage",
      hostCallCounts: copyCounts(hostCalls),
      releasedSigns: delta.releasedSigns,
      cellIndices: delta.cellIndices,
    };
  });
}

/**
 * Stage 6: does a permuted model keep element identity?
 *
 * The same comparison the earlier list card makes: survive-by-key rows keep their
 * unique id when they move, so a reorder is not mistaken for a rebuild. It runs
 * after the scroll so a host that released cells while scrolling would show up as
 * a released row rather than a silently missing one.
 */
function probeReorder(root: LynxRoot): void {
  stage("reorder", () => {
    if (list === undefined) return { listAvailable: false, identityPreserved: false };
    const before = rowIds();
    const beforeKeys = before.map(row => row.key);
    const permuted = [...model].reverse();
    model = permuted;
    list.update();
    root.flush();
    const after = rowIds();
    const idByKey = new Map(before.filter(row => row.id !== undefined)
      .map(row => [row.key, row.id as number]));
    const moved = after.filter(row => idByKey.has(row.key));
    const preserved = moved.filter(row => idByKey.get(row.key) === row.id);

    return {
      listAvailable: true,
      before: beforeKeys,
      after: after.map(row => row.key),
      beforeIds: before.map(row => row.id ?? null),
      afterIds: after.map(row => row.id ?? null),
      movedRows: moved.length,
      identityPreserved: moved.length > 0 && preserved.length === moved.length,
      rowCount: rowCount(),
      hostCallCounts: copyCounts(hostCalls),
    };
  });
}

/**
 * Stage 7: counters, the answer, and what is still unmeasured.
 *
 * The `unmeasured` entries are built from the run rather than written in advance,
 * so a run that observed recycling does not claim it observed none.
 */
function probeSummary(): void {
  stage("summary", () => {
    const answer = recycle;
    const measured = [
      "which list and scroll globals the host exposes, with typeof and arity",
      "whether a forty-row list was given a viewport smaller than its content",
      "how many cells the host asked for on its own after layout",
      "what each bounded scroll attempt returned, and whether its callback fired",
      "how many componentAtIndex and enqueueComponent calls the scroll window produced",
      "whether a permuted model kept element identity by unique id",
    ];
    const unmeasured: { operation: string; reason: string }[] = [];

    if (answer === undefined || answer.measuredZero) {
      unmeasured.push({
        operation: "cell reuse driven by a real user scroll",
        reason: answer?.reason
          ?? "The recycling answer was not produced, so nothing about reuse is claimed.",
      });
    }
    unmeasured.push({
      operation: "reuse timing and operationId semantics",
      reason: "The card records the enableReuseNotification flag and the operationId it"
        + " was given, but gives them no meaning: a reuse notification that names an"
        + " operation is not a measurement of when or why the host chose that cell.",
    });
    unmeasured.push({
      operation: "scroll offsets and visual positions",
      reason: "Nothing here reads a scroll offset back, so an attempt that returned is"
        + " evidence the host accepted the call, not that the viewport moved to that"
        + " offset.",
    });

    return {
      stagesLogged: [...LIST_RECYCLE_STAGES],
      probe: LIST_RECYCLE_PROBE,
      itemCount: ITEM_COUNT,
      viewportHeight: VIEWPORT_HEIGHT,
      rowsAtEnd: rowCount(),
      hostCallCounts: copyCounts(hostCalls),
      recycling: answer ?? null,
      measured,
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
  if (!page) throw new Error("solid-lynx list-recycle probe: no page element");

  const root: LynxRoot = createLynxRoot({ page });
  const restore = installCountingPapi();

  try {
    probeInventory();
    probeCreate(root, page);
    probeViewport(root);
    probeScroll(root);
    probeRecycle();
    probeReorder(root);
    probeSummary();
    console.log(lrReportLine("done", { status: "all stages logged" }));
  } finally {
    restore();
  }
}

const engine = lynx.getEngine();
engine.addEventListener("__RenderPage", renderCard);
engine.addEventListener("__DestroyLifetime", () => {
  // The list is left to the page: the card holds no host resource of its own, and
  // no cleanup contract was measured, so calling one would be a guess.
});