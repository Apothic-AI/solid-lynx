import { For, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";

import {
  createGlobalLynxHost,
  createLynxRef,
  createLynxRenderer,
  createLynxRoot,
  createElement as compiledElement,
  createTextNode as compiledText,
  insert as compiledInsert,
  setProp as compiledProp,
  eventListenerOptions,
  parseEventProp,
  use,
} from "../src/index.js";
import type { LynxNode } from "../src/host.js";
import { isLynxNode, type LynxPapi } from "../src/lynx-host.js";
import type { LynxRefObject } from "../src/refs.js";

interface FakeListener {
  name: string;
  eventType: string;
  listener: (event: unknown) => void;
}

interface ListenerCall {
  op: "add" | "remove";
  name: string;
  eventType: string;
  bindType: number | undefined;
  capture: boolean | undefined;
  closureType: number | undefined;
}

interface FakeNode extends LynxNode {
  kind: "element" | "text";
  tagName: string;
  text: string;
  attributes: Record<string, unknown>;
  children: FakeNode[];
  parent?: FakeNode;
  listeners: FakeListener[];
  /** Last CSS id this node was assigned through `__SetCSSId`. */
  cssId?: number | null;
}

/**
 * Mirrors how Lynx hosts derive the dispatch slot of a listener registration
 * from `bind_type`, `capture`, and `closure_type`, so a host that registers
 * and removes with mismatched options leaves a stale registration behind.
 */
function listenerEventType(options: {
  bind_type?: number;
  capture?: boolean;
  closure_type?: number;
} = {}): string {
  const closureType = typeof options.closure_type === "number" ? options.closure_type : 0;
  const bindType = typeof options.bind_type === "number" ? options.bind_type : 1;
  if (bindType === 5) return "global-bindevent";
  const capture = closureType === 0
    ? options.capture === true
    : bindType === 2 || bindType === 3;
  const isCatch = bindType === 3 || bindType === 4;
  if (capture) return isCatch ? "capture-catch" : "capture-bind";
  return isCatch ? "catchevent" : "bindevent";
}

interface CSSIdCall {
  cssId: number | null;
  entryName: string | undefined;
  elements: FakeNode[];
}

/** The pair the host currently holds for a list, as `__CreateList`/`__UpdateListCallbacks` received it. */
interface FakeListCallbacks {
  componentAtIndex: (
    list: LynxNode,
    listId: number,
    cellIndex: number,
    operationId: number,
    enableReuseNotification: boolean,
  ) => number | undefined;
  enqueueComponent: (list: LynxNode, listId: number, sign: number) => void;
}

interface FakeListCall {
  op: "create" | "update";
  parentComponentUniqueId?: number;
  list?: LynxNode;
  callbacks: FakeListCallbacks;
}

function createFakePapi() {
  let nextId = 1;
  let flushes = 0;
  const listenerCalls: ListenerCall[] = [];
  const cssIdCalls: CSSIdCall[] = [];
  const creates: string[] = [];
  const listCalls: FakeListCall[] = [];
  let listCallbacks: FakeListCallbacks | undefined;
  let listNode: FakeNode | undefined;
  let listId = 1;

  const makeNode = (kind: FakeNode["kind"], tagName: string, text = ""): FakeNode => ({
    kind,
    tagName,
    text,
    attributes: {},
    children: [],
    listeners: [],
  });

  /** Records the tag every create PAPI built, so a test can prove a row was reused. */
  const created = (tagName: string) => {
    creates.push(tagName);
    return register(makeNode("element", tagName));
  };

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

  const detach = (parent: FakeNode, child: FakeNode) => {
    const index = parent.children.indexOf(child);
    if (index < 0) throw new Error("Cannot remove a node from the wrong parent");
    parent.children.splice(index, 1);
    child.parent = undefined;
  };

  const page = makeNode("element", "page");
  const ids = new WeakMap<object, number>([[page, nextId++]]);

  const register = (node: FakeNode) => {
    ids.set(node, nextId++);
    return node;
  };

  const papi: LynxPapi = {
    __CreatePage: () => page,
    __CreateElement: (tag: string) => created(tag),
    __CreateView: () => created("view"),
    __CreateText: () => created("text"),
    __CreateImage: () => created("image"),
    __CreateScrollView: () => created("scroll-view"),
    __CreateWrapperElement: () => created("wrapper"),
    // Mirrors the host contract: the row callbacks arrive with the creation
    // call, and `__UpdateListCallbacks` replaces the pair the host holds.
    __CreateList: (
      parentComponentUniqueId: number,
      componentAtIndex: FakeListCallbacks["componentAtIndex"],
      enqueueComponent: FakeListCallbacks["enqueueComponent"],
    ) => {
      listNode = created("list");
      const callbacks = { componentAtIndex, enqueueComponent };
      listCallbacks = callbacks;
      listCalls.push({ op: "create", parentComponentUniqueId, list: listNode, callbacks });
      return listNode;
    },
    __UpdateListCallbacks: (
      element: LynxNode,
      componentAtIndex: FakeListCallbacks["componentAtIndex"],
      enqueueComponent: FakeListCallbacks["enqueueComponent"],
    ) => {
      const callbacks = { componentAtIndex, enqueueComponent };
      listCallbacks = callbacks;
      listCalls.push({ op: "update", list: element as FakeNode, callbacks });
    },
    __CreateRawText: (text: string) => register(makeNode("text", "raw-text", text)),
    __GetElementUniqueID: (node: FakeNode) => ids.get(node)!,
    __AppendElement: (parent: FakeNode, child: FakeNode) => append(parent, child),
    __InsertElementBefore: (parent: FakeNode, child: FakeNode, anchor: FakeNode) => {
      append(parent, child, anchor);
    },
    __RemoveElement: (parent: FakeNode, child: FakeNode) => detach(parent, child),
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
    // Mirrors the real contract: the elements arrive as one array, and `null`
    // is forwarded rather than resolved here, so a test can assert what the
    // renderer actually sent.
    __SetCSSId: (elements: LynxNode[], cssId: number | null, entryName?: string) => {
      const nodes = elements as FakeNode[];
      cssIdCalls.push({ cssId, entryName, elements: [...nodes] });
      for (const element of nodes) element.cssId = cssId;
    },
    __AddDataset: (node: FakeNode, key: string, value: unknown) => {
      if (value) node.attributes[`data-${key}`] = value;
      else delete node.attributes[`data-${key}`];
    },
    __AddEventListener: (
      node: FakeNode,
      eventName: string,
      listener: (event: unknown) => void,
      options?: { bind_type?: number; capture?: boolean; closure_type?: number },
    ) => {
      const eventType = listenerEventType(options);
      listenerCalls.push({
        op: "add",
        name: eventName,
        eventType,
        bindType: options?.bind_type,
        capture: options?.capture,
        closureType: options?.closure_type,
      });
      node.listeners.push({ name: eventName, eventType, listener });
    },
    __RemoveEventListener: (
      node: FakeNode,
      eventName: string,
      listener: (event: unknown) => void,
      options?: { bind_type?: number; capture?: boolean; closure_type?: number },
    ) => {
      const eventType = listenerEventType(options);
      listenerCalls.push({
        op: "remove",
        name: eventName,
        eventType,
        bindType: options?.bind_type,
        capture: options?.capture,
        closureType: options?.closure_type,
      });
      const index = node.listeners.findIndex(entry =>
        entry.name === eventName
        && entry.eventType === eventType
        && entry.listener === listener
      );
      if (index >= 0) node.listeners.splice(index, 1);
    },
    __FlushElementTree: () => {
      flushes += 1;
    },
  };

  const fire = (node: LynxNode, name: string, eventType = "bindevent") => {
    let calls = 0;
    for (const entry of [...(node as FakeNode).listeners]) {
      if (entry.name !== name || entry.eventType !== eventType) continue;
      calls += 1;
      entry.listener({ type: name });
    }
    return calls;
  };

  const collect = (node: FakeNode, found: FakeNode[] = []): FakeNode[] => {
    for (const child of node.children) {
      found.push(child);
      collect(child, found);
    }
    return found;
  };

  /**
   * Dispatches one event the way a Lynx host does: the capture pass walks the
   * ancestor path from the root down, a `catch` binding stops the walk, the
   * bubble pass walks it back up, and the global-bind pass runs the page-wide
   * handlers last. Ordering the callbacks this way is what makes the recorded
   * `bind_type`, `capture`, and `closure_type` options observable: a binding
   * filed in the wrong slot lands in the wrong pass.
   */
  const dispatch = (target: LynxNode, name: string): void => {
    const path: FakeNode[] = [];
    for (let node: FakeNode | undefined = target as FakeNode; node && node !== page; node = node.parent) {
      path.unshift(node);
    }
    const runPass = (
      nodes: FakeNode[],
      eventTypes: string[],
    ): boolean => {
      for (const node of nodes) {
        for (const entry of [...node.listeners]) {
          if (entry.name !== name || !eventTypes.includes(entry.eventType)) continue;
          entry.listener({ type: name, target: node });
          if (entry.eventType.includes("catch")) return true;
        }
      }
      return false;
    };

    if (!runPass(path, ["capture-catch", "capture-bind"])) {
      runPass([...path].reverse(), ["catchevent", "bindevent"]);
    }
    runPass([page, ...collect(page)], ["global-bindevent"]);
  };

  /** Every listener the host still holds in the tree, in tree order. */
  const liveRegistrations = (): string[] =>
    [page, ...collect(page)].flatMap(node =>
      node.listeners.map(({ name, eventType }) => `${eventType}:${name}`));

  return {
    page,
    papi,
    listenerCalls,
    cssIdCalls,
    listCalls,
    creates,
    /** The callbacks the host currently holds for the list. */
    installedListCallbacks: () => listCallbacks,
    /** The list element the host created, if any. */
    listNode: () => listNode,
    /** A fresh list id, the way a host hands one out per list. */
    nextListId: () => listId++,
    /** Asks for the row at `cellIndex` the way a host drives `componentAtIndex`. */
    requestCell(
      cellIndex: number,
      options: { listId?: number; operationId?: number; enableReuseNotification?: boolean } = {},
    ): { children: number; sign: number | undefined } {
      if (!listNode || !listCallbacks) throw new Error("No list was created");
      const sign = listCallbacks.componentAtIndex(
        listNode,
        options.listId ?? listId,
        cellIndex,
        options.operationId ?? 1,
        options.enableReuseNotification ?? false,
      );
      return { children: listNode.children.length, sign };
    },
    /** Removes a row the way a host does: name the element, then drop the node. */
    removeCell(position: number): { sign: number; children: number } {
      if (!listNode || !listCallbacks) throw new Error("No list was created");
      const removed = listNode.children[position];
      if (!removed) throw new Error("No row at that position");
      const sign = ids.get(removed)!;
      listCallbacks.enqueueComponent(listNode, listId, sign);
      // The host drops the node itself; removing it a second time here is the
      // failure this fake exists to make visible.
      detach(listNode, removed);
      return { sign, children: listNode.children.length };
    },
    fire,
    dispatch,
    liveRegistrations,
    registrations: (node: LynxNode) =>
      (node as FakeNode).listeners.map(({ name, eventType }) => `${eventType}:${name}`),
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

  it("accepts native element handles whose typeof is not object", () => {
    // A native PrimJS host returns opaque element handles with `typeof
    // "unknown"`, so the host must not validate a created element with a
    // `typeof element === "object"` check. A function is the closest
    // standard-JS stand-in for a non-`object` handle.
    const fake = createFakePapi();
    const handle = () => "view";
    const host = createGlobalLynxHost({
      papi: { ...fake.papi, __CreateView: () => handle },
      getParentComponentId: () => 1,
    });

    expect(host.createElement("view")).toBe(handle);
  });

  it("reports a creator that returned nothing as a failed creation", () => {
    const fake = createFakePapi();
    const host = createGlobalLynxHost({
      papi: { ...fake.papi, __CreateView: () => null },
      getParentComponentId: () => 1,
    });

    expect(() => host.createElement("view")).toThrow(/failed to create <view>/);
  });

  it("classifies element handles without assuming a DOM object", () => {
    expect(isLynxNode({})).toBe(true);
    expect(isLynxNode(() => undefined)).toBe(true);
    expect(isLynxNode(null)).toBe(false);
    expect(isLynxNode(undefined)).toBe(false);
    expect(isLynxNode("view")).toBe(false);
    expect(isLynxNode(1)).toBe(false);
    expect(isLynxNode(false)).toBe(false);
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
    const [listener] = view.listeners;
    expect(listener?.name).toBe("tap");
    listener?.listener(event);
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

  it("registers every binding form in its own dispatch slot", () => {
    const fake = createFakePapi();
    const root = createLynxRoot({
      page: fake.page,
      papi: fake.papi,
      parentComponentId: 1,
      transformEventNames: true,
    });
    const calls: string[] = [];

    root.render(() => {
      const view = root.renderer.createElement("view");
      const record = (label: string) => () => calls.push(label);
      root.renderer.setProp(view, "bindtap", record("bindtap"));
      root.renderer.setProp(view, "catchtap", record("catchtap"));
      root.renderer.setProp(view, "capture-bind:tap", record("capture-bind"));
      root.renderer.setProp(view, "capture-catchtap", record("capture-catch"));
      root.renderer.setProp(view, "global-bind:tap", record("global-bind"));
      root.renderer.setProp(view, "main-thread:bindtap", record("main-thread"));
      return view;
    });

    const view = fake.page.children[0]!;
    expect(fake.registrations(view)).toEqual([
      "bindevent:tap",
      "catchevent:tap",
      "capture-bind:tap",
      "capture-catch:tap",
      "global-bindevent:tap",
      "bindevent:tap",
    ]);
    expect(fake.listenerCalls).toEqual([
      { op: "add", name: "tap", eventType: "bindevent", bindType: 1, capture: undefined, closureType: undefined },
      { op: "add", name: "tap", eventType: "catchevent", bindType: 4, capture: undefined, closureType: undefined },
      {
        op: "add",
        name: "tap",
        eventType: "capture-bind",
        bindType: 2,
        capture: true,
        closureType: undefined,
      },
      {
        op: "add",
        name: "tap",
        eventType: "capture-catch",
        bindType: 3,
        capture: true,
        closureType: undefined,
      },
      {
        op: "add",
        name: "tap",
        eventType: "global-bindevent",
        bindType: 5,
        capture: undefined,
        closureType: undefined,
      },
      {
        op: "add",
        name: "tap",
        eventType: "bindevent",
        bindType: 1,
        capture: undefined,
        closureType: 2,
      },
    ]);
    expect(eventListenerOptions("capture-bind")).toEqual({ bind_type: 2, capture: true });
    expect(eventListenerOptions("global-bindEvent")).toEqual({ bind_type: 5 });
    expect(eventListenerOptions("bindEvent", "main-thread")).toEqual({
      bind_type: 1,
      closure_type: 2,
    });
    expect(calls).toEqual([]);
  });

  it("removes bindings with the options they were registered with", () => {
    const fake = createFakePapi();
    const host = createGlobalLynxHost({
      papi: fake.papi,
      getParentComponentId: () => 1,
      flushScheduler: callback => callback(),
    });
    const renderer = createLynxRenderer(host);
    const parent = renderer.createElement("view");
    host.insertNode(fake.page, parent);
    const child = renderer.createElement("view");
    host.insertNode(parent, child);

    const handler = () => undefined;
    renderer.setProp(child, "bindtap", handler);
    renderer.setProp(child, "capture-bindtap", handler);
    renderer.setProp(child, "global-bindtap", handler);
    renderer.setProp(child, "main-thread:catchtap", handler);
    expect(fake.registrations(child)).toHaveLength(4);

    const added = fake.listenerCalls.filter(call => call.op === "add");
    renderer.setProp(child, "bindtap", undefined);
    renderer.setProp(child, "capture-bindtap", undefined);
    renderer.setProp(child, "global-bindtap", undefined);
    renderer.setProp(child, "main-thread:catchtap", undefined);

    expect(fake.registrations(child)).toEqual([]);
    expect(fake.listenerCalls.filter(call => call.op === "remove")).toEqual(
      added.map(call => ({ ...call, op: "remove" })),
    );
  });

  it("maps ordinary attributes, styles, datasets, and boolean properties", () => {
    const fake = createFakePapi();
    const host = createGlobalLynxHost({
      papi: fake.papi,
      getParentComponentId: () => 1,
      flushScheduler: callback => callback(),
    });
    const view = host.createElement("view");
    host.insertNode(fake.page, view);

    host.setProperty(view, "id", "panel");
    host.setProperty(view, "aria-label", "Panel");
    host.setProperty(view, "data-role", "main");
    host.setProperty(view, "style", { color: "red" });
    host.setProperty(view, "disabled", true);

    expect(view.attributes).toMatchObject({
      id: "panel",
      "aria-label": "Panel",
      "data-role": "main",
      style: { color: "red" },
      disabled: "disabled",
    });

    host.setProperty(view, "disabled", false);
    host.setProperty(view, "data-role", null);
    host.setProperty(view, "aria-label", undefined);

    expect(view.attributes).toMatchObject({ id: "panel", style: { color: "red" } });
    expect(view.attributes).not.toHaveProperty("disabled");
    expect(view.attributes).not.toHaveProperty("data-role");
    expect(view.attributes).not.toHaveProperty("aria-label");

    host.setProperty(view, "style", "color: blue");
    host.setProperty(view, "class", "ready");
    host.setProperty(view, "disabled", "disabled");
    expect(view.attributes).toMatchObject({
      style: "color: blue",
      class: "ready",
      disabled: "disabled",
    });
  });

  it("flushes once per burst of mutations and after disposal", () => {
    const fake = createFakePapi();
    const scheduled: (() => void)[] = [];
    const host = createGlobalLynxHost({
      papi: fake.papi,
      getParentComponentId: () => 1,
      flushScheduler: callback => scheduled.push(callback),
    });
    const view = host.createElement("view");
    host.insertNode(fake.page, view);

    for (let index = 0; index < 5; index += 1) {
      host.setProperty(view, "aria-label", `burst ${index}`);
      host.insertNode(view, host.createElement("view"));
    }
    expect(scheduled).toHaveLength(1);
    expect(fake.flushes).toBe(0);

    host.flush();
    expect(fake.flushes).toBe(1);
    scheduled.shift()!();
    expect(fake.flushes).toBe(1);
  });

  it("replaces a binding handler without registering a second listener", () => {
    const fake = createFakePapi();
    const root = createLynxRoot({
      page: fake.page,
      papi: fake.papi,
      parentComponentId: 1,
      transformEventNames: true,
    });
    const calls: string[] = [];

    root.render(() => {
      const view = root.renderer.createElement("view");
      root.renderer.setProp(view, "bindtap", () => calls.push("first"));
      return view;
    });

    const view = fake.page.children[0]!;
    expect(fake.fire(view, "tap")).toBe(1);

    root.renderer.setProp(view, "bindtap", () => calls.push("second"));

    expect(fake.listenerCalls.filter(call => call.op === "add")).toHaveLength(1);
    expect(fake.registrations(view)).toEqual(["bindevent:tap"]);
    expect(fake.fire(view, "tap")).toBe(1);
    expect(calls).toEqual(["first", "second"]);

    root.renderer.setProp(view, "bindtap", undefined);
    expect(fake.registrations(view)).toEqual([]);
    expect(fake.fire(view, "tap")).toBe(0);
    expect(calls).toEqual(["first", "second"]);
  });

  it("detaches subtree listeners on removal and restores them on reinsertion", () => {
    const fake = createFakePapi();
    const host = createGlobalLynxHost({
      papi: fake.papi,
      getParentComponentId: () => 1,
      flushScheduler: callback => callback(),
    });
    const renderer = createLynxRenderer(host);
    const parent = renderer.createElement("view");
    const child = renderer.createElement("view");
    renderer.setProp(parent, "bindtap", () => undefined);
    renderer.setProp(child, "capture-bindtap", () => undefined);
    host.insertNode(fake.page, parent);
    host.insertNode(parent, child);
    expect(fake.registrations(parent)).toEqual(["bindevent:tap"]);
    expect(fake.registrations(child)).toEqual(["capture-bind:tap"]);

    host.removeNode(fake.page, parent);

    expect(fake.registrations(parent)).toEqual([]);
    expect(fake.registrations(child)).toEqual([]);
    expect(fake.fire(parent, "tap")).toBe(0);
    expect(fake.fire(child, "tap", "capture-bind")).toBe(0);

    host.insertNode(fake.page, parent);

    expect(fake.registrations(parent)).toEqual(["bindevent:tap"]);
    expect(fake.registrations(child)).toEqual(["capture-bind:tap"]);
    expect(fake.fire(parent, "tap")).toBe(1);
    expect(fake.fire(child, "tap", "capture-bind")).toBe(1);
  });

  it("releases every listener when a root is disposed", () => {
    const fake = createFakePapi();
    const root = createLynxRoot({
      page: fake.page,
      papi: fake.papi,
      parentComponentId: 1,
      transformEventNames: true,
    });

    root.render(() => {
      const view = root.renderer.createElement("view");
      const child = root.renderer.createElement("view");
      root.renderer.setProp(view, "bindtap", () => undefined);
      root.renderer.setProp(view, "global-bind:tap", () => undefined);
      root.renderer.setProp(child, "main-thread:bindtap", () => undefined);
      root.renderer.insert(view, child);
      return view;
    });

    const view = fake.page.children[0]!;
    const child = view.children[0]!;
    expect(fake.registrations(view)).toHaveLength(2);
    expect(fake.registrations(child)).toHaveLength(1);

    root.dispose();

    expect(fake.page.children).toHaveLength(0);
    expect(fake.registrations(view)).toEqual([]);
    expect(fake.registrations(child)).toEqual([]);
    expect(fake.listenerCalls.filter(call => call.op === "remove")).toHaveLength(3);
  });

  it("remounts a disposed root into the same page", () => {
    const fake = createFakePapi();
    const root = createLynxRoot({
      page: fake.page,
      papi: fake.papi,
      parentComponentId: 1,
      transformEventNames: true,
    });
    const [count, setCount] = createSignal(0);
    const calls: string[] = [];
    const renderApp = () => {
      const view = root.renderer.createElement("view");
      root.renderer.setProp(view, "bindtap", () => calls.push(`tap ${count()}`));
      root.renderer.insert(view, () => `Count: ${count()}`);
      return view;
    };

    root.render(renderApp);
    const first = fake.page.children[0]!;
    expect(fake.fire(first, "tap")).toBe(1);

    root.dispose();
    expect(fake.page.children).toHaveLength(0);

    root.render(renderApp);
    const second = fake.page.children[0]!;
    expect(second).not.toBe(first);
    expect(fake.registrations(second)).toEqual(["bindevent:tap"]);
    expect(fake.fire(second, "tap")).toBe(1);
    setCount(2);
    expect(fake.fire(second, "tap")).toBe(1);
    expect(calls).toEqual(["tap 0", "tap 0", "tap 2"]);
  });

  it("routes dispatch, propagation, and capture passes through the recorded slots", () => {
    const fake = createFakePapi();
    const root = createLynxRoot({
      page: fake.page,
      papi: fake.papi,
      parentComponentId: 1,
      transformEventNames: true,
    });
    const calls: string[] = [];

    root.render(() => {
      const outer = root.renderer.createElement("view");
      const parent = root.renderer.createElement("view");
      const child = root.renderer.createElement("view");
      root.renderer.setProp(outer, "global-bind:tap", () => calls.push("global"));
      root.renderer.setProp(parent, "bindtap", () => calls.push("bubble-parent"));
      root.renderer.setProp(child, "bindtap", () => calls.push("bubble-child"));
      root.renderer.insert(outer, parent);
      root.renderer.insert(parent, child);
      return outer;
    });

    const parent = fake.page.children[0]!.children[0]!;
    fake.dispatch(parent.children[0]!, "tap");

    expect(calls).toEqual(["bubble-child", "bubble-parent", "global"]);
  });

  it("stops propagation for catch bindings and capture-catch handlers", () => {
    const fake = createFakePapi();
    const root = createLynxRoot({
      page: fake.page,
      papi: fake.papi,
      parentComponentId: 1,
      transformEventNames: true,
    });
    const calls: string[] = [];

    root.render(() => {
      const outer = root.renderer.createElement("view");
      const parent = root.renderer.createElement("view");
      const child = root.renderer.createElement("view");
      root.renderer.setProp(outer, "capture-catch:tap", () => calls.push("capture-catch-parent"));
      root.renderer.setProp(parent, "bindtap", () => calls.push("bubble-parent"));
      root.renderer.setProp(child, "catchtap", () => calls.push("catch-child"));
      root.renderer.insert(outer, parent);
      root.renderer.insert(parent, child);
      return outer;
    });

    const outer = fake.page.children[0]!;
    const child = outer.children[0]!.children[0]!;
    fake.dispatch(child, "tap");

    expect(calls).toEqual(["capture-catch-parent"]);
    calls.length = 0;

    root.renderer.setProp(outer, "capture-catch:tap", undefined);
    fake.dispatch(child, "tap");

    expect(calls).toEqual(["catch-child"]);
  });

  it("runs capture bindings before the bubble pass on the same event", () => {
    const fake = createFakePapi();
    const root = createLynxRoot({
      page: fake.page,
      papi: fake.papi,
      parentComponentId: 1,
      transformEventNames: true,
    });
    const calls: string[] = [];

    root.render(() => {
      const parent = root.renderer.createElement("view");
      const child = root.renderer.createElement("view");
      root.renderer.setProp(parent, "capture-bind:tap", () => calls.push("capture-parent"));
      root.renderer.setProp(parent, "main-thread:bindtap", () => calls.push("namespace-parent"));
      root.renderer.setProp(child, "bindtap", () => calls.push("bubble-child"));
      root.renderer.insert(parent, child);
      return parent;
    });

    const parent = fake.page.children[0]!;
    fake.dispatch(parent.children[0]!, "tap");

    expect(calls).toEqual(["capture-parent", "bubble-child", "namespace-parent"]);
  });

  it("releases every listener a root registered when it is disposed", () => {
    const fake = createFakePapi();
    const root = createLynxRoot({
      page: fake.page,
      papi: fake.papi,
      parentComponentId: 1,
      transformEventNames: true,
    });

    root.render(() => {
      const parent = root.renderer.createElement("view");
      const child = root.renderer.createElement("view");
      root.renderer.setProp(parent, "bindtap", () => undefined);
      root.renderer.setProp(parent, "catchtap", () => undefined);
      root.renderer.setProp(parent, "capture-bind:tap", () => undefined);
      root.renderer.setProp(parent, "global-bind:tap", () => undefined);
      root.renderer.setProp(child, "main-thread:bindtap", () => undefined);
      root.renderer.setProp(child, "capture-catchtap", () => undefined);
      root.renderer.insert(parent, child);
      return parent;
    });

    expect(fake.liveRegistrations()).toHaveLength(6);

    root.dispose();

    expect(fake.liveRegistrations()).toEqual([]);
    // Every registration must be released in the slot it was filed in, so the
    // removals pair with the additions whatever order disposal walks in.
    const slots = (op: ListenerCall["op"]) =>
      fake.listenerCalls
        .filter(call => call.op === op)
        .map(call =>
          [call.name, call.eventType, call.bindType, call.capture, call.closureType].join("|"))
        .sort();
    expect(slots("remove")).toEqual(slots("add"));
  });

  it("keeps roots that share a page independent through render and disposal", () => {
    const fake = createFakePapi();
    const first = createLynxRoot({ page: fake.page, papi: fake.papi, parentComponentId: 11 });
    const second = createLynxRoot({ page: fake.page, papi: fake.papi, parentComponentId: 22 });
    const [firstCount, setFirstCount] = createSignal(0);
    const [secondCount, setSecondCount] = createSignal(0);
    const taps: string[] = [];
    const renderFirst = () => {
      const view = first.renderer.createElement("view");
      first.renderer.setProp(view, "id", "first-root");
      first.renderer.setProp(view, "bindtap", () => taps.push(`first ${firstCount()}`));
      first.renderer.insert(view, () => `first ${firstCount()}`);
      return view;
    };
    const renderSecond = () => {
      const view = second.renderer.createElement("view");
      second.renderer.setProp(view, "id", "second-root");
      second.renderer.setProp(view, "bindtap", () => taps.push(`second ${secondCount()}`));
      second.renderer.insert(view, () => `second ${secondCount()}`);
      return view;
    };

    first.render(renderFirst);
    second.render(renderSecond);

    const firstView = fake.page.children[0]!;
    const secondView = fake.page.children[1]!;
    expect(firstView.attributes.id).toBe("first-root");
    expect(secondView.attributes.id).toBe("second-root");

    setFirstCount(1);
    expect(firstView.children[0]!.text).toBe("first 1");
    expect(secondView.children[0]!.text).toBe("second 0");

    fake.dispatch(firstView, "tap");
    fake.dispatch(secondView, "tap");
    expect(taps).toEqual(["first 1", "second 0"]);

    first.dispose();

    expect(fake.page.children).toEqual([secondView]);
    expect(fake.registrations(firstView)).toEqual([]);
    expect(fake.registrations(secondView)).toEqual(["bindevent:tap"]);
    setSecondCount(2);
    expect(secondView.children[0]!.text).toBe("second 2");

    first.render(renderFirst);

    expect(fake.page.children).toHaveLength(2);
    expect(fake.page.children[0]).toBe(secondView);
    const remounted = fake.page.children[1]!;
    expect(remounted).not.toBe(firstView);
    expect(fake.registrations(remounted)).toEqual(["bindevent:tap"]);
    fake.dispatch(remounted, "tap");
    expect(taps).toEqual(["first 1", "second 0", "first 1"]);

    first.dispose();
    second.dispose();
    expect(fake.page.children).toEqual([]);
  });
});

/**
 * `ref` and `use:` are transformed by the Solid JSX compile step into calls to
 * `use(fn, element, arg)`, so these tests drive `use` directly to cover what the
 * renderer owes those forms: the element is handed over, and whatever the
 * binding returns is released against the owning scope.
 */
describe("refs and imperative access", () => {
  it("hands a callback ref the live PAPI node and releases it on disposal", () => {
    const fake = createFakePapi();
    const root = createLynxRoot({ page: fake.page, papi: fake.papi, parentComponentId: 1 });
    const log: string[] = [];
    let handed: LynxNode | undefined;

    const dispose = root.render(() => {
      const view = root.renderer.createElement("view");
      root.renderer.setProp(view, "id", "target");
      use((element: LynxNode) => {
        handed = element;
        log.push("attach");
        return () => log.push("detach");
      }, view);
      return view;
    });

    // The ref receives the same handle the host put in the tree, not a copy or
    // a browser DOM node.
    expect(handed).toBe(fake.page.children[0]);
    expect(log).toEqual(["attach"]);

    dispose();

    expect(log).toEqual(["attach", "detach"]);
  });

  it("gives a ref object the node and clears it when its scope is disposed", () => {
    const fake = createFakePapi();
    const root = createLynxRoot({ page: fake.page, papi: fake.papi, parentComponentId: 1 });
    const ref = createLynxRef<LynxNode>();
    expect(ref.current).toBeUndefined();

    const dispose = root.render(() => {
      const view = root.renderer.createElement("view");
      use(ref, view);
      return view;
    });

    expect(ref.current).toBe(fake.page.children[0]);

    dispose();

    // A disposed element must not stay reachable through the ref.
    expect(ref.current).toBeUndefined();
  });

  it("releases a ref when the reactive scope that created the element is disposed", () => {
    const fake = createFakePapi();
    const root = createLynxRoot({ page: fake.page, papi: fake.papi, parentComponentId: 1 });
    const [present, setPresent] = createSignal(true);
    const ref = createLynxRef<LynxNode>();

    const dispose = root.render(() => {
      const view = root.renderer.createElement("view");
      root.renderer.insert(view, () => {
        if (!present()) return null;
        const child = root.renderer.createElement("text");
        use(ref, child);
        return child;
      });
      return view;
    });

    const first = ref.current;
    expect(first).toBe(fake.page.children[0]!.children[0]);

    setPresent(false);
    expect(ref.current).toBeUndefined();
    expect(fake.page.children[0]!.children).toHaveLength(0);

    setPresent(true);
    // Re-creating the element re-attaches, and it is a different node.
    expect(ref.current).toBe(fake.page.children[0]!.children[0]);
    expect(ref.current).not.toBe(first);

    dispose();
    expect(ref.current).toBeUndefined();
  });

  it("releases every ref it attached when the root is disposed", () => {
    const fake = createFakePapi();
    const root = createLynxRoot({ page: fake.page, papi: fake.papi, parentComponentId: 1 });
    const log: string[] = [];

    const dispose = root.render(() => {
      const view = root.renderer.createElement("view");
      root.renderer.setProp(view, "id", "outer");
      use((element: LynxNode) => {
        log.push(`attach:${(element as unknown as FakeNode).attributes.id}`);
        return () => log.push(`detach:${(element as unknown as FakeNode).attributes.id}`);
      }, view);
      const inner = root.renderer.createElement("view");
      root.renderer.setProp(inner, "id", "inner");
      use((element: LynxNode) => {
        log.push(`attach:${(element as unknown as FakeNode).attributes.id}`);
        return () => log.push(`detach:${(element as unknown as FakeNode).attributes.id}`);
      }, inner);
      root.renderer.insert(view, inner);
      return view;
    });

    expect(log).toEqual(["attach:outer", "attach:inner"]);

    dispose();

    expect(log).toEqual([
      "attach:outer",
      "attach:inner",
      "detach:inner",
      "detach:outer",
    ]);
  });

  it("does not let an older attachment's teardown clear a newer one", () => {
    const ref = createLynxRef<LynxNode>();
    const first = { id: "first" } as unknown as LynxNode;
    const second = { id: "second" } as unknown as LynxNode;

    const releaseFirst = ref(first);
    ref(second);
    releaseFirst();

    // A ref is shared, so the older attachment's teardown must only release the
    // element it actually attached.
    expect(ref.current).toBe(second);

    ref(second)();
    expect(ref.current).toBeUndefined();
  });

  it("keeps a ref attached when a keyed list reorders", () => {
    const fake = createFakePapi();
    const root = createLynxRoot({ page: fake.page, papi: fake.papi, parentComponentId: 1 });
    // `For` keys on item identity, so the reordered signal has to carry the same
    // objects; replacing them would be a genuinely new list.
    const alpha = { id: "a" };
    const bravo = { id: "b" };
    const charlie = { id: "c" };
    const [items, setItems] = createSignal([alpha, bravo, charlie]);
    const refs = new Map<string, LynxRefObject<LynxNode>>();

    const dispose = root.render(() => {
      const list = root.renderer.createElement("view");
      root.renderer.insert(list, () => root.renderer.createComponent(
        For as never,
        // `each` is a getter so `For` subscribes to the signal itself. Reading it
        // here instead would make this accessor re-run on every update, which
        // recreates the component and is not the keyed path being tested.
        {
          get each() {
            return items();
          },
          children: (item: { id: string }) => {
            const row = root.renderer.createElement("view");
            root.renderer.setProp(row, "id", item.id);
            const ref = createLynxRef<LynxNode>();
            refs.set(item.id, ref);
            use(ref, row);
            return row;
          },
        } as never,
      ));
      return list;
    });

    const rowsBefore = [...fake.page.children[0]!.children];
    expect(refs.get("a")!.current).toBe(rowsBefore[0]);
    expect(refs.get("c")!.current).toBe(rowsBefore[2]);

    setItems([charlie, alpha, bravo]);

    const rowsAfter = fake.page.children[0]!.children;
    expect(rowsAfter.map(row => row.attributes.id)).toEqual(["c", "a", "b"]);
    // Reconciliation moves the rows instead of recreating them, so the owning
    // scopes stay alive and no ref is released and re-attached.
    expect(rowsAfter[0]).toBe(rowsBefore[2]);
    expect(rowsAfter[1]).toBe(rowsBefore[0]);
    expect(rowsAfter[2]).toBe(rowsBefore[1]);
    expect(refs.get("c")!.current).toBe(rowsBefore[2]);
    expect(refs.get("a")!.current).toBe(rowsBefore[0]);

    dispose();

    for (const ref of refs.values()) expect(ref.current).toBeUndefined();
  });

  it("ignores a ref binding that returns something other than a teardown", () => {
    const fake = createFakePapi();
    const root = createLynxRoot({ page: fake.page, papi: fake.papi, parentComponentId: 1 });

    const dispose = root.render(() => {
      const view = root.renderer.createElement("view");
      expect(use((element: LynxNode) => element, view)).toBe(view);
      return view;
    });

    expect(() => dispose()).not.toThrow();
  });

  it("runs a ref binding outside an owner without registering a teardown", () => {
    const node = { kind: "element" } as unknown as LynxNode;
    const seen: unknown[] = [];

    const teardown = use((element: LynxNode) => {
      seen.push(element);
      return () => seen.push("teardown");
    }, node);

    expect(seen).toEqual([node]);
    // With no owner there is nothing to register against, so the caller keeps
    // ownership of the teardown instead of it being dropped or warned about.
    expect(teardown).toBeTypeOf("function");
    teardown();
    expect(seen).toEqual([node, "teardown"]);
  });
});

describe("root-scoped CSS ids", () => {
  it("assigns a CSS id to every page-level element in one batched call", () => {
    const fake = createFakePapi();
    const root = createLynxRoot({ page: fake.page, papi: fake.papi, parentComponentId: 1 });

    root.render(() => {
      const view = root.renderer.createElement("view");
      root.renderer.setProp(view, "id", "rendered");
      const sibling = root.renderer.createElement("view");
      root.renderer.setProp(sibling, "id", "sibling");
      root.renderer.insertNode(fake.page, sibling);
      return view;
    });

    const [sibling, view] = fake.page.children;
    const before = fake.flushes;

    root.setCSSId(3, "index");

    // One call carrying the whole root: the PAPI takes the elements as an array.
    expect(fake.cssIdCalls).toEqual([
      { cssId: 3, entryName: "index", elements: [sibling!, view!] },
    ]);
    expect(view!.cssId).toBe(3);
    expect(sibling!.cssId).toBe(3);
    expect(fake.flushes).toBeGreaterThan(before);
  });

  it("applies the assigned CSS id to page-level elements added later", () => {
    const fake = createFakePapi();
    const root = createLynxRoot({ page: fake.page, papi: fake.papi, parentComponentId: 1 });
    root.setCSSId(7, "detail");

    expect(fake.cssIdCalls).toEqual([]);

    root.render(() => {
      const view = root.renderer.createElement("view");
      root.renderer.setProp(view, "id", "later");
      return view;
    });

    const view = fake.page.children[0]!;
    expect(view.attributes.id).toBe("later");
    expect(fake.cssIdCalls).toEqual([
      { cssId: 7, entryName: "detail", elements: [view] },
    ]);
  });

  it("does not reach into elements the root did not put in its page", () => {
    const fake = createFakePapi();
    const root = createLynxRoot({ page: fake.page, papi: fake.papi, parentComponentId: 1 });

    root.render(() => {
      const view = root.renderer.createElement("view");
      const nested = root.renderer.createElement("view");
      root.renderer.setProp(nested, "id", "nested");
      // A descendant, so the id reaches the root of the subtree only and the
      // stylesheet then applies to the subtree through the element tree.
      root.renderer.insert(view, nested);
      return view;
    });

    const view = fake.page.children[0]!;
    const nested = view.children[0]!;

    root.setCSSId(2);

    expect(fake.cssIdCalls).toEqual([
      { cssId: 2, entryName: undefined, elements: [view] },
    ]);
    expect(view.cssId).toBe(2);
    expect(nested.cssId).toBeUndefined();
  });

  it("replaces a previously assigned CSS id", () => {
    const fake = createFakePapi();
    const root = createLynxRoot({ page: fake.page, papi: fake.papi, parentComponentId: 1 });
    root.render(() => root.renderer.createElement("view"));
    const view = fake.page.children[0]!;

    root.setCSSId(1);
    root.setCSSId(4, "other");

    expect(fake.cssIdCalls.map(call => call.cssId)).toEqual([1, 4]);
    expect(view.cssId).toBe(4);
  });

  it("forwards null so the host can apply its own default", () => {
    const fake = createFakePapi();
    const root = createLynxRoot({ page: fake.page, papi: fake.papi, parentComponentId: 1 });
    root.render(() => root.renderer.createElement("view"));

    root.setCSSId(null);

    // Resolution of `null` belongs to the host, so the renderer sends it through
    // rather than picking a replacement id.
    expect(fake.cssIdCalls).toEqual([
      { cssId: null, entryName: undefined, elements: [fake.page.children[0]!] },
    ]);
  });

  it("rejects an invalid CSS id and leaves the root unchanged", () => {
    const fake = createFakePapi();
    const root = createLynxRoot({ page: fake.page, papi: fake.papi, parentComponentId: 1 });

    for (const invalid of [1.5, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => root.setCSSId(invalid)).toThrow(TypeError);
    }

    expect(fake.cssIdCalls).toEqual([]);

    // The rejected call must not have been recorded, so a later element does not
    // silently pick up an id that was never accepted.
    root.render(() => root.renderer.createElement("view"));

    expect(fake.page.children[0]!.cssId).toBeUndefined();
    expect(fake.cssIdCalls).toEqual([]);
  });

  it("reports a host without the CSS-id PAPI instead of styling nothing", () => {
    const fake = createFakePapi();
    const papiWithoutCSSId: LynxPapi = { ...fake.papi, __SetCSSId: undefined };
    const root = createLynxRoot({
      page: fake.page,
      papi: papiWithoutCSSId,
      parentComponentId: 1,
    });

    // Rendering must still work on such a host; only asking for a CSS id fails.
    root.render(() => {
      const view = root.renderer.createElement("view");
      root.renderer.setProp(view, "id", "still-renders");
      return view;
    });
    expect(fake.page.children[0]!.attributes.id).toBe("still-renders");

    expect(() => root.setCSSId(1)).toThrow(/__SetCSSId/);
    expect(fake.cssIdCalls).toEqual([]);
  });

  it("keeps a root's CSS id off the elements of another root on the same page", () => {
    const fake = createFakePapi();
    const first = createLynxRoot({ page: fake.page, papi: fake.papi, parentComponentId: 11 });
    const second = createLynxRoot({ page: fake.page, papi: fake.papi, parentComponentId: 22 });

    first.render(() => {
      const view = first.renderer.createElement("view");
      first.renderer.setProp(view, "id", "first-root");
      return view;
    });
    second.render(() => {
      const view = second.renderer.createElement("view");
      second.renderer.setProp(view, "id", "second-root");
      return view;
    });

    const [firstView, secondView] = fake.page.children;

    first.setCSSId(5);

    expect(fake.cssIdCalls).toEqual([
      { cssId: 5, entryName: undefined, elements: [firstView!] },
    ]);
    expect(firstView!.cssId).toBe(5);
    // A shared page must not let one root restyle another's elements.
    expect(secondView!.cssId).toBeUndefined();

    first.dispose();
    second.dispose();
  });
});

describe("indexed list model", () => {
  interface Task {
    id: number;
    label: string;
  }

  const tasks: Task[] = [
    { id: 1, label: "first" },
    { id: 2, label: "second" },
    { id: 3, label: "third" },
  ];

  const createRoot = (fake: ReturnType<typeof createFakePapi>) =>
    createLynxRoot({ papi: fake.papi });

  const makeList = (
    fake: ReturnType<typeof createFakePapi>,
    items: () => readonly Task[],
    keyOf: (task: Task) => unknown = task => task.id,
  ) => {
    const root = createRoot(fake);
    const list = root.createList<Task>({
      items,
      getKey: keyOf,
      children: (item, index) => {
        const view = root.renderer.createElement("view");
        root.renderer.insert(view, () => `${item.label}#${index()}`);
        return view;
      },
    });
    return { root, list };
  };

  const rowLabels = (fake: ReturnType<typeof createFakePapi>): string[] => {
    const node = fake.listNode()!;
    return node.children.map(child => child.children[0]?.text ?? child.text);
  };

  it("creates the list through __CreateList with the parent component id and both callbacks", () => {
    const fake = createFakePapi();
    const { root, list } = makeList(fake, () => tasks);

    expect(fake.listCalls).toHaveLength(1);
    const [call] = fake.listCalls;
    expect(call.op).toBe("create");
    expect(call.parentComponentUniqueId).toBe(fake.papi.__GetElementUniqueID!(fake.page));
    expect(typeof call.callbacks.componentAtIndex).toBe("function");
    expect(typeof call.callbacks.enqueueComponent).toBe("function");
    // The list element is owned by the root, so it lands in the root's page.
    expect(fake.page.children).toContain(list.list);
    expect((list.list as FakeNode).tagName).toBe("list");

    root.dispose();
  });

  it("materializes only the row the host asks for, in index order", () => {
    const fake = createFakePapi();
    const { root, list } = makeList(fake, () => tasks);

    expect(fake.requestCell(2).children).toBe(1);
    expect(rowLabels(fake)).toEqual(["third#2"]);

    expect(fake.requestCell(0).children).toBe(2);
    expect(rowLabels(fake)).toEqual(["first#0", "third#2"]);

    expect(fake.requestCell(1).children).toBe(3);
    expect(rowLabels(fake)).toEqual(["first#0", "second#1", "third#2"]);

    root.dispose();
  });

  it("answers componentAtIndex with the unique id of the row it built", () => {
    const fake = createFakePapi();
    const { root, list } = makeList(fake, () => tasks);

    // The host finds the element it should position through this id, so
    // returning it is part of answering the request.
    const { sign } = fake.requestCell(1);
    expect(sign).toBe(
      fake.papi.__GetElementUniqueID!(fake.listNode()!.children[0]!),
    );

    // An index the model does not cover has no row to name.
    expect(fake.requestCell(9).sign).toBeUndefined();
    expect(list.rows).toHaveLength(1);

    root.dispose();
  });

  it("releases the row a host names for removal without removing its node", () => {
    const fake = createFakePapi();
    const { root, list } = makeList(fake, () => tasks);

    fake.requestCell(0);
    fake.requestCell(1);
    expect(list.rows).toHaveLength(2);

    // The host removes the element itself right after calling
    // `enqueueComponent`, so the row's scope is released here and the node is
    // left for the host. Removing it here too would make the host's own
    // removal throw.
    const { sign, children } = fake.removeCell(0);
    expect(sign).toBeTypeOf("number");
    expect(children).toBe(1);
    expect(list.rows.map(row => row.index())).toEqual([1]);
    expect(fake.page.children).toContain(list.list);

    root.dispose();
  });

  it("keeps list children in ascending index order for sparse out-of-order requests", () => {
    const fake = createFakePapi();
    const sparse = Array.from({ length: 6 }, (_, index) => ({
      id: index,
      label: `row-${index}`,
    }));
    const { root, list } = makeList(fake, () => sparse);

    // The positions a host asks for are model indices, not positions among the
    // rows that happen to be materialized, so cell 5 then cell 3 must leave the
    // list ordered 3, 5.
    fake.requestCell(5);
    expect(rowLabels(fake)).toEqual(["row-5#5"]);

    fake.requestCell(3);
    expect(rowLabels(fake)).toEqual(["row-3#3", "row-5#5"]);

    // A request in the middle of the materialized rows lands between them.
    fake.requestCell(4);
    expect(rowLabels(fake)).toEqual(["row-3#3", "row-4#4", "row-5#5"]);

    // Re-requesting an existing row changes nothing.
    fake.requestCell(3);
    expect(rowLabels(fake)).toEqual(["row-3#3", "row-4#4", "row-5#5"]);
    expect(list.rows.map(row => row.index())).toEqual([3, 4, 5]);

    root.dispose();
  });

  it("reconciles surviving rows on update without another host request", () => {
    const fake = createFakePapi();
    let items = [...tasks];
    const { root, list } = makeList(fake, () => items);

    fake.requestCell(0);
    fake.requestCell(1);
    fake.requestCell(2);
    const nodes = [...fake.listNode()!.children];
    const createdAfterFirstPass = fake.creates.length;

    // The host asks for nothing this time: only the model changed.
    items = [tasks[2]!, tasks[0]!, tasks[1]!];
    list.update();

    // Every key survived, so the rows moved rather than rebuilt.
    expect(fake.creates).toHaveLength(createdAfterFirstPass);
    expect(rowLabels(fake)).toEqual(["third#0", "first#1", "second#2"]);
    expect(list.rows.map(row => row.index())).toEqual([0, 1, 2]);
    expect(fake.listNode()!.children).toEqual([nodes[2], nodes[0], nodes[1]]);

    // Shrinking the model releases what left and keeps the rest ordered.
    items = [tasks[1]!, tasks[0]!];
    list.update();
    expect(rowLabels(fake)).toEqual(["second#0", "first#1"]);
    expect(fake.listNode()!.children).toEqual([nodes[1], nodes[0]]);

    root.dispose();
  });

  it("rebuilds a surviving key whose item was replaced", () => {
    const fake = createFakePapi();
    let items = [...tasks];
    const { root, list } = makeList(fake, () => items);

    fake.requestCell(0);
    const original = fake.listNode()!.children[0]!;

    // Same key, new item: the row's content came from the old item, so it is
    // rebuilt under the same key rather than left stale.
    items = [{ id: 1, label: "renamed" }];
    list.update();

    expect(rowLabels(fake)).toEqual(["renamed#0"]);
    expect(list.rows).toHaveLength(1);
    expect(fake.listNode()!.children[0]).not.toBe(original);

    root.dispose();
  });

  it("releases host event registrations when the host removes a row itself", () => {
    const fake = createFakePapi();
    const root = createRoot(fake);
    let taps = 0;
    const list = root.createList<Task>({
      items: () => tasks,
      getKey: task => task.id,
      children: (item, index) => {
        const view = root.renderer.createElement("view");
        root.renderer.setProp(view, "bindtap", () => {
          taps += 1;
        });
        root.renderer.insert(view, () => `${item.label}#${index()}`);
        return view;
      },
    });

    fake.requestCell(0);
    const row = fake.listNode()!.children[0]!;
    expect(fake.registrations(row)).toEqual(["bindevent:tap"]);

    // The host removes the element itself, so this host's `removeNode` never
    // runs. The row's registrations have to be released anyway, or they stay on
    // the orphaned element.
    fake.removeCell(0);

    expect(fake.registrations(row)).toEqual([]);
    expect(fake.listenerCalls).toContainEqual({
      op: "remove",
      name: "tap",
      eventType: "bindevent",
      bindType: 1,
      capture: undefined,
      closureType: undefined,
    });
    expect(list.rows).toHaveLength(0);
    expect(taps).toBe(0);

    root.dispose();
  });

  it("keeps one node per key and reuses it when the host asks again", () => {
    const fake = createFakePapi();
    const { root, list } = makeList(fake, () => tasks);

    fake.requestCell(0);
    fake.requestCell(1);
    const createdAfterFirstPass = fake.creates.length;

    fake.requestCell(0);
    fake.requestCell(1);

    expect(fake.creates).toHaveLength(createdAfterFirstPass);
    expect(list.rows).toHaveLength(2);
    expect(list.materialize(1)).toBe(list.materialize(1));

    root.dispose();
  });

  it("updates a row in place when its index changes and keeps its node", () => {
    const fake = createFakePapi();
    let items = [...tasks];
    const { root, list } = makeList(fake, () => items);

    fake.requestCell(0);
    fake.requestCell(1);
    const nodes = [...fake.listNode()!.children];
    const createdAfterFirstPass = fake.creates.length;

    // The same two keys, reversed: both rows must move rather than rebuild.
    items = [tasks[1]!, tasks[0]!, tasks[2]!];
    list.update();
    fake.requestCell(0);
    fake.requestCell(1);

    expect(fake.creates).toHaveLength(createdAfterFirstPass);
    expect(rowLabels(fake)).toEqual(["second#0", "first#1"]);
    expect(list.rows.map(row => row.index())).toEqual([0, 1]);
    // Row 0 is still the node the host was given for task 2.
    expect(fake.listNode()!.children[0]).toBe(nodes[1]);
    expect(fake.listNode()!.children[1]).toBe(nodes[0]);

    root.dispose();
  });

  it("re-installs the callbacks through __UpdateListCallbacks when the model changes", () => {
    const fake = createFakePapi();
    let items = [...tasks];
    const { root, list } = makeList(fake, () => items);

    const created = fake.listCalls[0]!.callbacks;
    list.update();

    expect(fake.listCalls.map(call => call.op)).toEqual(["create", "update"]);
    const updated = fake.listCalls[1]!.callbacks;
    expect(updated.componentAtIndex).not.toBe(created.componentAtIndex);
    expect(fake.installedListCallbacks()).toBe(updated);

    // A pair from a superseded generation must not materialize anything.
    fake.requestCell(1);
    const materialized = fake.listNode()!.children.length;
    created.componentAtIndex(fake.listNode()!, 1, 2, 1, false);
    expect(fake.listNode()!.children.length).toBe(materialized);

    items = [tasks[0]!];
    root.dispose();
  });

  it("releases rows whose key left the model", () => {
    const fake = createFakePapi();
    let items = [...tasks];
    const { root, list } = makeList(fake, () => items);

    fake.requestCell(0);
    fake.requestCell(1);
    expect(fake.listNode()!.children).toHaveLength(2);

    items = [tasks[0]!, tasks[2]!];
    list.update();

    expect(rowLabels(fake)).toEqual(["first#0"]);
    expect(list.rows).toHaveLength(1);

    root.dispose();
  });

  it("materializes nothing for an index past the model and releases a row that left it", () => {
    const fake = createFakePapi();
    let items = [...tasks];
    const { root, list } = makeList(fake, () => items);

    fake.requestCell(2);
    expect(fake.listNode()!.children).toHaveLength(1);

    items = [tasks[0]!];
    list.update();

    // Task 3 is gone from the model, so its row is released instead of reused.
    expect(fake.requestCell(2).children).toBe(0);
    expect(list.rows).toHaveLength(0);

    root.dispose();
  });

  it("rejects an index that is not a non-negative integer", () => {
    const fake = createFakePapi();
    const { root, list } = makeList(fake, () => tasks);

    expect(() => list.materialize(-1)).toThrow(RangeError);
    expect(() => list.materialize(1.5)).toThrow(RangeError);

    root.dispose();
  });

  it("releases every row and detaches the callbacks on disposal", () => {
    const fake = createFakePapi();
    const { root, list } = makeList(fake, () => tasks);

    fake.requestCell(0);
    fake.requestCell(1);
    const listNode = fake.listNode()!;
    const installed = fake.installedListCallbacks()!;

    list.dispose();

    expect(list.disposed).toBe(true);
    expect(listNode.children).toHaveLength(0);
    expect(list.rows).toHaveLength(0);
    expect(() => list.materialize(0)).toThrow(/disposed/);
    // Disposal leaves an inert pair installed, so a host holding the list
    // cannot repopulate the disposed model.
    installed.componentAtIndex(listNode, 1, 0, 1, false);
    expect(listNode.children).toHaveLength(0);

    // Idempotent, and the root releases the list element itself.
    expect(() => {
      list.dispose();
      root.dispose();
    }).not.toThrow();
    expect(fake.page.children).toHaveLength(0);
  });

  it("fails clearly when the host implements no list PAPI", () => {
    const fake = createFakePapi();
    const { __CreateList, __UpdateListCallbacks, ...papi } = fake.papi;
    void __CreateList;
    void __UpdateListCallbacks;
    const root = createLynxRoot({ papi: papi as LynxPapi, page: fake.page });

    expect(() => root.createList({ items: () => tasks, children: () => root.renderer.createElement("view") }))
      .toThrow(/__CreateList/);

    root.dispose();
  });

  it("fails fast when the host creates a list but cannot update its callbacks", () => {
    const fake = createFakePapi();
    // `__CreateList` without `__UpdateListCallbacks`: creation alone is not list
    // support, because every model change and every disposal re-installs the
    // callbacks through `__UpdateListCallbacks`.
    const papi: LynxPapi = { ...fake.papi, __UpdateListCallbacks: undefined };
    const host = createGlobalLynxHost({
      papi,
      getParentComponentId: () => fake.papi.__GetElementUniqueID!(fake.page),
    });

    // The adapter exposes neither wrapper, so the missing operation is named at
    // the call that could report it rather than from a later update or dispose.
    expect(host.createList).toBeUndefined();
    expect(host.updateListCallbacks).toBeUndefined();
    expect(() => host.createElement("list")).toThrow(/__UpdateListCallbacks/);

    const root = createLynxRoot({ papi, page: fake.page });
    expect(() => root.createList({
      items: () => tasks,
      children: () => root.renderer.createElement("view"),
    })).toThrow(/__UpdateListCallbacks/);

    // Nothing was created, and the rejected call leaves the root disposable.
    expect(fake.listCalls).toHaveLength(0);
    expect(() => root.dispose()).not.toThrow();
  });

  it("refuses to create <list> through createElement", () => {
    const fake = createFakePapi();
    const host = createGlobalLynxHost({
      papi: fake.papi,
      getParentComponentId: () => fake.papi.__GetElementUniqueID!(fake.page),
    });

    // The element needs row callbacks that `createElement` cannot pass, so it
    // points at the indexed list API instead of creating a container that would
    // virtualize nothing.
    expect(() => host.createElement("list")).toThrow(/createList/);
    expect(() => host.createElement("x-list")).toThrow(/createList/);
    expect(fake.creates).not.toContain("list");
  });

  it("names the missing list PAPI when the host has no list support at all", () => {
    const fake = createFakePapi();
    const host = createGlobalLynxHost({
      papi: { ...fake.papi, __CreateList: undefined, __UpdateListCallbacks: undefined },
      getParentComponentId: () => fake.papi.__GetElementUniqueID!(fake.page),
    });

    expect(() => host.createElement("list")).toThrow(/does not implement Element PAPI __CreateList/);
  });
});
