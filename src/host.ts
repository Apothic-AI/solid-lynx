export interface LynxNode {
  readonly [key: string]: unknown;
}

/**
 * The two callbacks a Lynx list PAPI drives rows through.
 *
 * Signatures come from the host's own declarations
 * (`CreateListPAPI`, `UpdateListCallbacksPAPI`, `ComponentAtIndexCallback`, and
 * `EnqueueComponentCallback` in `@lynx-js/web-core@0.26.2`
 * `dist/types/IElementPAPI.d.ts` and `dist/types/Element.d.ts`).
 *
 * Two things the declarations leave open are settled by the host's
 * implementation (`dist/client/mainthread/elementAPIs/createElementAPI.js`):
 *
 * - `componentAtIndex` is declared as returning `void`, but the host reads a
 *   numeric result from it: `const sign = componentAtIndex(...); if (typeof
 *   sign === "number") { insert(get_dom_by_unique_id(sign)) }`. A host that
 *   positions the returned row element can only do so when this returns the
 *   row's unique id, so it returns `number | undefined` here.
 * - `enqueueComponent`'s `sign` is the unique id of the element the host is
 *   removing (`const sign = __GetElementUniqueID(removedEle);
 *   enqueueComponent(element, uniqueId, sign)`), not a row index.
 */
export interface LynxListCallbacks<Node extends object = LynxNode> {
  componentAtIndex(
    list: Node,
    listId: number,
    cellIndex: number,
    operationId: number,
    enableReuseNotification: boolean,
  ): number | undefined;
  enqueueComponent(list: Node, listId: number, sign: number): void;
}

export interface LynxHost<Node extends object = LynxNode> {
  createElement(tagName: string): Node;
  createTextNode(value: string): Node;
  createComment(data: string): Node;
  replaceText(node: Node, value: string): void;
  setProperty(node: Node, name: string, value: unknown, previous?: unknown): void;
  /**
   * Assigns a compiled CSS id to a set of elements in one Element PAPI call.
   *
   * Optional because the operation exists only where the host implements the
   * CSS-id PAPI. Absent means "this host cannot assign CSS ids", which callers
   * must report rather than silently skip.
   */
  setCSSId?(elements: Node[], cssId: number | null, entryName?: string): void;
  /**
   * Creates a list element through `__CreateList` and hands it the callbacks
   * that materialize a row by index.
   *
   * Optional because the operation exists only where the host implements the
   * list PAPI. Absent means "this host cannot virtualize", which callers must
   * report rather than silently fall back to an ordinary container.
   */
  createList?(callbacks: LynxListCallbacks<Node>): Node;
  /**
   * Replaces the callbacks of an existing list through `__UpdateListCallbacks`.
   *
   * Present exactly where {@link LynxHost.createList} is.
   */
  updateListCallbacks?(list: Node, callbacks: LynxListCallbacks<Node>): void;
  /**
   * Releases this host's event registrations from a node's subtree, leaving the
   * element tree untouched.
   *
   * Present for a removal the host performs itself. `removeNode` already
   * detaches, but a host that drops an element on its own never reaches it, and
   * the registrations would stay on the orphaned element.
   */
  detachListeners?(node: Node): void;
  insertNode(parent: Node, node: Node, anchor?: Node): void;
  removeNode(parent: Node, node: Node): void;
  isTextNode(node: Node): boolean;
  /**
   * Unique id of a node, present only where the host implements
   * `__GetElementUniqueID`.
   *
   * The list PAPI identifies a row by this id: `componentAtIndex` returns it so
   * the host can place the row, and `enqueueComponent` names it as the element
   * being removed.
   */
  getUniqueId?(node: Node): number | undefined;
  getParentNode(node: Node): Node | undefined;
  getFirstChild(node: Node): Node | undefined;
  getNextSibling(node: Node): Node | undefined;
  flush(): void;
}

export interface RendererOptions {
  /** Map JSX event props such as onClick to Lynx bind* event props. */
  transformEventNames?: boolean;
}
