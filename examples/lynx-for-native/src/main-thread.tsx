import { createSignal } from "solid-js";
import { createLynxRoot, ensureLynxEnvironmentBasics } from "@apothic-ai/solid-lynx";
import { runElementPapiParity } from "@apothic-ai/solid-lynx/parity";
import type { LynxNode, LynxPapi, LynxRoot } from "@apothic-ai/solid-lynx";

interface LynxEngine {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

declare const lynx: {
  getEngine(): LynxEngine;
};

ensureLynxEnvironmentBasics();

const engine = lynx.getEngine();

/**
 * The page element this card renders into.
 *
 * On a real native host `__GetPageElement()` exists but returns `null` until a
 * page has been created, so the card creates one through the documented
 * `__CreatePage(componentId, cssId)` PAPI on first run. That is the same call
 * `createLynxRoot` makes when no `page` is supplied. The web host returns its
 * page from `__GetPageElement()` directly, and an integration that owns its own
 * root can still publish one as `globalThis.__SOLID_LYNX_ROOT_ELEMENT__`.
 */
function resolveRootElement(): LynxNode {
  const host = globalThis as unknown as {
    __GetPageElement?: () => LynxNode | null | undefined;
    __CreatePage?: (componentId: string, cssId: number) => LynxNode;
    __SOLID_LYNX_ROOT_ELEMENT__?: LynxNode;
  };
  const existing = host.__GetPageElement?.();
  if (existing) return existing;
  if (host.__SOLID_LYNX_ROOT_ELEMENT__) return host.__SOLID_LYNX_ROOT_ELEMENT__;
  if (typeof host.__CreatePage === "function") {
    return host.__CreatePage("0", 0);
  }
  throw new Error(
    "solid-lynx: no root element for the native card. This host exposes neither"
    + " __GetPageElement() nor __CreatePage(); publish the element the card renders into as"
    + " globalThis.__SOLID_LYNX_ROOT_ELEMENT__ before this module runs.",
  );
}

/**
 * The card body.
 *
 * Built through the renderer API instead of JSX on purpose: this card exists to
 * report on the host's Element PAPI surface, and `examples/lynx-for-web` is the
 * JSX reference. Driving the renderer directly keeps the parity card readable
 * as a list of the calls it makes.
 *
 * It still covers the paths a device run has to prove: create, mount, a
 * signal-driven text update, a `bindtap` binding, and disposal.
 */
function renderParityCard(root: LynxRoot): void {
  const [count, setCount] = createSignal(0);
  const { renderer } = root;

  // Native Lynx lays text out inside a <text> element, so the card wraps each
  // string the way a compiled Solid text node does.
  const textElement = (id: string, value: string | (() => string)): LynxNode => {
    const text = renderer.createElement("text");
    renderer.setProp(text, "id", id);
    renderer.insert(text, value);
    return text;
  };

  root.render(() => {
    const card = renderer.createElement("view");
    const increment = renderer.createElement("view");

    renderer.setProp(card, "id", "parity-card");
    renderer.setProp(card, "style", "display: flex; flex-direction: column; padding: 16px;");
    renderer.setProp(increment, "id", "parity-increment");
    renderer.setProp(increment, "style", "padding: 12px; background-color: #334155; color: #ffffff;");
    renderer.setProp(increment, "bindtap", () => setCount(value => value + 1));
    renderer.insert(increment, textElement("parity-increment-label", "Increment"));
    renderer.insert(card, increment);

    // The text is a reactive accessor, which is what a compiled Solid text node
    // compiles to, so this is the same update path JSX produces.
    renderer.insert(card, textElement("parity-count", () => `Native parity count: ${count()}`));

    return card;
  });
}

let root: LynxRoot | undefined;

function renderCard(): void {
  if (root) return;

  const page = resolveRootElement();
  // The same harness the web card runs, so the two reports can be compared row
  // by row in docs/parity-checklist.md. It is logged on one line because the
  // native console bridge drops everything after the first newline.
  const report = runElementPapiParity({ label: "native", page });
  console.log(`[solid-lynx parity] ${JSON.stringify(report)}`);

  root = createLynxRoot({ page, transformEventNames: true });
  renderParityCard(root);
  const { __GetChildren } = globalThis as unknown as {
    __GetChildren?: (node: LynxNode) => LynxNode[] | null;
  };
  console.log(`[solid-lynx native] card rendered into page with ${
    String(__GetChildren?.(page)?.length ?? "unknown")
  } child(ren)`);
}

function destroyCard(): void {
  root?.dispose();
  root = undefined;
}

engine.addEventListener("__RenderPage", renderCard);
engine.addEventListener("__DestroyLifetime", destroyCard);