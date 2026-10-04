import { describe, expect, it } from "vitest";

import {
  formatParityReport,
  parityOperationIds,
  runElementPapiParity,
  type ParityReport,
} from "../src/parity.js";
import type { LynxNode } from "../src/host.js";
import type { LynxPapi } from "../src/lynx-host.js";

/**
 * A minimal in-memory Element PAPI host.
 *
 * It implements only what the parity harness probes, which keeps the harness
 * honest: an operation the fake does not implement has to be reported as
 * unsupported rather than quietly passing.
 */
function createFakeHost() {
  let nextId = 1;
  const page: FakeNode = makeNode("page");
  const ids = new WeakMap<object, number>([[page, nextId++]]);

  function makeNode(tagName: string): FakeNode {
    return { tagName, attributes: {}, classes: [], dataset: {}, children: [], parent: undefined };
  }
  function register(node: FakeNode): FakeNode {
    ids.set(node, nextId++);
    return node;
  }
  function create(tagName: string): FakeNode {
    return register(makeNode(tagName));
  }

  const papi = {
    __CreatePage: () => page,
    __CreateView: () => create("view"),
    __CreateElement: (tag: string) => create(tag),
    __CreateText: () => create("text"),
    __CreateRawText: (text: string) => {
      const node = create("raw-text");
      node.attributes.text = text;
      return node;
    },
    __GetElementUniqueID: (node: FakeNode) => ids.get(node) ?? -1,
    __AppendElement: (parent: FakeNode, child: FakeNode) => {
      child.parent?.children.splice(child.parent.children.indexOf(child), 1);
      parent.children.push(child);
      child.parent = parent;
    },
    __InsertElementBefore: (parent: FakeNode, child: FakeNode, anchor: FakeNode) => {
      child.parent?.children.splice(child.parent.children.indexOf(child), 1);
      parent.children.splice(parent.children.indexOf(anchor), 0, child);
      child.parent = parent;
    },
    __RemoveElement: (parent: FakeNode, child: FakeNode) => {
      const index = parent.children.indexOf(child);
      if (index < 0) throw new Error("the node is not a child of that parent");
      parent.children.splice(index, 1);
      child.parent = undefined;
    },
    __GetChildren: (node: FakeNode) => node.children,
    __GetParent: (node: FakeNode) => node.parent ?? null,
    __FirstElement: (node: FakeNode) => node.children[0] ?? null,
    __NextElement: (node: FakeNode) => {
      const siblings = node.parent?.children ?? [];
      return siblings[siblings.indexOf(node) + 1] ?? null;
    },
    __SetAttribute: (node: FakeNode, name: string, value: unknown) => {
      if (value == null) delete node.attributes[name];
      else node.attributes[name] = String(value);
    },
    __GetAttributeByName: (node: FakeNode, name: string) => node.attributes[name] ?? null,
    __GetAttributeNames: (node: FakeNode) => Object.keys(node.attributes),
    __SetClasses: (node: FakeNode, value: string) => {
      node.classes = value ? value.split(" ") : [];
    },
    __GetClasses: (node: FakeNode) => node.classes,
    __SetInlineStyles: (node: FakeNode, value: unknown) => {
      node.attributes.style = String(value ?? "");
    },
    __AddDataset: (node: FakeNode, key: string, value: unknown) => {
      if (value == null) delete node.dataset[key];
      else node.dataset[key] = value;
    },
    __GetDataset: (node: FakeNode) => ({ ...node.dataset }),
    __SetID: (node: FakeNode, value: string | null) => {
      if (value == null) delete node.attributes.id;
      else node.attributes.id = value;
    },
    __GetID: (node: FakeNode) => node.attributes.id ?? null,
    __GetTag: (node: FakeNode) => node.tagName,
    __AddEventListener: () => undefined,
    __RemoveEventListener: () => undefined,
    __FlushElementTree: () => undefined,
  };

  return { page, papi };
}

interface FakeNode extends LynxNode {
  tagName: string;
  attributes: Record<string, string>;
  classes: string[];
  dataset: Record<string, unknown>;
  children: FakeNode[];
  parent?: FakeNode;
}

const byOperation = (report: ParityReport) =>
  new Map(report.operations.map(result => [result.operation, result]));

describe("element PAPI parity harness", () => {
  it("reports every shared operation as passing on a complete host", () => {
    const host = createFakeHost();

    const report = runElementPapiParity({ label: "fake", papi: host.papi });

    expect(report.label).toBe("fake");
    expect(report.summary).toEqual({ pass: parityOperationIds.length, fail: 0, unsupported: 0 });
    expect(report.failures).toEqual([]);
    expect(report.operations.map(result => result.operation)).toEqual([...parityOperationIds]);
  });

  it("removes the sandbox it creates so the host is left as it was found", () => {
    const host = createFakeHost();

    runElementPapiParity({ papi: host.papi });

    expect(host.page.children).toEqual([]);
  });

  it("records a missing operation as unsupported instead of a failure", () => {
    const host = createFakeHost();
    const { __GetClasses: _omitted, ...withoutClasses } = host.papi;

    const report = runElementPapiParity({ papi: withoutClasses });

    const classes = byOperation(report).get("classes");
    expect(classes?.status).toBe("unsupported");
    expect(classes?.observed).toContain("__GetClasses");
    expect(report.failures).toEqual([]);
    expect(report.summary.unsupported).toBe(1);
  });

  it("records a throwing operation as a failure", () => {
    const host = createFakeHost();
    const papi = {
      ...host.papi,
      __SetClasses: () => {
        throw new Error("classes are not supported here");
      },
    };

    const report = runElementPapiParity({ papi });

    const classes = byOperation(report).get("classes");
    expect(classes?.status).toBe("fail");
    expect(classes?.observed).toContain("classes are not supported here");
    expect(report.summary.fail).toBe(1);
  });

  it("uses a page supplied by the host instead of creating one", () => {
    const host = createFakeHost();
    const papi = { ...host.papi, __CreatePage: undefined };
    const container = host.papi.__CreateView() as FakeNode;
    host.papi.__AppendElement(host.page, container);

    const report = runElementPapiParity({ papi, page: container });

    expect(byOperation(report).get("page")?.status).toBe("pass");
    expect(report.summary.fail).toBe(0);
    expect(container.children).toEqual([]);
  });

  it("blocks every operation with the same cause when no page is reachable", () => {
    const host = createFakeHost();
    const papi = { ...host.papi, __CreatePage: undefined, __GetElementUniqueID: undefined };

    const report = runElementPapiParity({ papi });

    const page = byOperation(report).get("page");
    expect(page?.status).toBe("fail");
    expect(page?.observed).toContain("__CreatePage");
    // Every operation still appears in the report, marked as blocked rather than
    // failing on its own, so the checklist keeps one row per operation.
    expect(report.operations).toHaveLength(parityOperationIds.length);
    expect(report.operations.slice(1).every(result =>
      result.status === "fail" && result.observed.includes("blocked"))).toBe(true);
    expect(report.summary.pass).toBe(0);
  });

  it("explains a reactive text update that never reaches the element", () => {
    const host = createFakeHost();
    // A host that silently drops the text attribute is indistinguishable from a
    // reactive runtime that never re-runs, so the harness has to say which
    // causes it suspects.
    const papi = {
      ...host.papi,
      __SetAttribute: (node: FakeNode, name: string, value: unknown) => {
        if (name === "text") return;
        host.papi.__SetAttribute(node, name, value);
      },
    };

    const report = runElementPapiParity({ papi });

    const update = byOperation(report).get("renderer-text-update");
    expect(update?.status).toBe("fail");
    expect(update?.note).toContain("server build");
    expect(report.failures.map(failure => failure.operation)).toEqual(["renderer-text-update"]);
  });

  it("formats a report as the markdown table used by the checklist", () => {
    const host = createFakeHost();

    const table = formatParityReport(runElementPapiParity({ label: "fake", papi: host.papi }));

    const rows = table.split("\n");
    expect(rows[0]).toBe("| Operation | Element PAPI | Expected | Status | Observed | Note |");
    expect(rows).toHaveLength(parityOperationIds.length + 4);
    expect(rows.at(-1)).toContain("Summary for `fake`");
    const createElement = rows.find(row => row.includes("`create-element`"));
    expect(createElement).toContain("| `create-element` |");
    expect(createElement).toContain("| pass |");
  });
});