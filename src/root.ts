import type { LynxHost, LynxNode } from "./host.js";
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
  /**
   * Assigns a compiled CSS id to every element this root owns directly in its
   * page, and to any element it inserts there afterwards.
   *
   * This selects a stylesheet the Lynx toolchain already compiled into the
   * bundle. Loading a stylesheet at runtime is not part of the Element PAPI and
   * is not supported.
   *
   * @throws if the host does not implement the CSS-id PAPI.
   */
  setCSSId(cssId: number | null, entryName?: string): void;
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

  /**
   * The nodes this root inserted directly into its page.
   *
   * A Lynx page can host several independent roots, so disposal must release
   * the nodes this root created instead of clearing every child of the page,
   * which would tear down the trees of the other roots on the same page.
   */
  const ownedNodes: LynxNode[] = [];
  let cssId: { value: number | null; entryName?: string } | undefined;

  /**
   * Resolves the CSS-id operation or reports that this host cannot assign one.
   *
   * Assignment is a real capability with a real failure mode: a host without
   * `__SetCSSId` cannot style these elements at all, so silently doing nothing
   * would leave the app rendering unstyled with no signal.
   */
  const requireCSSIdSupport = (): NonNullable<LynxHost<LynxNode>["setCSSId"]> => {
    if (!host.setCSSId) {
      throw new Error(
        "solid-lynx cannot assign a CSS id: this Lynx host does not implement Element PAPI __SetCSSId()",
      );
    }
    return host.setCSSId;
  };

  const applyCSSIdTo = (nodes: LynxNode[]): void => {
    if (!cssId || nodes.length === 0) return;
    requireCSSIdSupport()(nodes, cssId.value, cssId.entryName);
  };

  const ownNode = (node: LynxNode) => {
    if (!ownedNodes.includes(node)) ownedNodes.push(node);
  };
  const releaseNode = (node: LynxNode) => {
    const index = ownedNodes.indexOf(node);
    if (index >= 0) ownedNodes.splice(index, 1);
  };
  const ownedHost: LynxHost<LynxNode> = {
    ...host,
    insertNode(parent, node, anchor) {
      host.insertNode(parent, node, anchor);
      if (parent === page) {
        ownNode(node);
        // A page-level element added after the id was assigned belongs to the
        // same stylesheet, so the root applies it to each one as it arrives.
        applyCSSIdTo([node]);
      }
    },
    removeNode(parent, node) {
      host.removeNode(parent, node);
      if (parent === page) releaseNode(node);
    },
  };

  const renderer = createLynxRenderer(ownedHost, {
    transformEventNames: options.transformEventNames,
  });

  let disposeRenderer: (() => void) | undefined;

  const dispose = () => {
    disposeRenderer?.();
    disposeRenderer = undefined;
    for (const node of [...ownedNodes]) {
      if (host.getParentNode(node) === page) host.removeNode(page, node);
    }
    ownedNodes.length = 0;
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
    setCSSId(value, entryName) {
      if (value !== null && !(Number.isInteger(value) && value >= 0)) {
        throw new TypeError(
          `Lynx CSS id must be a non-negative integer or null, got ${String(value)}`,
        );
      }
      // Validate and confirm support before recording anything, so a rejected
      // call leaves the root exactly as it was.
      requireCSSIdSupport();
      cssId = { value, ...(entryName === undefined ? {} : { entryName }) };
      // One call for the whole root: the PAPI takes the elements as an array.
      applyCSSIdTo([...ownedNodes]);
      renderer.flush();
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
