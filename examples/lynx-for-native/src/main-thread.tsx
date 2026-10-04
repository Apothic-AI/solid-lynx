import { createSignal } from "solid-js";
import { createLynxRoot, ensureLynxEnvironmentBasics } from "solid-lynx";
import { runElementPapiParity } from "solid-lynx/parity";
import type { LynxNode, LynxPapi, LynxRoot } from "solid-lynx";

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
 * The element this card renders into.
 *
 * This is the one wiring step that has not been run against a real native host
 * yet, so it fails loudly instead of guessing: `__GetPageElement()` is what the
 * web host provides, and a native integration can publish its own root element
 * as `globalThis.__SOLID_LYNX_ROOT_ELEMENT__` before the card is evaluated.
 * `docs/building.md` records what a device run has to confirm here.
 */
function resolveRootElement(): LynxNode {
  const host = globalThis as unknown as {
    __GetPageElement?: () => LynxNode | undefined;
    __SOLID_LYNX_ROOT_ELEMENT__?: LynxNode;
  };
  const element = host.__GetPageElement?.() ?? host.__SOLID_LYNX_ROOT_ELEMENT__;
  if (!element) {
    throw new Error(
      "solid-lynx: no root element for the native card. Provide the element the card renders"
      + " into as globalThis.__SOLID_LYNX_ROOT_ELEMENT__ before this module runs.",
    );
  }
  return element;
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

  root.render(() => {
    const card = root.renderer.createElement("view");
    const label = root.renderer.createTextNode("Native parity count: 0");
    const increment = root.renderer.createElement("view");

    root.renderer.setProp(card, "id", "parity-card");
    root.renderer.setProp(increment, "id", "parity-increment");
    root.renderer.setProp(increment, "bindtap", () => setCount(value => value + 1));
    root.renderer.insert(increment, root.renderer.createTextNode("Increment"));
    root.renderer.insert(card, label);
    root.renderer.insert(card, increment);

    // The text is a reactive accessor, which is what a compiled Solid text node
    // compiles to, so this is the same update path JSX produces.
    root.renderer.insert(card, () => `Native parity count: ${count()}`);

    return card;
  });
}

let root: LynxRoot | undefined;

function renderCard(): void {
  if (root) return;

  const page = resolveRootElement();
  // The same harness the web card runs, so the two reports can be compared row
  // by row in docs/parity-checklist.md.
  const report = runElementPapiParity({ label: "native", page });
  console.log(`[solid-lynx parity] ${JSON.stringify(report, null, 2)}`);

  root = createLynxRoot({ page, transformEventNames: true });
  renderParityCard(root);
}

function destroyCard(): void {
  root?.dispose();
  root = undefined;
}

engine.addEventListener("__RenderPage", renderCard);
engine.addEventListener("__DestroyLifetime", destroyCard);