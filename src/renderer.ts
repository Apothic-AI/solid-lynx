import { createRenderer } from "solid-js/universal";

import type { LynxHost, RendererOptions } from "./host.js";
import { parseEventProp } from "./events.js";
import { registerLynxRendererForCurrentOwner } from "./render-context.js";

export function createLynxRenderer<Node extends object>(
  host: LynxHost<Node>,
  options: RendererOptions = {},
) {
  const runtime = createRenderer<Node>({
    createElement: tagName => host.createElement(tagName),
    createTextNode: value => host.createTextNode(value),
    replaceText: (node, value) => host.replaceText(node, value),
    setProperty: (node, name, value, previous) => {
      host.setProperty(node, name, value, previous);
    },
    insertNode: (parent, node, anchor) => {
      if (anchor === undefined) host.insertNode(parent, node);
      else host.insertNode(parent, node, anchor);
    },
    removeNode: (parent, node) => host.removeNode(parent, node),
    isTextNode: node => host.isTextNode(node),
    getParentNode: node => host.getParentNode(node),
    getFirstChild: node => host.getFirstChild(node),
    getNextSibling: node => host.getNextSibling(node),
  });

  const lynxRenderer = {
    ...runtime,
    render(code: () => Node, parent: Node) {
      const dispose = runtime.render(() => {
        registerLynxRendererForCurrentOwner(lynxRenderer);
        return code();
      }, parent);
      host.flush();
      return () => {
        dispose();
        host.flush();
      };
    },
    flush: () => host.flush(),
    parseEventProp: (name: string) => parseEventProp(name, options.transformEventNames ?? true),
  };

  return lynxRenderer;
}

export type LynxRenderer<Node extends object> = ReturnType<typeof createLynxRenderer<Node>>;
