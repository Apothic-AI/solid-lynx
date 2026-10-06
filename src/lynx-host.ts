import type { LynxHost, LynxNode } from "./host.js";
import { eventListenerOptions, parseEventProp } from "./events.js";

type PapiFunction = (...args: any[]) => any;

export interface LynxPapi {
  __CreatePage?: PapiFunction;
  /** Container for a root nested in an existing page, so roots stay isolated. */
  __CreateComponent?: PapiFunction;
  __CreateElement: PapiFunction;
  __CreateView?: PapiFunction;
  __CreateScrollView?: PapiFunction;
  __CreateText?: PapiFunction;
  __CreateImage?: PapiFunction;
  __CreateFrame?: PapiFunction;
  __CreateWrapperElement?: PapiFunction;
  __CreateRawText: PapiFunction;
  __GetElementUniqueID?: PapiFunction;
  __AppendElement: PapiFunction;
  __InsertElementBefore: PapiFunction;
  __RemoveElement: PapiFunction;
  __ReplaceElements?: PapiFunction;
  __GetParent?: PapiFunction;
  __FirstElement: PapiFunction;
  __NextElement: PapiFunction;
  __SetAttribute: PapiFunction;
  __SetID?: PapiFunction;
  /**
   * Assigns a compiled CSS id to elements.
   *
   * This is a member of `@lynx-js/web-core`'s `ElementPAPIs` surface, where it
   * takes the elements as one array and an `entryName`. Optional here because a
   * host is free not to implement it.
   */
  __SetCSSId?: (
    elements: LynxNode[],
    cssId: number | null,
    entryName?: string,
  ) => void;
  __SetClasses: PapiFunction;
  __SetInlineStyles: PapiFunction;
  __AddDataset?: PapiFunction;
  __SetDataset?: PapiFunction;
  __AddEvent?: PapiFunction;
  __AddEventListener?: PapiFunction;
  __RemoveEventListener?: PapiFunction;
  __FlushElementTree: PapiFunction;
}

export interface GlobalLynxHostOptions {
  getParentComponentId: () => number;
  transformEventNames?: boolean;
  flushScheduler?: (flush: () => void) => void;
  papi?: LynxPapi;
}

interface RegisteredEvent {
  handler: ((event: unknown) => void) | undefined;
  listener: (event: unknown) => void;
  type: string;
  name: string;
  namespace?: string;
  attached: boolean;
}

const builtInCreators: Record<string, keyof LynxPapi> = {
  view: "__CreateView",
  "scroll-view": "__CreateScrollView",
  "x-scroll-view": "__CreateScrollView",
  text: "__CreateText",
  image: "__CreateImage",
  frame: "__CreateFrame",
  wrapper: "__CreateWrapperElement",
};

const booleanAttributes = new Set([
  "disabled", "checked", "readonly", "selected", "multiple", "required",
]);

function getGlobalPapi(): LynxPapi {
  return globalThis as unknown as LynxPapi;
}

/**
 * Whether a value returned by a Lynx element creator is a usable node.
 *
 * The web host wraps DOM nodes, so its elements are `typeof "object"`. A native
 * PrimJS host returns opaque element handles whose `typeof` is `"unknown"`, so a
 * strict `typeof value === "object"` test rejects every element a device
 * creates. A creator that failed yields `null` or `undefined` instead, which is
 * the case this guard exists to catch, so the check only has to rule out the
 * primitives a broken host might return.
 */
export function isLynxNode(value: unknown): value is LynxNode {
  return value !== null
    && value !== undefined
    && typeof value !== "string"
    && typeof value !== "number"
    && typeof value !== "boolean";
}

export function createGlobalLynxHost(
  options: GlobalLynxHostOptions,
): LynxHost<LynxNode> {
  const papi = options.papi ?? getGlobalPapi();
  const textNodes = new WeakSet<object>();
  const parents = new WeakMap<object, LynxNode>();
  const children = new WeakMap<object, LynxNode[]>();
  const datasets = new WeakMap<object, Record<string, unknown>>();
  const events = new WeakMap<object, Map<string, RegisteredEvent>>();
  let flushQueued = false;
  let flushPending = false;

  const requirePapi = <Key extends keyof LynxPapi>(name: Key): NonNullable<LynxPapi[Key]> => {
    const fn = papi[name];
    if (typeof fn !== "function") {
      throw new Error(`solid-lynx requires Lynx Element PAPI ${String(name)}()`);
    }
    return fn as NonNullable<LynxPapi[Key]>;
  };

  const flushNow = () => {
    flushPending = false;
    requirePapi("__FlushElementTree")();
  };

  const scheduleFlush = () => {
    flushPending = true;
    if (flushQueued) return;
    flushQueued = true;
    const schedule = options.flushScheduler ?? (callback => {
      if (typeof globalThis.queueMicrotask === "function") {
        globalThis.queueMicrotask(callback);
      } else {
        void Promise.resolve().then(callback);
      }
    });
    schedule(() => {
      flushQueued = false;
      if (flushPending) flushNow();
    });
  };

  const createNativeElement = (tagName: string): LynxNode => {
    const tag = tagName.toLowerCase();
    const creatorName = builtInCreators[tag];
    const creator = creatorName ? papi[creatorName] : undefined;
    const element = typeof creator === "function"
      ? creator(options.getParentComponentId())
      : requirePapi("__CreateElement")(tag, options.getParentComponentId());
    if (!isLynxNode(element)) {
      throw new Error(`Lynx failed to create <${tag}>`);
    }
    return element;
  };

  const attachEvent = (node: LynxNode, record: RegisteredEvent) => {
    if (record.attached) return;
    const addEventListener = papi.__AddEventListener;
    if (typeof addEventListener === "function") {
      addEventListener(
        node,
        record.name,
        record.listener,
        eventListenerOptions(record.type, record.namespace),
      );
    } else if (typeof papi.__AddEvent === "function") {
      papi.__AddEvent(node, record.type, record.name, {
        type: "worklet",
        value: record.listener,
      });
    } else {
      throw new Error("solid-lynx requires __AddEvent() or __AddEventListener()");
    }
    record.attached = true;
  };

  const detachEvent = (node: LynxNode, record: RegisteredEvent) => {
    if (!record.attached) return;
    record.attached = false;
    if (typeof papi.__RemoveEventListener === "function") {
      papi.__RemoveEventListener(
        node,
        record.name,
        record.listener,
        eventListenerOptions(record.type, record.namespace),
      );
    } else if (typeof papi.__AddEvent === "function") {
      papi.__AddEvent(node, record.type, record.name, undefined);
    }
  };

  /** Listeners only exist in the host while their node is part of the tree. */
  const isAttached = (node: LynxNode): boolean => parents.has(node);

  const syncEventTree = (node: LynxNode, attach: boolean) => {
    const nodeEvents = events.get(node);
    if (nodeEvents) {
      for (const record of nodeEvents.values()) {
        if (attach) attachEvent(node, record);
        else detachEvent(node, record);
      }
    }
    for (const child of [...(children.get(node) ?? [])]) syncEventTree(child, attach);
  };

  const updateEvent = (
    node: LynxNode,
    property: string,
    value: unknown,
  ) => {
    const event = parseEventProp(property, options.transformEventNames ?? true);
    if (!event) return false;

    let nodeEvents = events.get(node);
    if (!nodeEvents) {
      nodeEvents = new Map();
      events.set(node, nodeEvents);
    }
    // A namespaced binding is a separate registration from the plain one, so
    // the namespace is part of the slot identity.
    const key = `${event.namespace ?? ""}:${event.type}:${event.name}`;
    let registered = nodeEvents.get(key);

    if (typeof value !== "function" && !Array.isArray(value)) {
      if (registered) {
        nodeEvents.delete(key);
        detachEvent(node, registered);
      }
      if (nodeEvents.size === 0) events.delete(node);
      return true;
    }

    const tuple = Array.isArray(value) ? value : undefined;
    const handler = (tuple ? tuple[0] : value) as ((...args: any[]) => void);
    if (typeof handler !== "function") {
      throw new TypeError(`Event prop ${property} must be a function or [function, data]`);
    }

    if (registered) {
      registered.handler = (eventValue: unknown) => {
        if (tuple) handler(tuple[1], eventValue);
        else handler(eventValue);
      };
      return true;
    }

    const record: RegisteredEvent = {
      type: event.type,
      name: event.name,
      namespace: event.namespace,
      attached: false,
      handler: (eventValue: unknown) => {
        if (tuple) handler(tuple[1], eventValue);
        else handler(eventValue);
      },
      listener: () => undefined,
    };
    record.listener = eventValue => record.handler?.(eventValue);

    nodeEvents.set(key, record);
    if (isAttached(node)) attachEvent(node, record);
    return true;
  };

  const host: LynxHost<LynxNode> = {
    createElement: createNativeElement,
    createTextNode(value) {
      const node = requirePapi("__CreateRawText")(value) as unknown;
      if (!isLynxNode(node)) {
        throw new Error("Lynx failed to create a raw text node");
      }
      textNodes.add(node);
      return node;
    },
    createComment() {
      const creator = papi.__CreateWrapperElement;
      if (typeof creator !== "function") {
        throw new Error("Solid control flow requires Lynx __CreateWrapperElement() support");
      }
      const node = creator(options.getParentComponentId()) as unknown;
      if (!isLynxNode(node)) {
        throw new Error("Lynx failed to create a wrapper element");
      }
      return node;
    },
    replaceText(node, value) {
      const parent = parents.get(node);
      if (!parent) {
        throw new Error("Cannot update a Lynx text node before it has been inserted");
      }
      requirePapi("__SetAttribute")(node, "text", value);
      scheduleFlush();
    },
    setProperty(node, property, value) {
      if (property === "children" || property === "key" || property === "ref") return;
      if (updateEvent(node, property, value)) {
        scheduleFlush();
        return;
      }

      if (property === "class" || property === "className") {
        requirePapi("__SetClasses")(node, value == null ? "" : String(value));
      } else if (property === "style") {
        requirePapi("__SetInlineStyles")(node, value == null ? "" : value);
      } else if (property === "id" && papi.__SetID) {
        papi.__SetID(node, value == null ? null : String(value));
      } else if (property.startsWith("data-") && (papi.__AddDataset || papi.__SetDataset)) {
        const dataset = datasets.get(node) ?? {};
        const key = property.slice(5);
        if (value == null) delete dataset[key];
        else dataset[key] = value;
        datasets.set(node, dataset);
        if (papi.__AddDataset) papi.__AddDataset(node, key, value);
        else papi.__SetDataset!(node, dataset);
      } else if (property === "textContent") {
        requirePapi("__SetAttribute")(node, "text", value == null ? "" : String(value));
      } else if (booleanAttributes.has(property) && typeof value === "boolean") {
        requirePapi("__SetAttribute")(node, property, value ? property : null);
      } else {
        requirePapi("__SetAttribute")(node, property, value ?? null);
      }
      scheduleFlush();
    },
    // Present only where the host implements the CSS-id PAPI, so the root can
    // tell "unsupported" apart from "assigned" instead of assuming either. The
    // call itself reads the surface at call time, like every other operation
    // here, so a host that installs its PAPI later is still called correctly.
    ...(typeof papi.__SetCSSId === "function"
      ? {
        setCSSId(elements: LynxNode[], cssId: number | null, entryName?: string) {
          requirePapi("__SetCSSId")(elements, cssId, entryName);
          scheduleFlush();
        },
      }
      : {}),
    insertNode(parent, node, anchor) {
      if (anchor == null) {
        requirePapi("__AppendElement")(parent, node);
      } else {
        requirePapi("__InsertElementBefore")(parent, node, anchor);
      }
      parents.set(node, parent);
      const siblingList = children.get(parent) ?? [];
      const existingIndex = siblingList.indexOf(node);
      if (existingIndex >= 0) siblingList.splice(existingIndex, 1);
      const anchorIndex = anchor == null ? -1 : siblingList.indexOf(anchor);
      if (anchorIndex < 0) siblingList.push(node);
      else siblingList.splice(anchorIndex, 0, node);
      children.set(parent, siblingList);
      syncEventTree(node, true);
      scheduleFlush();
    },
    removeNode(parent, node) {
      syncEventTree(node, false);
      requirePapi("__RemoveElement")(parent, node);
      parents.delete(node);
      const siblingList = children.get(parent);
      if (siblingList) {
        const index = siblingList.indexOf(node);
        if (index >= 0) siblingList.splice(index, 1);
      }
      scheduleFlush();
    },
    isTextNode: node => textNodes.has(node),
    getParentNode(node) {
      return parents.get(node)
        ?? (papi.__GetParent?.(node) as LynxNode | null | undefined)
        ?? undefined;
    },
    getFirstChild(node) {
      return children.get(node)?.[0]
        ?? (requirePapi("__FirstElement")(node) as LynxNode | null)
        ?? undefined;
    },
    getNextSibling(node) {
      const parent = parents.get(node);
      const siblingList = parent && children.get(parent);
      if (siblingList) {
        const index = siblingList.indexOf(node);
        if (index >= 0) return siblingList[index + 1];
      }
      return (requirePapi("__NextElement")(node) as LynxNode | null) ?? undefined;
    },
    flush: flushNow,
  };

  return host;
}

export function getLynxPageId(page: LynxNode, papi = getGlobalPapi()): number {
  if (typeof papi.__GetElementUniqueID !== "function") {
    throw new Error("solid-lynx requires Lynx Element PAPI __GetElementUniqueID()");
  }
  const id = papi.__GetElementUniqueID(page);
  if (!Number.isInteger(id)) {
    throw new Error("Lynx returned an invalid page component id");
  }
  return id;
}

export function createLynxPage(
  componentId: string,
  cssId = 0,
  papi = getGlobalPapi(),
): LynxNode {
  if (typeof papi.__CreatePage !== "function") {
    throw new Error("solid-lynx requires Lynx Element PAPI __CreatePage()");
  }
  const page = papi.__CreatePage(componentId, cssId) as unknown;
  if (!isLynxNode(page)) {
    throw new Error("Lynx failed to create a page");
  }
  return page;
}

export const createLynxHost = createGlobalLynxHost;
