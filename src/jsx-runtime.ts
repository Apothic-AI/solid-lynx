import {
  createComponent,
  createElement,
  spread,
} from "./universal.js";
import type { Component } from "solid-js";
import type { LynxNode } from "./host.js";
import type { JSX } from "./jsx-types.js";

export type { JSX } from "./jsx-types.js";

export function Fragment(props: { children?: JSX.Child }): JSX.Element {
  return props.children as JSX.Element;
}

export function jsx(
  type: string | Component<any>,
  props: Record<string, unknown> | null,
  key?: string | number,
): JSX.Element {
  const nextProps = { ...(props ?? {}), ...(key === undefined ? {} : { key }) };
  if (typeof type === "function") {
    return createComponent(
      type as unknown as (props: Record<string, unknown>) => LynxNode,
      nextProps,
    ) as JSX.Element;
  }
  const element = createElement(type);
  spread(element, nextProps);
  return element;
}

export const jsxs = jsx;

export interface JSXSource {
  fileName: string;
  lineNumber: number;
  columnNumber: number;
}

export function jsxDEV(
  type: string | Component<any>,
  props: Record<string, unknown> | null,
  key?: string | number,
  _isStaticChildren?: boolean,
  _source?: JSXSource,
  _self?: unknown,
): JSX.Element {
  return jsx(type, props, key);
}
