/**
 * Native stylesheet PAPI probe.
 *
 * This card measures one thing: what the A03 actually does with
 * `__LoadStyleSheet`, `__AdoptStyleSheet`, and `__ReplaceStyleSheets`. It is a
 * measurement, not an integration. Nothing here is wired into the renderer, no
 * stylesheet is emulated for the web host, and no lifecycle is claimed beyond
 * what the runtime visibly does.
 *
 * The rules the probe holds itself to:
 *
 * - Nothing is inferred from a name. Every field in a report comes from reading
 *   the runtime's own binding: `typeof`, `fn.length`, `fn.name`, `String(fn)`.
 *   `fn.length` is the declared parameter count and is recorded as evidence, not
 *   read as a signature.
 * - Only non-destructive calls are made. Calling with no arguments cannot
 *   succeed and so cannot mutate anything, and a load that is pointed at a URL
 *   that does not resolve can only fail. Adopting or replacing a stylesheet
 *   needs a stylesheet handle this probe has no contract for, so it is not
 *   attempted; see `unmeasured` in the summary stage.
 * - Each stage is logged on its own line. The native console bridge drops
 *   everything after the first newline, and a stage that fails hard must not
 *   take the earlier evidence with it.
 */

import { createLynxRoot, ensureLynxEnvironmentBasics } from "@apothic-ai/solid-lynx";
import type { LynxNode, LynxRoot } from "@apothic-ai/solid-lynx";
import {
  STYLESHEET_PAPI_NAMES,
  describeFunction,
  findStyleRelatedGlobals,
  reportLine,
  safeCall,
  type ProbeOperation,
} from "./stylesheet-probe-report.js";

interface LynxEngine {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

declare const lynx: {
  getEngine(): LynxEngine;
};

/** Served next to the bundle by the loopback server the device run uses. */
const CSS_URL = "http://127.0.0.1:8099/probe.css";
/** A path the loopback server cannot resolve, so the load has to fail. */
const MISSING_CSS_URL = "http://127.0.0.1:8099/__probe_missing__.css";

const scope = globalThis as unknown as Record<string, unknown>;
const operations = new Map<string, ProbeOperation>();

ensureLynxEnvironmentBasics();

function record(name: string): ProbeOperation {
  const existing = operations.get(name);
  if (existing) return existing;
  const operation: ProbeOperation = {
    name,
    function: describeFunction(scope[name]),
    calls: [],
  };
  operations.set(name, operation);
  return operation;
}

/**
 * Stage 1: what the host exposes.
 *
 * No call is made, so nothing here can mutate the card.
 */
function probeInventory(): void {
  for (const name of STYLESHEET_PAPI_NAMES) record(name);
  console.log(reportLine("inventory", {
    relatedGlobals: findStyleRelatedGlobals(globalThis),
    operations: [...operations.values()],
  }));
}

/**
 * Stage 2: what each binding does when it cannot succeed.
 *
 * Calling with no arguments cannot produce a stylesheet, so the result is
 * either an error naming a required argument or a value. Either way the card is
 * unchanged, and the error text is the only engine-authored description of what
 * the binding requires that exists without a stylesheet handle.
 */
function probeNoArguments(): void {
  for (const name of STYLESHEET_PAPI_NAMES) {
    record(name).calls.push(safeCall(scope[name], []));
  }
  console.log(reportLine("no-arguments", { operations: [...operations.values()] }));
}

/**
 * Stage 3: a load pointed at a URL that cannot resolve.
 *
 * The load has to fail. This separates "the binding accepts a URL-shaped
 * argument" from "the binding rejects its argument" without letting anything
 * load.
 */
function probeFailedLoad(): void {
  record("__LoadStyleSheet").calls.push(
    safeCall(scope["__LoadStyleSheet"], [MISSING_CSS_URL]),
  );
  console.log(reportLine("load-missing-url", {
    operations: [operations.get("__LoadStyleSheet")],
  }));
}

/**
 * Stage 4: a load pointed at a real stylesheet.
 *
 * The only call that can change anything, and it changes this disposable card:
 * a small stylesheet with one rule that nothing on the card depends on. What it
 * proves is whether the call returns a handle at all and what that handle looks
 * like, which is the first step to any ownership contract.
 */
function probeRealLoad(): void {
  record("__LoadStyleSheet").calls.push(safeCall(scope["__LoadStyleSheet"], [CSS_URL]));
  console.log(reportLine("load-real-url", {
    operations: [operations.get("__LoadStyleSheet")],
  }));
}

/**
 * Stage 5: what was and was not exercised.
 *
 * Stated explicitly so the report cannot be read as claiming more than it did.
 */
function probeSummary(): void {
  console.log(reportLine("summary", {
    operations: [...operations.values()],
    unmeasured: [
      {
        operation: "__AdoptStyleSheet",
        reason: "Adopting needs a stylesheet handle. Nothing in this probe produced one,"
          + " so the call was not attempted: fabricating an argument could mutate the card"
          + " and the result would say nothing about a real handle.",
      },
      {
        operation: "__ReplaceStyleSheets",
        reason: "Replacing needs the ownership contract for a stylesheet set: what a member of"
          + " that set is, and who owns it. Without it, any call would either be a no-op that"
          + " proves nothing or would remove the card's own styles.",
      },
      {
        operation: "lifecycle",
        reason: "No ordering, scope, or ownership relationship between the three operations was"
          + " proven, because at most one of them was exercisable.",
      },
    ],
  }));
}

function renderCard(): void {
  const host = scope as {
    __GetPageElement?: () => LynxNode | null | undefined;
    __CreatePage?: (componentId: string, cssId: number) => LynxNode;
  };
  const page = host.__GetPageElement?.() ?? host.__CreatePage?.("0", 0);
  if (!page) throw new Error("solid-lynx stylesheet probe: no page element");

  let root: LynxRoot | undefined = createLynxRoot({ page });

  root.render(() => {
    const card = root!.renderer.createElement("view");
    const label = root!.renderer.createElement("text");
    root!.renderer.setProp(card, "id", "stylesheet-probe");
    root!.renderer.setProp(label, "id", "stylesheet-probe-label");
    root!.renderer.insert(label, "Native stylesheet PAPI probe");
    root!.renderer.insert(card, label);
    return card;
  });

  probeInventory();
  probeNoArguments();
  probeFailedLoad();
  probeRealLoad();
  probeSummary();

  console.log(reportLine("done", { status: "all stages logged" }));
}

const engine = lynx.getEngine();
engine.addEventListener("__RenderPage", renderCard);
engine.addEventListener("__DestroyLifetime", () => {
  // The page owns the card for the life of the Explorer session; the probe holds
  // no host resource of its own that has to be released here.
});