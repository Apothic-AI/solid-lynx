export {
  createComponent,
  createElement,
  createTextNode,
  effect,
  insert,
  insertNode,
  memo,
  mergeProps,
  render,
  setProp,
  spread,
  use,
} from "./universal.js";

export {
  ErrorBoundary,
  For,
  Index,
  Match,
  Show,
  Suspense,
  SuspenseList,
  Switch,
} from "solid-js";

export { createLynxRenderer } from "./renderer.js";
export type { LynxRenderer } from "./renderer.js";
export {
  createGlobalLynxHost,
  createLynxHost,
  createLynxPage,
  getLynxPageId,
} from "./lynx-host.js";
export type { GlobalLynxHostOptions, LynxPapi } from "./lynx-host.js";
export type { LynxHost, LynxNode, RendererOptions } from "./host.js";
export {
  eventBindType,
  eventListenerOptions,
  isCaptureEvent,
  parseEventProp,
} from "./events.js";
export type { EventListenerOptions, ParsedEventProp } from "./events.js";
export { createLynxRoot, renderLynxPage } from "./root.js";
export type { LynxRoot, LynxRootOptions } from "./root.js";
export { createLynxRef } from "./refs.js";
export type { LynxRef, LynxRefCallback, LynxRefObject } from "./refs.js";
export type { LynxList, LynxListOptions, LynxListRow } from "./list.js";
export type { LynxListCallbacks } from "./host.js";
export { ensureLynxEnvironmentBasics, initializeLynxRootContext } from "./universal.js";
export type {
  JSX,
  LynxBoundEventHandler,
  LynxChild,
  LynxCustomElementAttributes,
  LynxDatasetValue,
  LynxElementAttributes,
  LynxEvent,
  LynxEventDetail,
  LynxEventHandler,
  LynxEventPropHandler,
  LynxEventTarget,
  LynxImageAttributes,
  LynxInputAttributes,
  LynxScrollViewAttributes,
  LynxStyle,
  LynxStyleProperties,
  LynxTextAttributes,
  LynxTextareaAttributes,
} from "./jsx-types.js";

export const version = "0.1.0";
