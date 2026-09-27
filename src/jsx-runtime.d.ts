import type { LynxNode } from "./host.js";

export namespace JSX {
  type Element = LynxNode | Element[] | string | number | boolean | null | undefined;
  interface IntrinsicAttributes {
    key?: string | number;
    ref?: unknown;
  }
  interface IntrinsicElements {
    [elementName: string]: Record<string, unknown>;
  }
}

export declare const Fragment: (props: { children?: unknown }) => LynxNode;
export declare function jsx(
  type: string | ((props: Record<string, unknown>) => unknown),
  props: Record<string, unknown> | null,
  key?: string | number,
): LynxNode;
export declare const jsxs: typeof jsx;
