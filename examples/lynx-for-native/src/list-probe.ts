/**
 * Native list PAPI probe.
 *
 * This card measures one thing: what a native host actually does with the list
 * PAPI that `root.createList()` depends on. It is a measurement, not an
 * integration. Nothing here is wired into the renderer, nothing is emulated for
 * the web host, and no native list behaviour is claimed beyond what a stage line
 * reports.
 *
 * The rules the probe holds itself to:
 *
 * - Nothing is inferred from a name. Every field in a report comes from reading
 *   the runtime's own binding: `typeof`, `fn.length`, `fn.name`, `String(fn)`.
 *   `fn.length` is the declared parameter count and is recorded as evidence, not
 *   read as a signature.
 * - The host's row callbacks are counted, not replaced in meaning. The counting
 *   layer sits around the pair `__CreateList`/`__UpdateListCallbacks` installs
 *   and forwards every argument untouched, so the row model still does the work
 *   and the counters measure what the host asked for. A count of zero therefore
 *   means "the host never asked during this card", which is the honest reading.
 * - The card drives what it can drive and says which it drove. The row model
 *   exposes `materialize()` because a host that never calls `componentAtIndex`
 *   would otherwise leave every stage after `create` with nothing to report.
 *   Where rows are materialized through that method the stage says so, and the
 *   host's own counter stays where it was: "the probe asked for this row" and
 *   "the host asked for this row" are different facts, and the report never
 *   merges them.
 * - Each stage is logged on its own line. The native console bridge drops
 *   everything after the first newline, and a stage that fails hard must not take
 *   the earlier evidence with it.
 */

import { createLynxRoot, ensureLynxEnvironmentBasics } from "@apothic-ai/solid-lynx";
import type { LynxList, LynxNode, LynxRoot } from "@apothic-ai/solid-lynx";
import {
  LIST_PAPI_NAMES,
  childIds,
  countChildren,
  describeFunction,
  describeValue,
  diffSnapshots,
  findListRelatedGlobals,
  keyOrder,
  listReportLine,
  observeRows,
  safeCall,
  safeTypeof,
  type ProbeFunction,
  type RowObservation,
} from "./list-probe-report.js";

interface LynxEngine {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

declare const lynx: {
  getEngine(): LynxEngine;
};

/** The toy model. Strings, so a row key is also the row's own label. */
const ITEMS = ["alpha", "bravo", "charlie"] as const;
/** The same three keys, permuted. The reorder stage installs this. */
const REORDERED = ["charlie", "alpha", "bravo"] as const;
/** One item left. The shrink stage installs this. */
const SHRUNK = ["alpha"] as const;

const scope = globalThis as unknown as Record<string, unknown>;

ensureLynxEnvironmentBasics();

/** What the runtime reports about each named binding. No call is made for these. */
const inventory = new Map<string, ProbeFunction>();

/**
 * How often the host itself called each row callback, and how often the row
 * callbacks were re-installed.
 *
 * Every "did the host ask" field in the report comes from here. A model-driven
 * `materialize()` never passes through the counted pair, so it cannot be
 * mistaken for a host request.
 */
const hostCalls = {
  componentAtIndex: 0,
  enqueueComponent: 0,
  /** Counts `__UpdateListCallbacks` re-installs. */
  updateListCallbacks: 0,
  /** The `cellIndex` the host asked for, in call order. */
  cellIndices: [] as number[],
};

/** Whether the counting layer is installed, so a failed install is visible. */
let counting = false;

/**
 * Installs a counting layer around the list PAPI, and returns the restore.
 *
 * Both callbacks are forwarded with the arguments they were given, so the row
 * model still receives the host's call; only the count and the requested cell
 * index are recorded. Wrapping here rather than inside the renderer keeps this a
 * measurement of the host: the renderer, the root, and the row model are all
 * unchanged, and what is counted is what reached the PAPI.
 */
function installCountingPapi(): () => void {
  const originalCreate = scope["__CreateList"];
  const originalUpdate = scope["__UpdateListCallbacks"];

  const countAtIndex = (fn: unknown) => (...args: unknown[]) => {
    hostCalls.componentAtIndex += 1;
    const cellIndex = args[2];
    if (typeof cellIndex === "number") hostCalls.cellIndices.push(cellIndex);
    return (fn as (...rest: unknown[]) => unknown)(...args);
  };
  const countEnqueue = (fn: unknown) => (...args: unknown[]) => {
    hostCalls.enqueueComponent += 1;
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

/** The list element's children, counted through the PAPI's sibling walk. */
function children(parent: unknown) {
  return countChildren(parent, scope["__FirstElement"], scope["__NextElement"]);
}

/** The list element's children as unique ids, in element order. */
function childIdList(parent: unknown) {
  return childIds(parent, scope["__FirstElement"], scope["__NextElement"], readId);
}

/**
 * Samples a list's current rows.
 *
 * Row content is the model item the row was built from, recorded from the model:
 * no Element PAPI in this repository reads a text node back, and calling one that
 * may not exist would record an absence as a measurement.
 */
function snapshot(list: LynxList<string>): RowObservation[] {
  return observeRows(
    list.rows.map(row => ({ key: row.key, item: row.item, node: row.node })),
    item => item,
    readId,
  );
}

/**
 * Wraps a stage so a throwing native handle cannot end the card.
 *
 * A stage that throws records the throw and returns `fallback`, so the stages
 * after it and the summary still run. Without this, one bad handle would produce
 * a report that stops at whichever stage touched it.
 */
function stage<T>(name: string, run: () => T, fallback: T): T {
  try {
    return run();
  } catch (error) {
    const thrown = error as { name?: unknown; message?: unknown } | null;
    console.log(listReportLine(name, {
      threw: {
        name: typeof thrown?.name === "string" ? thrown.name : "Error",
        message: typeof thrown?.message === "string" ? thrown.message : String(error),
      },
      hostCallCounts: { ...hostCalls },
    }));
    return fallback;
  }
}

/**
 * Stage 1: what the host exposes.
 *
 * No call is made, so nothing here can mutate the card. The list-named globals
 * are recorded because an operation outside the four names would change what can
 * be measured at all.
 */
function probeInventory(): void {
  for (const name of LIST_PAPI_NAMES) {
    inventory.set(name, describeFunction(scope[name]));
  }
  console.log(listReportLine("inventory", {
    relatedGlobals: findListRelatedGlobals(globalThis),
    // `typeof`, arity, name, and source are reported per binding. A native
    // binding can report any arity regardless of what it requires, so arity is
    // evidence about the binding and is not read as a signature.
    operations: [...inventory].map(([name, description]) => ({ name, ...description })),
    namedPresent: LIST_PAPI_NAMES.filter(name => typeof scope[name] === "function"),
    countingInstalled: counting,
  }));
}

/**
 * Stage 2: create a list with three items.
 *
 * Reported as "did it return a handle" and "what does `typeof` say about that
 * handle", because a native PrimJS element reports `typeof === "unknown"` and is
 * still a usable handle.
 */
function probeCreate(root: LynxRoot): LynxList<string> | undefined {
  return stage("create", () => {
    const list = root.createList({
      items: () => model,
      children: item => {
        const text = root.renderer.createElement("text");
        root.renderer.insert(text, item);
        return text;
      },
    });
    root.flush();
    console.log(listReportLine("create", {
      createListExposed: typeof scope["__CreateList"] === "function",
      updateListCallbacksExposed: typeof scope["__UpdateListCallbacks"] === "function",
      returnedHandle: list.list !== undefined && list.list !== null,
      handleTypeof: safeTypeof(list.list),
      handle: describeValue(list.list),
      listId: readId(list.list),
      modelItems: [...ITEMS],
      rowsAfterCreate: keyOrder(snapshot(list)),
      children: children(list.list),
      childIds: childIdList(list.list).ids,
      hostCallCounts: { ...hostCalls },
    }));
    return list;
  }, undefined);
}

/**
 * Stage 3: materialize rows.
 *
 * The host gets its own chance first: `update()` re-installs the callbacks, which
 * is the moment a native host can ask for cells. If it did not ask, the rows are
 * materialized through the model's `materialize()`, and the stage reports which
 * of the two happened instead of implying the host did it.
 */
function probeMaterialize(list: LynxList<string>): void {
  stage("materialize", () => {
    const hostBeforeUpdate = hostCalls.componentAtIndex;
    list.update();
    const hostAskedAfterUpdate = hostCalls.componentAtIndex > hostBeforeUpdate;

    const hostBeforeRows = hostCalls.componentAtIndex;
    const nodes = ITEMS.map((_item, index) => list.materialize(index));
    const hostAskedWhileMaterializing = hostCalls.componentAtIndex > hostBeforeRows;

    const notes = snapshot(list);
    console.log(listReportLine("materialize", {
      requested: ITEMS.map((_item, index) => index),
      requestedCount: nodes.length,
      materialized: nodes.filter(node => node !== undefined && node !== null).length,
      // `children` is the element tree, `rows` is the model: a list that reports
      // rows but no children would be a model with no host-visible result.
      children: children(list.list),
      childIds: childIdList(list.list).ids,
      rows: notes,
      rowsByKey: keyOrder(notes),
      hostAskedAfterUpdate,
      hostAskedWhileMaterializing,
      hostAskedOnItsOwn: hostAskedAfterUpdate || hostAskedWhileMaterializing,
      hostCellIndices: [...hostCalls.cellIndices],
      hostCallCounts: { ...hostCalls },
    }));
  }, undefined);
}

/**
 * Stage 4: change the model order and call `update()`.
 *
 * The question is whether a row whose key survived keeps its element. Only a
 * unique-id comparison taken before and after can answer it: the model is what
 * changed, so the model cannot show it, and comparing row positions would call a
 * moved row a rebuild.
 */
function probeReorder(list: LynxList<string>): void {
  stage("reorder", () => {
    const before = snapshot(list);
    const beforeIds = childIdList(list.list);
    const beforeHostCalls = { ...hostCalls };
    const modelBefore = [...model];

    // A permutation of the same keys. Every key survives, so every row should
    // move rather than be rebuilt.
    model = REORDERED;
    list.update();

    const after = snapshot(list);
    const afterIds = childIdList(list.list);
    const diff = diffSnapshots(before, after);

    console.log(listReportLine("reorder", {
      modelBefore,
      modelAfter: [...REORDERED],
      modelChanged: true,
      before: keyOrder(before),
      after: keyOrder(after),
      diff,
      existingRowsMoved: diff.kept.length,
      // Only claimed when identity could be compared at all: a host without
      // `__GetElementUniqueID` leaves the question open, not answered.
      identityMeasured: diff.identityMeasured,
      keyedIdentityPreserved: diff.identityMeasured && diff.sameNode.length === diff.kept.length,
      anyRowReleased: diff.released.length > 0,
      releasedRows: diff.released,
      childrenBefore: beforeIds.count,
      childrenAfter: afterIds.count,
      childIdsBefore: beforeIds.ids,
      childIdsAfter: afterIds.ids,
      // Element order is the host-visible half of a reorder. Without it, a model
      // that reordered while the elements stayed put would look identical to one
      // that moved them.
      elementOrderChanged: beforeIds.count !== afterIds.count
        || beforeIds.ids.join(",") !== afterIds.ids.join(","),
      hostCallsDuring: {
        componentAtIndex: hostCalls.componentAtIndex - beforeHostCalls.componentAtIndex,
        enqueueComponent: hostCalls.enqueueComponent - beforeHostCalls.enqueueComponent,
        updateListCallbacks: hostCalls.updateListCallbacks - beforeHostCalls.updateListCallbacks,
      },
      hostCallCounts: { ...hostCalls },
    }));
  }, undefined);
}

/**
 * Stage 5: shrink the model to one item.
 *
 * `update()` releases the rows whose key left the model. What this stage can say
 * is what happened to those rows in the row model and whether the host called
 * `enqueueComponent` to recycle them — recycling is the host's decision, so the
 * callback count is the only honest evidence either way.
 */
function probeShrunk(list: LynxList<string>): void {
  stage("shrunk", () => {
    const beforeHostCalls = { ...hostCalls };
    const before = snapshot(list);
    const beforeIds = childIdList(list.list);
    const modelBefore = [...model];

    model = SHRUNK;
    list.update();

    const after = snapshot(list);
    const afterIds = childIdList(list.list);
    const diff = diffSnapshots(before, after);

    console.log(listReportLine("shrunk", {
      modelBefore,
      modelAfter: [...SHRUNK],
      before: keyOrder(before),
      after: keyOrder(after),
      diff,
      releasedRows: diff.released,
      keptRows: diff.kept,
      childrenBefore: beforeIds.count,
      childrenAfter: afterIds.count,
      childIdsBefore: beforeIds.ids,
      childIdsAfter: afterIds.ids,
      // Recorded as counts, not as a conclusion: a zero here means the host never
      // asked to recycle on this card, not that the host cannot recycle.
      hostRecycled: hostCalls.enqueueComponent > beforeHostCalls.enqueueComponent,
      hostCallsDuring: {
        componentAtIndex: hostCalls.componentAtIndex - beforeHostCalls.componentAtIndex,
        enqueueComponent: hostCalls.enqueueComponent - beforeHostCalls.enqueueComponent,
        updateListCallbacks: hostCalls.updateListCallbacks - beforeHostCalls.updateListCallbacks,
      },
      hostCallCounts: { ...hostCalls },
    }));
  }, undefined);
}

/**
 * Stage 6: what was and was not exercised.
 *
 * Stated explicitly so the report cannot be read as claiming more than it did.
 */
function probeSummary(): void {
  console.log(listReportLine("summary", {
    measured: [
      "which list-named globals the host exposes, with typeof, fn.length, fn.name and String(fn)",
      "whether __CreateList returned a handle, and what typeof reports for that handle",
      "how many children the list element holds after the model's rows were materialized",
      "whether keyed rows kept their element identity across a permuted model, compared by unique id",
      "whether the element order changed when the model order changed",
      "whether a row whose key left a shrunk model was released from the row model",
      "how many times the host itself called componentAtIndex and enqueueComponent during these stages",
    ],
    unmeasured: [
      {
        operation: "recycling driven by a viewport",
        reason: "Nothing in this card scrolls. A native list recycles cells in response to a"
          + " viewport asking for them, and no stage produces that request, so a zero"
          + " enqueueComponent count cannot be read as the host being unable to recycle.",
      },
      {
        operation: "scroll behaviour",
        reason: "The card creates no scroll view and never scrolls, so nothing about"
          + " scrolling, offsets, sticky behaviour, or span count is measured.",
      },
      {
        operation: "cell reuse timing",
        reason: "When a cell is reused, how long it stays alive before reuse, and which cell a"
          + " host hands back are host decisions this card does not observe. The counter says"
          + " how often the callback ran, not when it ran.",
      },
      {
        operation: "operationId and enableReuseNotification semantics",
        reason: "Both are arguments the host supplies and the model gives no meaning to, so no"
          + " stage shows what a non-zero operation id or a true reuse notification changes.",
      },
      {
        operation: "__UpdateListComponents and __GetListComponents",
        reason: "Inventoried only. Neither is called, because no stage has a contract for what"
          + " they exchange, and a fabricated argument would measure the probe.",
      },
      {
        operation: "materialization the host asked for",
        reason: "Rows are materialized through the model's materialize() when the host did not"
          + " ask for them itself. The hostAskedOnItsOwn and hostCallCounts fields are what"
          + " separate the two cases; a host that asks for cells on its own fills in the host"
          + " counters during the same stages.",
      },
      {
        operation: "rendered row content",
        reason: "No Element PAPI in this repository reads a text node back, so row content is"
          + " recorded from the model item each row was built from rather than read out of the"
          + " element tree.",
      },
    ],
    hostCallCounts: { ...hostCalls },
  }));
}

function renderCard(): void {
  const host = scope as {
    __GetPageElement?: () => LynxNode | null | undefined;
    __CreatePage?: (componentId: string, cssId: number) => LynxNode;
  };
  const page = host.__GetPageElement?.() ?? host.__CreatePage?.("0", 0);
  if (!page) throw new Error("solid-lynx list probe: no page element");

  const root: LynxRoot = createLynxRoot({ page });
  const restorePapi = installCountingPapi();

  try {
    root.render(() => {
      const card = root.renderer.createElement("view");
      const label = root.renderer.createElement("text");
      root.renderer.setProp(card, "id", "list-probe");
      root.renderer.setProp(label, "id", "list-probe-label");
      root.renderer.insert(label, "Native list PAPI probe");
      root.renderer.insert(card, label);
      return card;
    });

    probeInventory();
    const list = probeCreate(root);
    if (list) {
      probeMaterialize(list);
      probeReorder(list);
      probeShrunk(list);
    }
    probeSummary();
  } finally {
    // The device keeps the card for the life of the Explorer session; restoring
    // the PAPI leaves the host exactly as the card found it, so a later
    // measurement in the same session is not reading this probe's wrappers.
    restorePapi();
    root.flush();
  }

  console.log(listReportLine("done", { status: "all stages logged" }));
}

/**
 * The list's model.
 *
 * `createList` reads `items()` on every reconcile rather than capturing it at
 * creation, so assigning here is the model change the reorder and shrink stages
 * measure.
 */
let model: readonly string[] = ITEMS;

const engine = lynx.getEngine();
engine.addEventListener("__RenderPage", renderCard);
engine.addEventListener("__DestroyLifetime", () => {
  // The page owns the card for the life of the Explorer session; the probe holds
  // no host resource of its own that has to be released here.
});
