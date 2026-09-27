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
export { eventBindType, parseEventProp } from "./events.js";
export { createLynxRoot, renderLynxPage } from "./root.js";
export type { LynxRoot, LynxRootOptions } from "./root.js";
export { ensureLynxEnvironmentBasics, initializeLynxRootContext } from "./universal.js";

export const version = "0.1.0";
