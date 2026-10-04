import type { JSX as SolidJSX } from "solid-js";
import type { LynxNode } from "./host.js";

/** Values that can cross Lynx's serializable attribute and dataset boundary. */
export type LynxDatasetValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly LynxDatasetValue[]
  | { readonly [key: string]: LynxDatasetValue };

export type LynxEventDetail = Readonly<Record<string, LynxDatasetValue>>;

/** CSS properties supported by Solid, including Lynx's CSS custom properties. */
export type LynxStyleProperties = SolidJSX.CSSProperties & {
  [customProperty: `--${string}`]: string | number | undefined;
};

export type LynxStyle = string | LynxStyleProperties | null | undefined;

/** The target shape shared by Lynx's main-thread and cross-thread events. */
export interface LynxEventTarget {
  readonly dataset: Readonly<Record<string, LynxDatasetValue>>;
  readonly id: string | null;
  readonly uid: number;
}

/** A platform-neutral Element PAPI event, not a browser DOM event. */
export interface LynxEvent<Detail extends LynxEventDetail = LynxEventDetail> {
  readonly type: string;
  readonly timestamp: number;
  readonly target: LynxEventTarget;
  readonly currentTarget: LynxEventTarget | null;
  readonly detail: Detail;
}

export type LynxEventHandler<Event extends LynxEvent = LynxEvent> = {
  bivarianceHack(event: Event): void;
}["bivarianceHack"];

/** Optional `[handler, data]` form supported by the host event adapter. */
export type LynxBoundEventHandler<Event extends LynxEvent = LynxEvent> = readonly [
  (data: unknown, event: Event) => void,
  unknown,
];

export type LynxEventPropHandler<Event extends LynxEvent = LynxEvent> =
  | LynxEventHandler<Event>
  | LynxBoundEventHandler<Event>;

export type LynxRef<Element extends LynxNode = LynxNode> =
  | Element
  | ((element: Element) => void);

export type LynxChild =
  | LynxNode
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly LynxChild[];

export interface LynxElementAttributes {
  children?: LynxChild;
  id?: string | null;
  class?: string | null;
  className?: string | null;
  style?: LynxStyle;
  role?: string;
  name?: string;
  title?: string;
  textContent?: string | number | null;
  tabIndex?: number | string;
  tabindex?: number | string;
  width?: number | string;
  height?: number | string;
  disabled?: boolean | null;
  checked?: boolean | null;
  readonly?: boolean | null;
  selected?: boolean | null;
  multiple?: boolean | null;
  required?: boolean | null;
  hidden?: boolean | null;
  ref?: LynxRef;
  [attribute: `aria-${string}`]: string | number | boolean | null | undefined;
  [attribute: `data-${string}`]: LynxDatasetValue;
  [event: `bind${string}`]: LynxEventPropHandler | undefined;
  [event: `bind:${string}`]: LynxEventPropHandler | undefined;
  [event: `catch${string}`]: LynxEventPropHandler | undefined;
  [event: `catch:${string}`]: LynxEventPropHandler | undefined;
  [event: `capture-bind${string}`]: LynxEventPropHandler | undefined;
  [event: `capture-bind:${string}`]: LynxEventPropHandler | undefined;
  [event: `capture-catch${string}`]: LynxEventPropHandler | undefined;
  [event: `capture-catch:${string}`]: LynxEventPropHandler | undefined;
  [event: `global-bind${string}`]: LynxEventPropHandler | undefined;
  [event: `global-bind:${string}`]: LynxEventPropHandler | undefined;
  [event: `on${string}`]: LynxEventPropHandler | undefined;
  [event: `on:${string}`]: LynxEventPropHandler | undefined;
  [event: `main-thread:${string}`]: LynxEventPropHandler | undefined;
  [event: `background:${string}`]: LynxEventPropHandler | undefined;
}

export interface LynxTextAttributes extends LynxElementAttributes {
  text?: string | number;
  "text-maxline"?: number;
}

export interface LynxImageAttributes extends LynxElementAttributes {
  src?: string;
  mode?: string;
}

export interface LynxScrollViewAttributes extends LynxElementAttributes {
  "enable-scroll"?: boolean;
  "scroll-orientation"?: "vertical" | "horizontal";
  "scroll-top"?: number;
  "scroll-left"?: number;
}

export interface LynxInputAttributes extends LynxElementAttributes {
  type?: string;
  value?: string | number;
  placeholder?: string;
  maxlength?: number;
}

export interface LynxTextareaAttributes extends LynxElementAttributes {
  value?: string | number;
  placeholder?: string;
  maxlength?: number;
}

/** Base props for custom tags, to be extended with their own attributes. */
export type LynxCustomElementAttributes<Extra extends object = {}> =
  LynxElementAttributes & Extra;

export namespace JSX {
  export type Element = LynxNode;
  export type Child = LynxChild;

  export interface ElementChildrenAttribute {
    children: {};
  }

  export interface IntrinsicAttributes {
    key?: string | number;
    ref?: LynxRef;
  }

  /** Custom tags remain opt-in through declaration merging. */
  export interface IntrinsicElements {
    view: LynxElementAttributes;
    text: LynxTextAttributes;
    image: LynxImageAttributes;
    "scroll-view": LynxScrollViewAttributes;
    "x-view": LynxElementAttributes;
    "x-text": LynxTextAttributes;
    "x-image": LynxImageAttributes;
    "x-scroll-view": LynxScrollViewAttributes;
    "x-input": LynxInputAttributes;
    "x-textarea": LynxTextareaAttributes;
    input: LynxInputAttributes;
    textarea: LynxTextareaAttributes;
    list: LynxElementAttributes;
    "list-item": LynxElementAttributes;
    "x-list": LynxElementAttributes;
    "x-list-item": LynxElementAttributes;
    "x-swiper": LynxElementAttributes;
    "x-swiper-item": LynxElementAttributes;
    "x-viewpager-ng": LynxElementAttributes;
    "x-web-view": LynxElementAttributes;
  }
}
