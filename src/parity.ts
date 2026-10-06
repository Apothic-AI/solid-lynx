import { createSignal } from "solid-js";

import type { LynxNode } from "./host.js";
import { isLynxNode, type LynxPapi } from "./lynx-host.js";
import { createLynxRoot } from "./root.js";

/**
 * Native-versus-web parity harness.
 *
 * The renderer is exercised through the Element PAPI, and every operation the
 * adapter depends on is a host capability rather than a Solid feature. Running
 * the same probe against two hosts is what turns "it works on the web build"
 * into a comparison, so this module takes its host as input and returns a
 * report instead of asserting anything itself.
 *
 * The harness only reads and writes a sandbox element it creates, so it can run
 * inside a live card without disturbing the app around it.
 */

export type ParityStatus = "pass" | "fail" | "unsupported";

export interface ParityOperationResult {
  /** Stable identifier used by the parity checklist. */
  operation: string;
  /** Element PAPI names the operation needs. */
  papi: string[];
  status: ParityStatus;
  expected: string;
  observed: string;
  /** What to do about a failure, when the harness can say something useful. */
  note?: string;
}

export interface ParityReport {
  /** Host the report describes, for example `web-core` or `android`. */
  label: string;
  operations: ParityOperationResult[];
  /** Operations that ran and did not match the expected result. */
  failures: ParityOperationResult[];
  summary: {
    pass: number;
    fail: number;
    unsupported: number;
  };
}

export interface ElementPapiParityOptions {
  /** Host label recorded in the report. Defaults to `unknown`. */
  label?: string;
  /** Injected PAPI surface. Defaults to the current realm's globals. */
  papi?: LynxPapi;
  /**
   * Element the sandbox is attached to. A host that does not create pages for
   * the app, such as a native card, passes the element its app renders into.
   */
  page?: LynxNode;
  /** Component id for the page when the harness has to create one. */
  componentId?: string;
  /** CSS id for the page when the harness has to create one. */
  cssId?: number;
  /** Overrides the component id new elements are created under. */
  parentComponentId?: number;
}

type PapiFunction = (...args: any[]) => any;

/**
 * The read side of the Element PAPI.
 *
 * The renderer only needs to write, so these stay out of `LynxPapi`. A parity
 * run has to read values back to compare two hosts, and a host that does not
 * implement one reports it as unsupported instead of failing.
 */
interface ParityPapi extends LynxPapi {
  __GetChildren?: PapiFunction;
  __GetTag?: PapiFunction;
  __GetID?: PapiFunction;
  __GetClasses?: PapiFunction;
  __GetAttributeByName?: PapiFunction;
  __GetAttributeNames?: PapiFunction;
  __GetDataset?: PapiFunction;
  __GetInlineStyles?: PapiFunction;
  __GetComputedStyleByKey?: PapiFunction;
}

type PapiGlobal = ParityPapi & Record<string, unknown>;

const describeError = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

/** Every operation id this harness reports, in the order it runs them. */
export const parityOperationIds = [
  "page",
  "sandbox",
  "element-unique-id",
  "create-element",
  "create-raw-text",
  "append",
  "insert-before",
  "remove",
  "traverse",
  "set-attribute",
  "attribute-names",
  "classes",
  "inline-styles",
  "dataset",
  "id",
  "event-listener",
  "flush",
  "renderer-mount",
  "renderer-text-update",
  "renderer-dispose",
] as const;

export type ParityOperationId = (typeof parityOperationIds)[number];

/**
 * Probes the shared Element PAPI operations and the renderer paths built on
 * them, then returns what the host actually did.
 *
 * A missing PAPI function is reported as `unsupported` rather than a failure:
 * a host that lacks an operation the adapter can work without is a difference
 * to record, not a defect. A call that throws or returns something other than
 * the documented result is a `fail`.
 */
export function runElementPapiParity(options: ElementPapiParityOptions = {}): ParityReport {
  const papi = (options.papi ?? globalThis) as PapiGlobal;
  const operations: ParityOperationResult[] = [];

  const call = <Key extends keyof ParityPapi>(
    name: Key,
    ...args: Parameters<NonNullable<ParityPapi[Key]>>
  ): unknown => {
    const fn = papi[name];
    if (typeof fn !== "function") {
      throw new Error(`${String(name)}() is not available on this host`);
    }
    return (fn as (...callArgs: unknown[]) => unknown)(...args);
  };
  const supports = (...names: string[]): string[] =>
    names.filter(name => typeof papi[name] !== "function");

  const check = (
    operation: ParityOperationId,
    papiNames: string[],
    expected: string,
    probe: () => string,
    /** `gate: false` lets the probe run even when a listed PAPI is missing. */
    { gate = true, note }: { gate?: boolean; note?: string } = {},
  ): void => {
    const missing = supports(...papiNames);
    if (gate && missing.length > 0) {
      operations.push({
        operation,
        papi: papiNames,
        status: "unsupported",
        expected,
        observed: `missing ${missing.join(", ")}`,
      });
      return;
    }
    try {
      const observed = probe();
      operations.push({
        operation,
        papi: papiNames,
        status: observed === expected ? "pass" : "fail",
        expected,
        observed,
        ...(observed === expected || !note ? {} : { note }),
      });
    } catch (error) {
      operations.push({
        operation,
        papi: papiNames,
        status: "fail",
        expected,
        observed: describeError(error),
        ...(note ? { note } : {}),
      });
    }
  };

  let page = options.page;
  check("page", options.page ? [] : ["__CreatePage"], "page", () => {
    if (!page) {
      if (typeof papi.__CreatePage !== "function") {
        throw new Error(
          "no page element: this host has no __CreatePage(), so pass the element the app"
          + " renders into as `page`",
        );
      }
      page = call("__CreatePage", options.componentId ?? "0", options.cssId ?? 0) as LynxNode;
    }
    if (!isLynxNode(page)) return "no page element";
    const id = papi.__GetElementUniqueID?.(page);
    return id === undefined || (Number.isInteger(id) && id >= 0)
      ? "page"
      : `unexpected page unique id ${String(id)}`;
  }, { gate: false });

  const summarize = (): ParityReport => {
    const failures = operations.filter(result => result.status === "fail");
    return {
      label: options.label ?? "unknown",
      operations,
      failures,
      summary: {
        pass: operations.filter(result => result.status === "pass").length,
        fail: failures.length,
        unsupported: operations.filter(result => result.status === "unsupported").length,
      },
    };
  };

  if (!isLynxNode(page)) {
    // Nothing can be attached anywhere, so every remaining operation is reported
    // as blocked by the same cause instead of failing on its own.
    for (const operation of parityOperationIds.slice(1)) {
      operations.push({
        operation,
        papi: [],
        status: "fail",
        expected: "n/a",
        observed: "blocked: no page element to probe",
      });
    }
    return summarize();
  }

  const parentComponentId = options.parentComponentId
    ?? (page && typeof papi.__GetElementUniqueID === "function"
      ? (call("__GetElementUniqueID", page) as number)
      : 0);

  let sandbox: LynxNode | undefined;
  check("sandbox", ["__CreateView", "__AppendElement"], "attached", () => {
    const create = papi.__CreateView ?? papi.__CreateElement;
    if (typeof create !== "function") throw new Error("no element creation PAPI on this host");
    sandbox = (create as (id: number) => LynxNode)(parentComponentId);
    call("__AppendElement", page, sandbox);
    const children = (call("__GetChildren", page) as LynxNode[] | null) ?? [];
    return children.includes(sandbox!) ? "attached" : "not in page children";
  });

  const withSandbox = (probe: (node: LynxNode) => string): () => string => () => {
    if (!sandbox) throw new Error("the sandbox element was not created");
    return probe(sandbox);
  };

  check(
    "element-unique-id",
    ["__GetElementUniqueID"],
    "unique id >= 0",
    withSandbox(node => {
      const id = call("__GetElementUniqueID", node) as number;
      return Number.isInteger(id) && id >= 0 ? "unique id >= 0" : `unique id ${String(id)}`;
    }),
  );

  check("create-element", ["__CreateView", "__CreateElement"], "view", withSandbox(node => {
    const create = papi.__CreateView ?? papi.__CreateElement;
    const child = (create as (id: number) => LynxNode)(parentComponentId);
    const tag = typeof papi.__GetTag === "function"
      ? (call("__GetTag", child) as string)
      : "unknown";
    return tag === "view" || tag === "unknown" ? "view" : tag;
  }));

  check(
    "create-raw-text",
    ["__CreateRawText", "__GetAttributeByName"],
    "parity",
    withSandbox(() => String(call("__GetAttributeByName", call("__CreateRawText", "parity"), "text"))),
  );

  const childrenOf = (node: LynxNode): LynxNode[] =>
    (call("__GetChildren", node) as LynxNode[] | null) ?? [];

  let first: LynxNode | undefined;
  let second: LynxNode | undefined;
  let anchor: LynxNode | undefined;

  check("append", ["__CreateElement", "__AppendElement", "__GetChildren"], "2 children",
    withSandbox(node => {
      const create = papi.__CreateElement as (tag: string, id: number) => LynxNode;
      first = create("view", parentComponentId);
      second = create("view", parentComponentId);
      call("__AppendElement", node, first);
      call("__AppendElement", node, second);
      return childrenOf(node).length === 2 ? "2 children" : `${childrenOf(node).length} children`;
    }));

  check(
    "insert-before",
    ["__CreateElement", "__InsertElementBefore", "__GetChildren"],
    "inserted",
    withSandbox(node => {
      const create = papi.__CreateElement as (tag: string, id: number) => LynxNode;
      anchor = create("view", parentComponentId);
      call("__AppendElement", node, anchor);
      const inserted = create("view", parentComponentId);
      call("__InsertElementBefore", node, inserted, anchor);
      const order = childrenOf(node);
      const at = order.indexOf(inserted);
      return at === order.length - 2 ? "inserted" : `inserted at ${String(at)} of ${order.length}`;
    }),
  );

  check("remove", ["__RemoveElement", "__GetChildren"], "removed", withSandbox(node => {
    const child = childrenOf(node)[0];
    if (!child) throw new Error("no child to remove");
    call("__RemoveElement", node, child);
    return childrenOf(node).includes(child) ? "still present" : "removed";
  }));

  check(
    "traverse",
    ["__FirstElement", "__NextElement", "__GetParent"],
    "first, next, parent",
    withSandbox(node => {
      const firstChild = childrenOf(node)[0];
      const secondChild = childrenOf(node)[1];
      const observedFirst = call("__FirstElement", node) === firstChild;
      const observedNext = call("__NextElement", firstChild) === secondChild;
      const observedParent = call("__GetParent", firstChild) === node;
      return observedFirst && observedNext && observedParent
        ? "first, next, parent"
        : `first=${observedFirst} next=${observedNext} parent=${observedParent}`;
    }),
  );

  check(
    "set-attribute",
    ["__SetAttribute", "__GetAttributeByName"],
    "attribute",
    withSandbox(node => {
      call("__SetAttribute", node, "data-parity", "attribute");
      return String(call("__GetAttributeByName", node, "data-parity"));
    }),
  );

  check(
    "attribute-names",
    ["__SetAttribute", "__GetAttributeNames"],
    "listed",
    withSandbox(node => {
      call("__SetAttribute", node, "data-parity-name", "listed");
      const names = (call("__GetAttributeNames", node) as string[] | null) ?? [];
      return names.includes("data-parity-name") ? "listed" : names.join(",") || "no attributes";
    }),
  );

  check(
    "classes",
    ["__SetClasses", "__GetClasses"],
    "alpha,beta",
    withSandbox(node => {
      call("__SetClasses", node, "alpha beta");
      const classes = (call("__GetClasses", node) as string[] | null) ?? [];
      return classes.join(",");
    }),
  );

  check(
    "inline-styles",
    ["__SetInlineStyles"],
    "style set",
    withSandbox(node => {
      call("__SetInlineStyles", node, "color: rgb(1, 2, 3)");
      // Hosts expose the value differently: native has `__GetInlineStyles`,
      // web-core stores it as the `style` attribute, and either may compute it.
      const readBack = typeof papi.__GetInlineStyles === "function"
        ? (call("__GetInlineStyles", node) as string | null)
        : typeof papi.__GetAttributeByName === "function"
          ? (call("__GetAttributeByName", node, "style") as string | null)
          : (call("__GetComputedStyleByKey", node, "color") as string | null);
      return readBack ? "style set" : `no style (${String(readBack)})`;
    }),
  );

  // Writing a dataset has two host spellings, so only the read is required here
  // and the probe picks whichever writer the host provides.
  check(
    "dataset",
    ["__GetDataset"],
    "dataset",
    withSandbox(node => {
      const add = papi.__AddDataset;
      if (typeof add === "function") add(node, "parity", "dataset");
      else if (typeof papi.__SetDataset === "function") papi.__SetDataset(node, { parity: "dataset" });
      else throw new Error("neither __AddDataset() nor __SetDataset() is available");
      const dataset = (call("__GetDataset", node) as Record<string, unknown> | null) ?? {};
      return dataset.parity === "dataset" ? "dataset" : JSON.stringify(dataset);
    }),
  );

  check("id", ["__SetID", "__GetID"], "parity-id", withSandbox(node => {
    call("__SetID", node, "parity-id");
    return String(call("__GetID", node));
  }));

  // A host binds callbacks or handler names, so no single PAPI is required and
  // the probe reports which of the two it found.
  check(
    "event-listener",
    [],
    "listener API present",
    () => {
      if (supports("__AddEventListener").length === 0 && supports("__RemoveEventListener").length === 0) {
        return "listener API present";
      }
      return supports("__AddEvent").length === 0 ? "__AddEvent only" : "no event binding PAPI";
    },
  );

  check("flush", ["__FlushElementTree"], "flushed", () => {
    call("__FlushElementTree");
    return "flushed";
  });

  let root: ReturnType<typeof createLynxRoot> | undefined;
  let mountedView: LynxNode | undefined;
  let updateText: (() => void) | undefined;
  let childrenBeforeMount = 0;

  check(
    "renderer-mount",
    ["__CreateView", "__CreateRawText"],
    "mounted",
    withSandbox(node => {
      // A root renders into its own container, which is how a nested root is
      // hosted when the page itself belongs to another root.
      root = createLynxRoot({ page: node, papi, parentComponentId });
      childrenBeforeMount = childrenOf(node).length;
      root.render(() => {
        const view = root!.renderer.createElement("view");
        // The text is a reactive accessor, which is what a compiled Solid text
        // node compiles to, so the update below exercises `replaceText`.
        const [text, setText] = createSignal("mounted");
        updateText = () => setText("updated");
        root!.renderer.insert(view, text);
        mountedView = view;
        return view;
      });
      return childrenOf(node).includes(mountedView!) ? "mounted" : "view missing from the container";
    }),
  );

  check(
    "renderer-text-update",
    ["__SetAttribute", "__GetAttributeByName"],
    "updated",
    () => {
      if (!updateText || !mountedView) throw new Error("the renderer did not mount a text node");
      updateText();
      const rawText = call("__FirstElement", mountedView) as LynxNode;
      const value = String(call("__GetAttributeByName", rawText, "text"));
      return value === "updated" ? "updated" : value;
    },
    {
      note: "the reactive update did not reach the element: this host drops the text"
        + " attribute, or the harness is running on Solid's server build, which has no"
        + " reactive effects",
    },
  );

  check("renderer-dispose", ["__RemoveElement", "__GetChildren"], "released", () => {
    if (!root || !sandbox) throw new Error("the renderer did not mount a tree");
    root.dispose();
    // The earlier probes leave their own nodes in the sandbox, so disposal is
    // checked against the count taken before the renderer mounted.
    const left = childrenOf(sandbox).length - childrenBeforeMount;
    return left === 0 ? "released" : `${left} node(s) left attached`;
  });

  if (sandbox && page) {
    try {
      call("__RemoveElement", page, sandbox);
    } catch {
      // The sandbox is already gone, or the host removed the page with it.
    }
  }

  return summarize();
}

/**
 * Renders a report as a markdown table.
 *
 * The note column carries the harness's own advice for a failure, so a report
 * pasted into an issue says what to check without the reader needing the code.
 */
export function formatParityReport(report: ParityReport): string {
  const rows = report.operations.map(result =>
    `| \`${result.operation}\` | ${result.papi.join(", ") || "-"} | ${result.expected}`
    + ` | ${result.status} | ${result.observed} | ${result.note ?? ""} |`);
  return [
    `| Operation | Element PAPI | Expected | Status | Observed | Note |`,
    `| --- | --- | --- | --- | --- | --- |`,
    ...rows,
    "",
    `Summary for \`${report.label}\`: ${report.summary.pass} pass,`
    + ` ${report.summary.fail} fail, ${report.summary.unsupported} unsupported.`,
  ].join("\n");
}