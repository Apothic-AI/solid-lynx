export interface LynxNode {
  readonly [key: string]: unknown;
}

export interface LynxHost<Node extends object = LynxNode> {
  createElement(tagName: string): Node;
  createTextNode(value: string): Node;
  createComment(data: string): Node;
  replaceText(node: Node, value: string): void;
  setProperty(node: Node, name: string, value: unknown, previous: unknown): void;
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
