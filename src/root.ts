import type { LynxNode } from "./host.js";
import {
  createGlobalLynxHost,
  createLynxPage,
  getLynxPageId,
  type LynxPapi,
} from "./lynx-host.js";
import { createLynxRenderer, type LynxRenderer } from "./renderer.js";

export interface LynxRootOptions {
  /** Existing page element. If omitted, createPage is used. */
  page?: LynxNode;
  /** Component id passed to __CreatePage when a page is created. */
  componentId?: string;
  /** CSS id passed to __CreatePage when a page is created. */
  cssId?: number;
  /** Explicit parent component id for hosts without __GetElementUniqueID. */
  parentComponentId?: number;
  /** Injected PAPI surface, useful for tests and alternate Lynx runtimes. */
  papi?: LynxPapi;
  transformEventNames?: boolean;
}

export interface LynxRoot {
  readonly page: LynxNode;
  readonly renderer: LynxRenderer<LynxNode>;
  render(code: () => LynxNode): () => void;
  dispose(): void;
  flush(): void;
}

export function createLynxRoot(options: LynxRootOptions = {}): LynxRoot {
  const papi = options.papi ?? (globalThis as unknown as LynxPapi);
  const page = options.page
    ?? createLynxPage(options.componentId ?? "0", options.cssId ?? 0, papi);
  const parentComponentId = options.parentComponentId
    ?? getLynxPageId(page, papi);

  const host = createGlobalLynxHost({
    papi,
    getParentComponentId: () => parentComponentId,
    transformEventNames: options.transformEventNames,
  });
  const renderer = createLynxRenderer(host, {
    transformEventNames: options.transformEventNames,
  });

  let disposeRenderer: (() => void) | undefined;

  const clearPage = () => {
    let child = host.getFirstChild(page);
    while (child) {
      host.removeNode(page, child);
      child = host.getFirstChild(page);
    }
  };

  const dispose = () => {
    disposeRenderer?.();
    disposeRenderer = undefined;
    clearPage();
    host.flush();
  };

  return {
    page,
    renderer,
    render(code) {
      if (disposeRenderer) {
        throw new Error("A Solid Lynx root can only be rendered once");
      }
      disposeRenderer = renderer.render(code, page);
      return dispose;
    },
    dispose,
    flush: renderer.flush,
  };
}

export function renderLynxPage(
  code: () => LynxNode,
  options: LynxRootOptions = {},
): LynxRoot {
  const root = createLynxRoot(options);
  root.render(code);
  return root;
}
