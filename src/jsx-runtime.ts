import {
  createComponent,
  createElement,
  spread,
} from "./universal.js";
import type { LynxNode } from "./host.js";

export const Fragment = (props: { children?: unknown }) => props.children as LynxNode;

export function jsx(
  type: string | ((props: Record<string, unknown>) => unknown),
  props: Record<string, unknown> | null,
  key?: string | number,
): LynxNode {
  const nextProps = { ...(props ?? {}), ...(key === undefined ? {} : { key }) };
  if (typeof type === "function") {
    return createComponent(type as (props: Record<string, unknown>) => LynxNode, nextProps);
  }
  const element = createElement(type);
  spread(element, nextProps);
  return element;
}

export const jsxs = jsx;

export namespace JSX {
  export type Element = LynxNode;
  export interface IntrinsicAttributes {
    key?: string | number;
    ref?: unknown;
  }
  export interface IntrinsicElements {
    [elementName: string]: Record<string, unknown>;
  }
}
