export interface LynxNode {
  readonly [key: string]: unknown;
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
  insertNode(parent: Node, node: Node, anchor?: Node): void;
  removeNode(parent: Node, node: Node): void;
  isTextNode(node: Node): boolean;
  getParentNode(node: Node): Node | undefined;
  getFirstChild(node: Node): Node | undefined;
  getNextSibling(node: Node): Node | undefined;
  flush(): void;
}

export interface RendererOptions {
  /** Map JSX event props such as onClick to Lynx bind* event props. */
  transformEventNames?: boolean;
}
