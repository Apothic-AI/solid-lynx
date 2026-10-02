import { createSignal } from "solid-js";
import { describe, expect, it } from "vitest";

import {
  createGlobalLynxHost,
  createLynxRenderer,
  createLynxRoot,
  createElement as compiledElement,
  createTextNode as compiledText,
  insert as compiledInsert,
  setProp as compiledProp,
  parseEventProp,
} from "../src/index.js";
import type { LynxNode } from "../src/host.js";
import type { LynxPapi } from "../src/lynx-host.js";

interface FakeNode extends LynxNode {
  kind: "element" | "text";
  tagName: string;
  text: string;
  attributes: Record<string, unknown>;
  children: FakeNode[];
  parent?: FakeNode;
  listeners: Record<string, (event: unknown) => void>;
}

function createFakePapi() {
  let nextId = 1;
  let flushes = 0;

  const makeNode = (kind: FakeNode["kind"], tagName: string, text = ""): FakeNode => ({
    kind,
    tagName,
    text,
    attributes: {},
    children: [],
    listeners: {},
  });

  const append = (parent: FakeNode, child: FakeNode, anchor?: FakeNode) => {
    if (child === anchor) return;
    if (child.parent) {
      child.parent.children.splice(child.parent.children.indexOf(child), 1);
    }
    const index = anchor ? parent.children.indexOf(anchor) : parent.children.length;
    if (index < 0) throw new Error("Anchor is not a child of the destination parent");
    child.parent = parent;
    parent.children.splice(index, 0, child);
  };

  const page = makeNode("element", "page");
  const ids = new WeakMap<object, number>([[page, nextId++]]);

  const register = (node: FakeNode) => {
    ids.set(node, nextId++);
    return node;
  };

  const papi: LynxPapi = {
    __CreatePage: () => page,
    __CreateElement: (tag: string) => register(makeNode("element", tag)),
    __CreateView: () => register(makeNode("element", "view")),
    __CreateText: () => register(makeNode("element", "text")),
    __CreateImage: () => register(makeNode("element", "image")),
    __CreateScrollView: () => register(makeNode("element", "scroll-view")),
    __CreateWrapperElement: () => register(makeNode("element", "wrapper")),
    __CreateRawText: (text: string) => register(makeNode("text", "raw-text", text)),
    __GetElementUniqueID: (node: FakeNode) => ids.get(node)!,
    __AppendElement: (parent: FakeNode, child: FakeNode) => append(parent, child),
    __InsertElementBefore: (parent: FakeNode, child: FakeNode, anchor: FakeNode) => {
      append(parent, child, anchor);
    },
    __RemoveElement: (parent: FakeNode, child: FakeNode) => {
      const index = parent.children.indexOf(child);
      if (index < 0) throw new Error("Cannot remove a node from the wrong parent");
      parent.children.splice(index, 1);
      child.parent = undefined;
    },
    __FirstElement: (node: FakeNode) => node.children[0] ?? null,
    __NextElement: (node: FakeNode) => {
      const siblings = node.parent?.children ?? [];
      return siblings[siblings.indexOf(node) + 1] ?? null;
    },
    __GetParent: (node: FakeNode) => node.parent ?? null,
    __SetAttribute: (node: FakeNode, name: string, value: unknown) => {
      if (name === "text") node.text = String(value ?? "");
      else if (value === null) delete node.attributes[name];
      else node.attributes[name] = value;
    },
    __SetID: (node: FakeNode, value: string | null) => {
      if (value == null) delete node.attributes.id;
      else node.attributes.id = value;
    },
    __SetClasses: (node: FakeNode, value: string) => {
      node.attributes.class = value;
    },
    __SetInlineStyles: (node: FakeNode, value: unknown) => {
      node.attributes.style = value;
    },
    __AddDataset: (node: FakeNode, key: string, value: unknown) => {
      node.attributes[`data-${key}`] = value;
    },
    __AddEventListener: (
      node: FakeNode,
      eventName: string,
      listener: (event: unknown) => void,
    ) => {
      node.listeners[eventName] = listener;
    },
    __RemoveEventListener: (
      node: FakeNode,
      eventName: string,
    ) => {
      delete node.listeners[eventName];
    },
    __FlushElementTree: () => {
      flushes += 1;
    },
  };

  return {
    page,
    papi,
    get flushes() {
      return flushes;
    },
  };
}

describe("solid-lynx", () => {
  it("normalizes React-style event names to Lynx bindings", () => {
    expect(parseEventProp("onClick", true)).toEqual({ type: "bindEvent", name: "tap" });
    expect(parseEventProp("onCatchTap", true)).toEqual({ type: "catchEvent", name: "tap" });
    expect(parseEventProp("capture-bindscroll", true)).toEqual({
      type: "capture-bind",
      name: "scroll",
    });
  });

  it("renders signal updates through the Element PAPI host", () => {
    const fake = createFakePapi();
    const host = createGlobalLynxHost({
      papi: fake.papi,
      getParentComponentId: () => fake.papi.__GetElementUniqueID!(fake.page),
      flushScheduler: callback => callback(),
    });
    const renderer = createLynxRenderer(host);
    const [count, setCount] = createSignal(0);

    const dispose = renderer.render(() => {
      const view = renderer.createElement("view");
      renderer.insert(view, () => `Count: ${count()}`);
      return view;
    }, fake.page);

    expect(fake.page.children[0]?.tagName).toBe("view");
    expect(fake.page.children[0]?.children[0]?.text).toBe("Count: 0");

    const text = fake.page.children[0]!.children[0]!;
    setCount(3);

    expect(fake.page.children[0]?.children[0]?.text).toBe("Count: 3");
    expect(fake.page.children[0]?.children[0]).toBe(text);
    expect(fake.flushes).toBeGreaterThan(0);
    dispose();
    setCount(4);
    expect(text.text).toBe("Count: 3");
  });

  it("maps properties and invokes normalized tap handlers", () => {
    const fake = createFakePapi();
    const root = createLynxRoot({
      page: fake.page,
      papi: fake.papi,
      parentComponentId: 1,
      transformEventNames: true,
      componentId: "unused",
    });
    let received: unknown;

    root.render(() => {
      const view = root.renderer.createElement("view");
      root.renderer.setProp(view, "className", "button");
      root.renderer.setProp(view, "style", { color: "red" });
      root.renderer.setProp(view, "data-kind", "primary");
      root.renderer.setProp(view, "onClick", (event: unknown) => {
        received = event;
      });
      return view;
    });

    const view = fake.page.children[0]!;
    expect(view.attributes).toMatchObject({
      class: "button",
      style: { color: "red" },
      "data-kind": "primary",
    });

    const event = { detail: { value: 1 } };
    view.listeners.tap?.(event);
    expect(received).toBe(event);
  });

  it("reconciles reordered and removed nodes without replacing retained nodes", () => {
    const fake = createFakePapi();
    const host = createGlobalLynxHost({ papi: fake.papi, getParentComponentId: () => 1 });
    const renderer = createLynxRenderer(host);
    let setNodes!: (nodes: LynxNode[]) => void;
    const nodes = ["a", "b", "c"].map(id => {
      const node = renderer.createElement("view");
      renderer.setProp(node, "id", id);
      return node;
    });
    const dispose = renderer.render(() => {
      const [current, setCurrent] = createSignal(nodes);
      setNodes = setCurrent;
      const view = renderer.createElement("view");
      renderer.insert(view, current);
      return view;
    }, fake.page);
    const view = fake.page.children[0]!;
    expect(view.children).toEqual(nodes);
    setNodes([nodes[2]!, nodes[0]!]);
    expect(view.children).toEqual([nodes[2], nodes[0]]);
    expect(host.getFirstChild(view)).toBe(nodes[2]);
    expect(host.getNextSibling(nodes[2]!)).toBe(nodes[0]);
    expect(host.getParentNode(nodes[1]!)).toBeUndefined();
    dispose();
  });

  it("coalesces mutations and skips a queued flush after an explicit commit", () => {
    const fake = createFakePapi();
    const scheduled: (() => void)[] = [];
    const host = createGlobalLynxHost({
      papi: fake.papi,
      getParentComponentId: () => 1,
      flushScheduler: callback => scheduled.push(callback),
    });
    const view = host.createElement("view");
    host.setProperty(view, "class", "ready", undefined);
    host.insertNode(fake.page, view);
    expect(fake.flushes).toBe(0);
    expect(scheduled).toHaveLength(1);
    host.flush();
    expect(fake.flushes).toBe(1);
    scheduled.shift()!();
    expect(fake.flushes).toBe(1);
    host.setProperty(view, "class", "updated", "ready");
    scheduled.shift()!();
    expect(fake.flushes).toBe(2);
  });

  it("routes compiler helpers to each root during mount and later reactive creation", () => {
    const first = createFakePapi();
    const second = createFakePapi();
    const firstRoot = createLynxRoot({ page: first.page, papi: first.papi, parentComponentId: 11 });
    const secondRoot = createLynxRoot({ page: second.page, papi: second.papi, parentComponentId: 22 });
    const [show, setShow] = createSignal(false);
    firstRoot.render(() => {
      const view = compiledElement("view");
      compiledInsert(view, () => {
        if (!show()) return null;
        const text = compiledElement("text");
        compiledProp(text, "id", "later");
        compiledInsert(text, compiledText("created later"));
        return text;
      });
      return view;
    });
    secondRoot.render(() => {
      const view = compiledElement("view");
      compiledInsert(view, compiledText("second"));
      return view;
    });
    setShow(true);
    const later = first.page.children[0]!.children[0]!;
    expect(later.attributes.id).toBe("later");
    expect(later.children[0]!.text).toBe("created later");
    expect(first.papi.__GetElementUniqueID!(later)).toBeTypeOf("number");
    expect(second.papi.__GetElementUniqueID!(later)).toBeUndefined();
    expect(second.page.children[0]!.children[0]!.text).toBe("second");
    firstRoot.dispose();
    expect(second.page.children).toHaveLength(1);
    secondRoot.dispose();
  });

  it("disposes a root and removes its rendered tree", () => {
    const fake = createFakePapi();
    const root = createLynxRoot({
      page: fake.page,
      papi: fake.papi,
      parentComponentId: 1,
    });

    const dispose = root.render(() => {
      const view = root.renderer.createElement("view");
      const text = root.renderer.createTextNode("hello");
      root.renderer.insert(view, text);
      return view;
    });
    expect(fake.page.children).toHaveLength(1);

    dispose();

    expect(fake.page.children).toHaveLength(0);
  });
});
