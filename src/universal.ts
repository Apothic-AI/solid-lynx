import { createLynxRenderer } from "./renderer.js";
import { createGlobalLynxHost } from "./lynx-host.js";
import type { LynxNode } from "./host.js";

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

export const {
  effect,
  memo,
  createComponent,
  createElement,
  createTextNode,
  insertNode,
  insert,
  spread,
  setProp,
  mergeProps,
  use,
} = renderer;

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
