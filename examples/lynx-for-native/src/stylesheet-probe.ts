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
 * - The load stage is pointed at a real, served stylesheet with the argument
 *   list the v2 card measured. `[url]` alone throws `LoadStyleSheet param size
 *   should >= 2`, and every non-string second argument the v2 card tried throws
 *   `LoadStyleSheet param 1 should be String`; only `[url, "utf-8"]` returned
 *   instead of throwing. So the stage records both: the one-argument attempt
 *   first, as the measured negative result, then the two-argument call as the
 *   load that did not throw. The two-argument call is still inert: the served
 *   stylesheet holds one rule that matches nothing on the card, and the engine
 *   returns no handle either way (`null`), so nothing is owned and no lifecycle
 *   is claimed.
 * - Each stage is logged on its own line. The native console bridge drops
 *   everything after the first newline, and a stage that fails hard must not
 *   take the earlier evidence with it. The bridge is also known to deliver a
 *   line of up to 2,040 bytes intact, so the summary stage does not re-echo the
 *   calls the earlier stages already logged: it would repeat the engine's error
 *   text and push the line past that budget.
 */

import { createLynxRoot, ensureLynxEnvironmentBasics } from "@apothic-ai/solid-lynx";
import type { LynxNode, LynxRoot } from "@apothic-ai/solid-lynx";
import {
  STYLESHEET_PAPI_NAMES,
  describeFunction,
  findStyleRelatedGlobals,
  loadRealUrlCases,
  reportLine,
  safeCall,
  type ProbeCall,
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
/**
 * The second parameter `__LoadStyleSheet` requires: an encoding label.
 *
 * Not inferred from the arity. The v2 card measured it: `[url, "utf-8"]` and
 * `[url, url2]` returned `null`, while `[url]` threw "param size should >= 2" and
 * `[url, null]`, `[url, 0]`, `[url, {}]`, `[url, function(){}]`, `[url, []]` all
 * threw "param 1 should be String". `[url, url2]` is a second URL being read as a
 * label, so it says a String is accepted rather than that this one string is.
 */
const CSS_ENCODING = "utf-8";

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

/** How many calls every stage has recorded so far. */
function recordedCallCount(): number {
  return [...operations.values()].reduce((total, operation) => total + operation.calls.length, 0);
}

/**
 * The operations again, carrying only the calls recorded from `from` onward.
 *
 * A call belongs to the stage that made it. Re-reporting an earlier stage's call
 * in a later one repeats the engine's error text, and the bridge is known to
 * deliver only 2,040 bytes of a line intact — v1's own summary line was already
 * 2,023 bytes of echoed calls when this was measured.
 */
function operationCalls(from: number): ProbeOperation[] {
  let skip = from;
  return [...operations.values()].map(operation => {
    const dropped = Math.min(skip, operation.calls.length);
    skip -= dropped;
    return { ...operation, calls: operation.calls.slice(dropped) };
  });
}

/** Where the summary stage starts reading, set after the last calling stage. */
let callsBeforeSummary = 0;

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
 * Stage 4: a load pointed at a real stylesheet, with the argument list the v2
 * card measured to be acceptable.
 *
 * The only calls that can change anything, and they change this disposable
 * card: a small stylesheet with one rule that nothing on the card depends on.
 * Both calls are made, in this order, because the contrast is the evidence:
 *
 * 1. `[url]` — the one-argument form v1 shipped. It is recorded as a measured
 *    negative result: the engine requires at least two parameters.
 * 2. `[url, "utf-8"]` — the measured contract. It returned rather than threw on
 *    the v2 run, and this is the load the verifier reads as having reached the
 *    served stylesheet.
 *
 * Neither call returned a handle on the measured engine (`null`), so nothing
 * here establishes ownership. What it establishes is that a load reached
 * `probe.css`, which the one-argument attempt could not do.
 */
function probeRealLoad(): void {
  const { calls, cases } = loadRealUrlCases(scope["__LoadStyleSheet"], CSS_URL, CSS_ENCODING);
  const load = record("__LoadStyleSheet");
  load.calls.push(...calls);
  callsBeforeSummary = recordedCallCount();
  console.log(reportLine("load-real-url", {
    url: CSS_URL,
    encoding: CSS_ENCODING,
    operations: [load],
    // Named so the capture says which case is which without the reader having to
    // count array positions. The last of them is the two-argument load.
    cases,
  }));
}

/**
 * Stage 5: what was and was not exercised.
 *
 * Stated explicitly so the report cannot be read as claiming more than it did.
 *
 * Only the calls the stages after `load-missing-url` made are re-reported here,
 * and only the fields that summarise them. Echoing every call again — including
 * the engine's full error text from three earlier stages — put this line at 2,156
 * bytes on the measured engine, past the 2,040 bytes the console bridge is known
 * to deliver intact. A truncated summary is worse than a short one: it is the
 * stage that would have said what was not measured.
 */
function probeSummary(): void {
  console.log(reportLine("summary", {
    operations: operationCalls(callsBeforeSummary).filter(operation => operation.calls.length > 0),
    loadHandleReturned: hasReturnedHandle(operations.get("__LoadStyleSheet")),
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
          + " proven. The two-argument load returned without throwing, but it returned no handle,"
          + " so nothing here owns a sheet, can remove one, or shows that a rule in one was"
          + " applied.",
      },
    ],
  }));
}

/** Whether a call on the operation returned something that could be a handle. */
function hasReturnedHandle(operation: ProbeOperation | undefined): boolean {
  return (operation?.calls ?? []).some((call: ProbeCall) => {
    const kind = call.returned?.kind;
    return kind !== undefined && kind !== "null" && kind !== "undefined";
  });
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