import { createRenderEffect, createRoot, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";

import {
  createGlobalLynxHost,
  createLynxRenderer,
  createLynxRoot,
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

  const append = (parent: FakeNode, child: FakeNode, index = parent.children.length) => {
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
      append(parent, child, parent.children.indexOf(anchor));
    },
    __RemoveElement: (parent: FakeNode, child: FakeNode) => {
      parent.children.splice(parent.children.indexOf(child), 1);
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

    renderer.render(() => {
      const view = renderer.createElement("view");
      renderer.insert(view, `Count: ${count()}`);
      return view;
    }, fake.page);

    expect(fake.page.children[0]?.tagName).toBe("view");
    expect(fake.page.children[0]?.children[0]?.text).toBe("Count: 0");

    const text = fake.page.children[0]!.children[0]!;
    const disposeEffect = createRoot(dispose => {
      createRenderEffect(() => host.replaceText(text, `Count: ${count()}`));
      return dispose;
    });

    setCount(3);

    expect(fake.page.children[0]?.children[0]?.text).toBe("Count: 3");
    expect(fake.flushes).toBeGreaterThan(0);
    disposeEffect();
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
