import type { LynxRenderer } from "./renderer.js";
import { createLynxRenderer } from "./renderer.js";
import { createGlobalLynxHost } from "./lynx-host.js";
import type { LynxNode } from "./host.js";
import { getLynxRendererForCurrentOwner } from "./render-context.js";

let parentComponentId: number | undefined;

const host = createGlobalLynxHost({
  getParentComponentId() {
    if (parentComponentId === undefined) {
      throw new Error("Call initializeLynxRootContext() before rendering Solid UI");
    }
    return parentComponentId;
  },
});

const renderer = createLynxRenderer(host);

function getCurrentRenderer(): LynxRenderer<LynxNode> {
  return (getLynxRendererForCurrentOwner() as LynxRenderer<LynxNode> | undefined)
    ?? renderer;
}

export function initializeLynxRootContext(id: number): void {
  if (!Number.isInteger(id)) {
    throw new TypeError(`Lynx page component id must be an integer, got ${String(id)}`);
  }
  parentComponentId = id;
}

export function ensureLynxEnvironmentBasics(): void {
  if (typeof globalThis.queueMicrotask !== "function") {
    globalThis.queueMicrotask = callback => Promise.resolve().then(callback);
  }
}

export function effect<T>(fn: (previous?: T) => T, initial?: T): void {
  getCurrentRenderer().effect(fn, initial);
}

export function memo<T>(fn: () => T, equals?: boolean): () => T {
  return getCurrentRenderer().memo(fn, equals ?? false);
}

export function createComponent<T>(
  component: (props: T) => LynxNode,
  props: T,
): LynxNode {
  return getCurrentRenderer().createComponent(component, props);
}

export function createElement(tagName: string): LynxNode {
  return getCurrentRenderer().createElement(tagName);
}

export function createTextNode(value: string): LynxNode {
  return getCurrentRenderer().createTextNode(value);
}

export function insertNode(parent: LynxNode, node: LynxNode, anchor?: LynxNode): void {
  getCurrentRenderer().insertNode(parent, node, anchor);
}

export function insert(
  parent: LynxNode,
  accessor: (() => unknown) | unknown,
  marker?: LynxNode | null,
  initial?: unknown,
): LynxNode {
  return getCurrentRenderer().insert(parent, accessor, marker, initial);
}

export function spread(
  node: LynxNode,
  accessor: (() => unknown) | unknown,
  skipChildren?: boolean,
): void {
  getCurrentRenderer().spread(node, accessor, skipChildren);
}

export function setProp<T>(node: LynxNode, name: string, value: T, previous?: T): T {
  return getCurrentRenderer().setProp(node, name, value, previous);
}

export function mergeProps(...sources: unknown[]): unknown {
  return getCurrentRenderer().mergeProps(...sources);
}

export function use<A, T>(
  fn: (element: LynxNode, arg: A) => T,
  element: LynxNode,
  arg: A,
): T {
  return getCurrentRenderer().use(fn, element, arg);
}

export function render(code: () => LynxNode, parent: LynxNode): () => void {
  if (parentComponentId === undefined) {
    const getElementId = (globalThis as Record<string, unknown>)["__GetElementUniqueID"];
    if (typeof getElementId === "function") {
      initializeLynxRootContext((getElementId as (node: LynxNode) => number)(parent));
    }
  }
  return renderer.render(code, parent);
}

export const flush = renderer.flush;
