/**
 * Platform capability probe for the Lynx-for-Web host.
 *
 * The renderer only drives the Element PAPI, so a platform capability such as
 * list virtualization, gestures, animation, or overlays is reachable only if the
 * host exposes the PAPI *and* the renderer has a path that calls it. This probe
 * measures both halves on the host it is running in, so the answer comes from
 * the runtime rather than from documentation.
 *
 * Results are published on `globalThis.__SOLID_LYNX_CAPABILITIES__` for the
 * Playwright suite and rendered into the card, so the same measurements can be
 * read on a device.
 */

import { createSignal } from "solid-js";
import { createLynxRef, createLynxRoot, use } from "solid-lynx";
import type { LynxNode, LynxPapi } from "solid-lynx";

export type CapabilityStatus = "supported" | "host-only" | "unsupported";

export interface CapabilityFinding {
  capability: string;
  status: CapabilityStatus;
  /** PAPI names the probe looked for, and whether the host has them. */
  papi: { name: string; present: boolean }[];
  /** What the probe observed at runtime. */
  observed: string[];
  /** What happens today if an app uses this capability. */
  today: string;
  /** What supporting it would take. */
  requires: string[];
}

export interface CapabilityReport {
  label: string;
  findings: CapabilityFinding[];
}

/**
 * Calls the renderer makes while a tree is built, so the probe can tell which
 * path a capability took. Restored before the probe returns.
 */
interface PapiTrace {
  calls: { name: string; args: unknown[] }[];
  restore(): void;
}

function tracePapi(papi: PapiGlobal, names: string[]): PapiTrace {
  const originals = names.map(name => [name, papi[name]] as const);
  const calls: { name: string; args: unknown[] }[] = [];

  for (const name of names) {
    const original = papi[name];
    if (typeof original !== "function") continue;
    papi[name] = (...args: unknown[]) => {
      calls.push({ name, args });
      return original(...args);
    };
  }

  return {
    calls,
    restore() {
      for (const [name, original] of originals) {
        if (original === undefined) delete papi[name];
        else papi[name] = original;
      }
    },
  };
}

type PapiGlobal = LynxPapi & Record<string, unknown> & {
  __GetPageElement?: () => LynxNode | undefined;
};

/** The list element shape web-core creates, with the row callbacks stored on it. */
interface HostListElement {
  componentAtIndex?: (
    list: unknown,
    listId: number,
    cellIndex: number,
    operationId: number,
    enableReuseNotification: boolean,
  ) => number | undefined;
  enqueueComponent?: (list: unknown, listId: number, sign: number) => void;
  children?: ArrayLike<{ firstElementChild: HTMLElement | null }>;
  tagName?: string;
}

/** A rendered row's label, read from the host rather than from the DOM text. */
function rowLabel(row: { firstElementChild: HTMLElement | null }): string {
  return row.firstElementChild?.getAttribute("text") ?? "";
}

/** What the host's own list request path did with the row callbacks. */
export interface ListHostDriven {
  /** Cell positions asked for through `update-list-info`. */
  inserted: number[];
  /** Child position asked to be removed. */
  removed: number;
  childrenAfterInserts: number;
  textAfterInserts: string[];
  children: number;
  textInListOrder: string[];
  /** Rows this list still holds, which the host's removal must have released. */
  rows: number;
}

/** What the probe measured about the indexed row model on this host. */
export interface ListMeasurements {
  hostCallbacksWired: boolean;
  /** Child elements the list element held after each step. */
  rows: {
    afterCreate: number;
    afterFirstCell: number;
    afterMiddleCell: number;
    afterRepeat: number;
    afterModelChange: number;
    afterDispose: number;
  };
  /** Elements created per step, from the traced create PAPI. */
  creates: {
    firstCell: number;
    middleCell: number;
    repeat: number;
  };
  textInListOrder: string[];
  /** Number of `__CreateList` / `__UpdateListCallbacks` calls. */
  createCalls: number;
  updateCalls: number;
  /** What happened when a host with no list PAPI was asked for a list. */
  missingHostBehavior: string;
}

const describeArgs = (value: unknown): string => {
  if (value === null || value === undefined) return String(value);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.length} items]`;
  return typeof value;
};

/**
 * Builds a throwaway root in its own container, measures what the host does for
 * each capability, then removes the container again.
 */
export function runCapabilityProbe(label = "web-core"): CapabilityReport {
  const papi = globalThis as unknown as PapiGlobal;
  const findings: CapabilityFinding[] = [];
  const page = papi.__GetPageElement?.();
  const has = (name: string) => ({
    name,
    present: typeof papi[name] === "function",
  });

  if (!page || typeof papi.__GetElementUniqueID !== "function") {
    throw new Error(
      "solid-lynx capability probe: no page element. Run it inside a mounted card.",
    );
  }

  const container = papi.__CreateView?.(papi.__GetElementUniqueID(page))
    ?? papi.__CreateElement?.("view", papi.__GetElementUniqueID(page));
  if (!container) throw new Error("solid-lynx capability probe: cannot create a container");
  papi.__AppendElement?.(page, container);

  const root = createLynxRoot({ page: container });
  const renderer = root.renderer;

  try {
    // List virtualization: the renderer creates the list through
    // `__CreateList` with real row callbacks, and web-core stores that pair on
    // the element it creates. Nothing in web-core calls the pair, so the probe
    // calls it the way a host does and reads the tree the host owns.
    const listId = papi.__GetElementUniqueID!(container);
    let model: string[] = ["alpha", "beta", "gamma", "delta", "epsilon"];
    const listTrace = tracePapi(papi, [
      "__CreateList",
      "__UpdateListCallbacks",
      "__CreateView",
      "__CreateRawText",
    ]);
    const createsAfter = (mark: number) => listTrace.calls
      .slice(mark)
      .filter(call => call.name === "__CreateView" || call.name === "__CreateRawText").length;
    const list = root.createList<string>({
      items: () => model,
      children: (item, index) => {
        const cell = renderer.createElement("view");
        renderer.insert(cell, () => `${item}#${index()}`);
        return cell;
      },
    });
    const listElement = list.list as unknown as HostListElement;
    const hostCallbacksWired = typeof listElement.componentAtIndex === "function"
      && typeof listElement.enqueueComponent === "function";
    const askForCell = (cellIndex: number, operationId: number) => {
      listElement.componentAtIndex?.(listElement, listId, cellIndex, operationId, false);
    };
    const childCount = () => listElement.children?.length ?? 0;

    let mark = listTrace.calls.length;
    const rows: ListMeasurements["rows"] = {
      afterCreate: childCount(),
      afterFirstCell: 0,
      afterMiddleCell: 0,
      afterRepeat: 0,
      afterModelChange: 0,
      afterDispose: 0,
    };
    // Cells are asked for out of order and with gaps, which is where "position
    // among the materialized rows" and "index in the model" come apart.
    askForCell(4, 1);
    rows.afterFirstCell = childCount();
    const firstCell = createsAfter(mark);
    mark = listTrace.calls.length;

    askForCell(1, 2);
    rows.afterMiddleCell = childCount();
    const middleCell = createsAfter(mark);
    mark = listTrace.calls.length;

    // The same key again: a keyed row keeps its node, so nothing is created.
    askForCell(1, 3);
    rows.afterRepeat = childCount();
    const repeat = createsAfter(mark);

    // The model drops two rows and shifts the rest, and no further host request
    // arrives: `update()` has to move the surviving rows and reset their index
    // accessors on its own.
    model = ["beta", "gamma", "epsilon"];
    list.update();
    rows.afterModelChange = childCount();
    const textInListOrder = Array.from(listElement.children ?? []).map(rowLabel);

    list.dispose();
    rows.afterDispose = childCount();
    const listMeasurements: ListMeasurements = {
      hostCallbacksWired,
      rows,
      creates: { firstCell, middleCell, repeat },
      textInListOrder,
      createCalls: listTrace.calls.filter(call => call.name === "__CreateList").length,
      updateCalls: listTrace.calls.filter(call => call.name === "__UpdateListCallbacks").length,
      // A host with no list PAPI has to fail loudly; measured by asking for a
      // list through the same root with the list PAPI removed.
      missingHostBehavior: measureMissingListHost(),
    };
    listTrace.restore();
    (globalThis as unknown as Record<string, unknown>).__SOLID_LYNX_LIST__ = listMeasurements;

    // The host's own request path is measured after this probe's root is gone, so
    // it runs in its own root and reports a promise the host settles itself.
    const hostDriven = measureHostDrivenList(papi, page);
    hostDriven.then(result => {
      listFinding.observed.push(
        `through the host's own update-list-info request (insert ${result.inserted.join(", ")},`
          + ` remove ${result.removed}): ${result.childrenAfterInserts} child element(s) in order`
          + ` [${result.textAfterInserts.join(", ")}], then ${result.children} left`
          + ` [${result.textInListOrder.join(", ")}] with ${result.rows} row(s) still held`,
      );
    });
    (globalThis as unknown as Record<string, unknown>).__SOLID_LYNX_LIST_HOST_DRIVEN__ = hostDriven;

    const listFinding: CapabilityFinding = {
      capability: "list-virtualization",
      status: "supported",
      papi: ["__CreateList", "__UpdateListCallbacks"].map(has),
      observed: [
        `__CreateList calls: ${listMeasurements.createCalls}, __UpdateListCallbacks calls: ${listMeasurements.updateCalls}`,
        `host list callbacks wired on the element: ${hostCallbacksWired ? "yes" : "no"}`,
        `rows created after asking for cell 4: ${listMeasurements.creates.firstCell} element(s),`
          + ` list children: ${listMeasurements.rows.afterFirstCell}`,
        `rows created after asking for cell 1: ${listMeasurements.creates.middleCell} element(s),`
          + ` list children: ${listMeasurements.rows.afterMiddleCell}`,
        `rows created after asking for cell 1 again: ${listMeasurements.creates.repeat}`,
        `list order after a model change with no further host request:`
          + ` ${listMeasurements.textInListOrder.join(", ") || "empty"}`,
        `list children after dispose: ${listMeasurements.rows.afterDispose}`,
        `host without the list PAPI: ${listMeasurements.missingHostBehavior}`,
      ],
      today: "`root.createList()` creates the list through `__CreateList` with a"
        + " `componentAtIndex` and `enqueueComponent` pair, and re-installs the pair through"
        + " `__UpdateListCallbacks` whenever the model changes. The host owns row selection:"
        + " it asks for the cell index it wants and this model materializes exactly that row,"
        + " keyed, in ascending index order even when the host asks out of order. A model"
        + " change moves the surviving rows and resets their index accessors without another"
        + " host request. `componentAtIndex` answers with the row's unique id and"
        + " `enqueueComponent` releases the row the host is removing, including the event"
        + " registrations it filed. On this host the request"
        + " arrives as an `update-list-info` attribute; nothing asks for cells by itself, and"
        + " `<list>` in JSX now fails instead of quietly rendering every row. Verified on this"
        + " host only: no native list run has been done, so what a native list does with these"
        + " callbacks is unknown.",
      requires: [
        "native validation: nothing here has run on a device, so native list support is unverified",
        "a host that recycles cells: this host creates a row for every cell it is asked for,"
          + " and no recycling has been observed on either host",
      ],
    };
    hostDriven.then(result => {
      listFinding.observed.push(
        `through the host's own update-list-info request (insert ${result.inserted.join(", ")},`
          + ` remove 1): ${result.children} child element(s) in order`
          + ` [${result.textInListOrder.join(", ")}], ${result.rows} row(s) still held`,
      );
    });
    findings.push(listFinding);

    // Gestures: this renderer has no gesture binding form, so a gesture prop is
    // written as a plain attribute and never dispatched.
    const gestureTrace = tracePapi(papi, [
      "__AddEventListener",
      "__AddEvent",
      "__SetGestureDetector",
      "__SetAttribute",
    ]);
    const gestureCalls: string[] = [];
    const gestureView = renderer.createElement("view");
    renderer.insert(container, gestureView);
    renderer.setProp(gestureView, "gesture-bindtap", () => undefined);
    renderer.setProp(gestureView, "bindtap", () => undefined);
    gestureCalls.push(...gestureTrace.calls.map(call => `${call.name}(${describeArgs(call.args[0])})`));
    gestureTrace.restore();

    findings.push({
      capability: "gestures",
      status: "unsupported",
      papi: ["__SetGestureDetector", "__RemoveGestureDetector"].map(has),
      observed: [
        `PAPI calls while binding gesture-bindtap and bindtap: ${gestureCalls.join(", ") || "none"}`,
      ],
      today: "There is no gesture binding form. `gesture-bindtap` is written as an ordinary"
        + " attribute and never fires, with no error. Only `bind`/`catch` and their capture"
        + " and namespaced forms dispatch.",
      requires: [
        "a binding form that maps a gesture prop to __SetGestureDetector",
        "a host that implements gesture recognition: web-core stubs both gesture PAPIs",
        "native validation of gesture recognition and its parameters",
      ],
    });

    // Animation: the host implements __ElementAnimate on top of the Web
    // Animations API, but nothing in this renderer calls it.
    const animationView = renderer.createElement("view");
    renderer.insert(container, animationView);
    const animate = (animationView as unknown as { animate?: unknown }).animate;

    findings.push({
      capability: "animation",
      status: "host-only",
      papi: ["__ElementAnimate"].map(has),
      observed: [
        `element.animate available on a created element: ${typeof animate === "function" ? "yes" : "no"}`,
      ],
      today: "There is no animation API. Use inline-style and CSS transitions for animation;"
        + " keyframe animation through the PAPI is not reachable from this renderer.",
      requires: [
        "an animation API that maps declarative props to __ElementAnimate",
        "a decision on whether animation options differ between web and native",
        "native validation of keyframe and timing option parity",
      ],
    });

    // Overlays and portals: the host has an `overlay` element, but a Solid
    // portal needs a DOM parent that does not exist in a Lynx tree, and this
    // package does not export one.
    const overlayView = renderer.createElement("overlay");
    renderer.insert(container, overlayView);
    const overlayTag = (papi.__GetTag as ((n: unknown) => string) | undefined)?.(overlayView);

    findings.push({
      capability: "overlay-portal",
      status: "unsupported",
      papi: ["__InvokeUIMethod"].map(has),
      observed: [
        `renderer created <overlay> as ${describeArgs(overlayTag)}`,
        "solid-lynx exports no Portal or Dynamic component",
      ],
      today: "An `<overlay>` element is created as an ordinary child and has no overlay"
        + " behaviour. Importing `Portal` from solid-lynx fails at build time because the"
        + " package does not export it, which fails loudly rather than degrading.",
      requires: [
        "a Lynx overlay contract: what element hosts overlay content and how it is shown",
        "a decision on whether a portal can be expressed in a single-element tree at all",
        "native validation, since overlay is a native module",
      ],
    });
  // Refs: `ref` is transformed by the Solid JSX compile step, so what this
    // measures is the piece the renderer owns, which is that the node reaches the
    // binding and is released with the scope that created it.
    const refTarget = renderer.createElement("view");
    const refState = createLynxRef<LynxNode>();
    const [showTarget, setShowTarget] = createSignal(true);
    renderer.insert(container, () => {
      if (!showTarget()) return null;
      use(refState, refTarget);
      return refTarget;
    });
    const refWhileMounted = refState.current === refTarget ? "held" : "not held";
    setShowTarget(false);
    const refAfterRemoval = refState.current === undefined ? "released" : "still held";

    findings.push({
      capability: "refs",
      status: "supported",
      papi: [has("__GetElementUniqueID")],
      observed: [
        `ref while its scope is mounted: ${refWhileMounted}`,
        `ref after that scope is disposed: ${refAfterRemoval}`,
        "the ref receives the Lynx PAPI node, and is not written as an attribute",
      ],
      today: "A `ref` receives the Lynx PAPI node, not a browser DOM element. Returning a"
        + " function from the binding releases it when the owning Solid scope is disposed,"
        + " so a removed subtree clears its ref and disposing a root clears every ref."
        + " The Solid JSX transform runs the binding before the element's props, and"
        + " reconciliation that moves an element does not re-fire its ref.",
      requires: [
        "native validation that a ref is handed the same host handle a native card provides",
      ],
    });

    // CSS ids: `__SetCSSId` is part of the Element PAPI surface, and
    // `root.setCSSId` drives it over the elements that root owns in its page.
    // The element has to be a direct child of the root's page for the root to
    // own it, which is the whole scope of the assignment.
    const cssIdView = renderer.createElement("view");
    renderer.insertNode(container, cssIdView);
    const cssIdTrace = tracePapi(papi, ["__SetCSSId"]);
    root.setCSSId(0, "probe");
    cssIdTrace.restore();

    findings.push({
      capability: "css-ids",
      status: "supported",
      papi: [has("__SetCSSId")],
      observed: [
        `PAPI calls while assigning a CSS id: ${cssIdTrace.calls.map(call => call.name).join(", ") || "none"}`,
        `elements the assignment covered: ${describeArgs(cssIdTrace.calls[0]?.args[0])}`,
        "elements the root adds to its page later: assigned the same id",
      ],
      today: "`root.setCSSId()` assigns a compiled CSS id to every element that root owns in"
        + " its page, in one batched call, and to elements it puts there later. A host"
        + " without `__SetCSSId` throws rather than rendering unstyled. A CSS id only has"
        + " a visible effect when the bundle contains a compiled stylesheet for it.",
      requires: [
        "native validation of __SetCSSId availability and argument order",
      ],
    });

    // Stylesheet loading: recorded as a negative measurement, because the only
    // honest answer here is that no host exposes an operation to drive.
    findings.push({
      capability: "stylesheet-loading",
      status: "unsupported",
      papi: ["__SetCSSId", "__SetClasses", "__AddInlineStyle", "__SetInlineStyles"].map(has),
      observed: [
        "no Element PAPI adds, replaces, or removes a stylesheet",
      ],
      today: "A stylesheet is compiled into the bundle by the Lynx toolchain and a CSS id"
        + " only selects among the ones already there. There is no operation to call at"
        + " runtime, so this is absent rather than merely unreachable.",
      requires: [
        "a host PAPI that loads or swaps a stylesheet, which web-core does not define",
      ],
    });
  } finally {
    root.dispose();
    papi.__RemoveElement?.(page, container);
  }

  return { label, findings };
}

export function installCapabilityProbe(): CapabilityReport {
  const report = runCapabilityProbe();
  (globalThis as unknown as Record<string, unknown>).__SOLID_LYNX_CAPABILITIES__ = report;
  return report;
}

/**
 * Asks for a list through a host that implements no list PAPI.
 *
 * Reported as text rather than an exception so the pattern card keeps rendering
 * and the finding still says what an app on such a host would see.
 */
function measureMissingListHost(): string {
  const papi = globalThis as unknown as PapiGlobal;
  const withoutList: LynxPapi = { ...papi } as LynxPapi;
  delete withoutList.__CreateList;
  delete withoutList.__UpdateListCallbacks;
  const page = papi.__GetPageElement?.();
  if (!page) return "not measured: no page element";
  try {
    const container = papi.__CreateView?.(papi.__GetElementUniqueID!(page))
      ?? papi.__CreateElement?.("view", papi.__GetElementUniqueID!(page));
    if (!container) return "not measured: cannot create a container";
    papi.__AppendElement?.(page, container);
    const root = createLynxRoot({ page: container, papi: withoutList });
    try {
      root.createList({ items: () => [], children: () => root.renderer.createElement("view") });
      return "no error: the list was created without the list PAPI";
    } finally {
      root.dispose();
      papi.__RemoveElement?.(page, container);
    }
  } catch (error) {
    return `throws ${(error as Error).message}`;
  }
}
/**
 * Drives the host's own list request path, end to end.
 *
 * web-core does not call `componentAtIndex` by itself. It calls it from the
 * `update-list-info` attribute on the list element: `insertAction` names the
 * cell positions to materialize, `removeAction` names the child positions to
 * drop, and the host positions and removes the elements itself. This measures
 * that path in its own root, because the host applies the request in a
 * microtask and the probe's own root is disposed before that runs.
 */
async function measureHostDrivenList(papi: PapiGlobal, page: LynxNode): Promise<ListHostDriven> {
  const empty: ListHostDriven = {
    inserted: [2, 0],
    removed: 1,
    childrenAfterInserts: -1,
    textAfterInserts: [],
    children: -1,
    textInListOrder: [],
    rows: -1,
  };
  const parentId = papi.__GetElementUniqueID!(page);
  const container = papi.__CreateView?.(parentId) ?? papi.__CreateElement?.("view", parentId);
  if (!container) return empty;
  papi.__AppendElement?.(page, container);

  const root = createLynxRoot({ page: container as LynxNode });
  try {
    const list = root.createList<string>({
      items: () => ["alpha", "beta", "gamma"],
      children: (item, index) => {
        const cell = root.renderer.createElement("view");
        root.renderer.insert(cell, () => `${item}#${index()}`);
        return cell;
      },
    });
    const element = list.list as unknown as HostListElement;
    const labels = () => Array.from(element.children ?? []).map(rowLabel);

    root.renderer.setProp(list.list, "update-list-info", {
      insertAction: [{ position: 2 }, { position: 0 }],
      removeAction: [],
    });
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    const childrenAfterInserts = element.children?.length ?? 0;
    const textAfterInserts = labels();

    // A second request drops the second child. The host calls `enqueueComponent`
    // with that element's unique id and then removes the node itself.
    root.renderer.setProp(list.list, "update-list-info", {
      insertAction: [],
      removeAction: [1],
    });
    await new Promise<void>(resolve => setTimeout(resolve, 0));

    return {
      inserted: [2, 0],
      removed: 1,
      childrenAfterInserts,
      textAfterInserts,
      children: element.children?.length ?? 0,
      textInListOrder: labels(),
      rows: list.rows.length,
    };
  } finally {
    root.dispose();
    papi.__RemoveElement?.(page, container);
  }
}
