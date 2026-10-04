import type { LynxNode } from "./host.js";

/**
 * Callback ref for imperative access to a live Lynx PAPI node.
 *
 * `ref` is transformed by the Solid JSX compile step rather than by the
 * renderer: a function ref is passed to `use()`, so the callback runs while the
 * element is being created and the element is a Lynx PAPI node rather than a
 * browser DOM element.
 *
 * Returning a function registers it as the owning Solid scope's teardown, which
 * is what makes the attachment deterministic: it runs when the scope that
 * created the element is disposed.
 */
export type LynxRefCallback<Element extends LynxNode = LynxNode> = (
  element: Element,
) => (() => void) | void;

/**
 * A ref created by {@link createLynxRef}, usable directly as a `ref` value.
 *
 * It is callable as well as readable, because a non-callable object would be
 * assigned the node by the JSX transform instead of being invoked as a ref.
 */
export interface LynxRefObject<Element extends LynxNode = LynxNode> {
  (element: Element): () => void;
  current: Element | undefined;
}

export type LynxRef<Element extends LynxNode = LynxNode> =
  | LynxRefCallback<Element>
  | LynxRefObject<Element>;

/**
 * Creates a ref object that both holds the current node and works as a `ref`
 * value.
 *
 * ```tsx
 * const target = createLynxRef<LynxNode>();
 * <view ref={target} />;
 * target.current; // the node, or undefined once its scope is disposed
 * ```
 *
 * `current` is cleared by the teardown the ref returns, so a disposed element
 * never stays reachable through the ref.
 */
export function createLynxRef<Element extends LynxNode = LynxNode>(): LynxRefObject<Element> {
  const ref = ((element: Element) => {
    ref.current = element;
    return () => {
      if (ref.current === element) ref.current = undefined;
    };
  }) as LynxRefObject<Element>;
  ref.current = undefined;
  return ref;
}