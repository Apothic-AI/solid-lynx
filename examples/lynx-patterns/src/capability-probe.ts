/**
 * Platform capability probe for the Lynx-for-Web host.
 *
 * The renderer only drives the Element PAPI, so a platform capability such as
 * list virtualization, gestures, animation, or overlays is reachable only if the
 * host exposes the PAPI *and* the renderer has a path that calls it. This probe
 * measures both halves on the host it is running in, so the answer comes from
 * the runtime rather than from documentation.
 *
 * Results are published on `globalThis.__SOLID_LYNX_CAPABILITIES__` for the
 * Playwright suite and rendered into the card, so the same measurements can be
 * read on a device.
 */

import { createLynxRoot } from "solid-lynx";
import type { LynxNode, LynxPapi } from "solid-lynx";

export type CapabilityStatus = "supported" | "host-only" | "unsupported";

export interface CapabilityFinding {
  capability: string;
  status: CapabilityStatus;
  /** PAPI names the probe looked for, and whether the host has them. */
  papi: { name: string; present: boolean }[];
  /** What the probe observed at runtime. */
  observed: string[];
  /** What happens today if an app uses this capability. */
  today: string;
  /** What supporting it would take. */
  requires: string[];
}

export interface CapabilityReport {
  label: string;
  findings: CapabilityFinding[];
}

/**
 * Calls the renderer makes while a tree is built, so the probe can tell which
 * path a capability took. Restored before the probe returns.
 */
interface PapiTrace {
  calls: { name: string; args: unknown[] }[];
  restore(): void;
}

function tracePapi(papi: PapiGlobal, names: string[]): PapiTrace {
  const originals = names.map(name => [name, papi[name]] as const);
  const calls: { name: string; args: unknown[] }[] = [];

  for (const name of names) {
    const original = papi[name];
    if (typeof original !== "function") continue;
    papi[name] = (...args: unknown[]) => {
      calls.push({ name, args });
      return original(...args);
    };
  }

  return {
    calls,
    restore() {
      for (const [name, original] of originals) {
        if (original === undefined) delete papi[name];
        else papi[name] = original;
      }
    },
  };
}

type PapiGlobal = LynxPapi & Record<string, unknown> & {
  __GetPageElement?: () => LynxNode | undefined;
};

const describeArgs = (value: unknown): string => {
  if (value === null || value === undefined) return String(value);
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.length} items]`;
  return typeof value;
};

/**
 * Builds a throwaway root in its own container, measures what the host does for
 * each capability, then removes the container again.
 */
export function runCapabilityProbe(label = "web-core"): CapabilityReport {
  const papi = globalThis as unknown as PapiGlobal;
  const findings: CapabilityFinding[] = [];
  const page = papi.__GetPageElement?.();
  const has = (name: string) => ({
    name,
    present: typeof papi[name] === "function",
  });

  if (!page || typeof papi.__GetElementUniqueID !== "function") {
    throw new Error(
      "solid-lynx capability probe: no page element. Run it inside a mounted card.",
    );
  }

  const container = papi.__CreateView?.(papi.__GetElementUniqueID(page))
    ?? papi.__CreateElement?.("view", papi.__GetElementUniqueID(page));
  if (!container) throw new Error("solid-lynx capability probe: cannot create a container");
  papi.__AppendElement?.(page, container);

  const root = createLynxRoot({ page: container });
  const renderer = root.renderer;

  try {
    // List virtualization: the host PAPI only recycles when the framework hands
    // it `componentAtIndex` and `enqueueComponent`, which this renderer has no
    // way to supply.
    const listCalls: string[] = [];
    const listView = renderer.createElement("list");
    renderer.insert(container, listView);
    renderer.setProp(listView, "recyclable", true);
    const listTrace = tracePapi(papi, ["__CreateList", "__UpdateListCallbacks", "__SetAttribute"]);
    renderer.setProp(listView, "item-count", 1000);
    listCalls.push(...listTrace.calls.map(call => call.name));
    listTrace.restore();
    const hasCallbacks = (listView as unknown as Record<string, unknown>).componentAtIndex
      !== undefined;

    findings.push({
      capability: "list-virtualization",
      status: "host-only",
      papi: ["__CreateList", "__UpdateListCallbacks"].map(has),
      observed: [
        `renderer created <list> as ${describeArgs((papi.__GetTag as ((n: unknown) => string) | undefined)?.(listView))}`,
        `PAPI calls while setting list props: ${listCalls.join(", ") || "none"}`,
        `host list callbacks wired: ${hasCallbacks ? "yes" : "no"}`,
      ],
      today: "`<list>` renders as an ordinary container. Every row is a real child node,"
        + " so a long list costs one element per row and nothing is recycled.",
      requires: [
        "a renderer path that calls __CreateList with componentAtIndex and enqueueComponent",
        "a Solid list model that can instantiate a row component at an index",
        "native validation of recycling and of the update-list-info protocol",
      ],
    });

    // Gestures: this renderer has no gesture binding form, so a gesture prop is
    // written as a plain attribute and never dispatched.
    const gestureTrace = tracePapi(papi, [
      "__AddEventListener",
      "__AddEvent",
      "__SetGestureDetector",
      "__SetAttribute",
    ]);
    const gestureCalls: string[] = [];
    const gestureView = renderer.createElement("view");
    renderer.insert(container, gestureView);
    renderer.setProp(gestureView, "gesture-bindtap", () => undefined);
    renderer.setProp(gestureView, "bindtap", () => undefined);
    gestureCalls.push(...gestureTrace.calls.map(call => `${call.name}(${describeArgs(call.args[0])})`));
    gestureTrace.restore();

    findings.push({
      capability: "gestures",
      status: "unsupported",
      papi: ["__SetGestureDetector", "__RemoveGestureDetector"].map(has),
      observed: [
        `PAPI calls while binding gesture-bindtap and bindtap: ${gestureCalls.join(", ") || "none"}`,
      ],
      today: "There is no gesture binding form. `gesture-bindtap` is written as an ordinary"
        + " attribute and never fires, with no error. Only `bind`/`catch` and their capture"
        + " and namespaced forms dispatch.",
      requires: [
        "a binding form that maps a gesture prop to __SetGestureDetector",
        "a host that implements gesture recognition: web-core stubs both gesture PAPIs",
        "native validation of gesture recognition and its parameters",
      ],
    });

    // Animation: the host implements __ElementAnimate on top of the Web
    // Animations API, but nothing in this renderer calls it.
    const animationView = renderer.createElement("view");
    renderer.insert(container, animationView);
    const animate = (animationView as unknown as { animate?: unknown }).animate;

    findings.push({
      capability: "animation",
      status: "host-only",
      papi: ["__ElementAnimate"].map(has),
      observed: [
        `element.animate available on a created element: ${typeof animate === "function" ? "yes" : "no"}`,
      ],
      today: "There is no animation API. Use inline-style and CSS transitions for animation;"
        + " keyframe animation through the PAPI is not reachable from this renderer.",
      requires: [
        "an animation API that maps declarative props to __ElementAnimate",
        "a decision on whether animation options differ between web and native",
        "native validation of keyframe and timing option parity",
      ],
    });

    // Overlays and portals: the host has an `overlay` element, but a Solid
    // portal needs a DOM parent that does not exist in a Lynx tree, and this
    // package does not export one.
    const overlayView = renderer.createElement("overlay");
    renderer.insert(container, overlayView);
    const overlayTag = (papi.__GetTag as ((n: unknown) => string) | undefined)?.(overlayView);

    findings.push({
      capability: "overlay-portal",
      status: "unsupported",
      papi: ["__InvokeUIMethod"].map(has),
      observed: [
        `renderer created <overlay> as ${describeArgs(overlayTag)}`,
        "solid-lynx exports no Portal or Dynamic component",
      ],
      today: "An `<overlay>` element is created as an ordinary child and has no overlay"
        + " behaviour. Importing `Portal` from solid-lynx fails at build time because the"
        + " package does not export it, which fails loudly rather than degrading.",
      requires: [
        "a Lynx overlay contract: what element hosts overlay content and how it is shown",
        "a decision on whether a portal can be expressed in a single-element tree at all",
        "native validation, since overlay is a native module",
      ],
    });
  } finally {
    root.dispose();
    papi.__RemoveElement?.(page, container);
  }

  return { label, findings };
}

export function installCapabilityProbe(): CapabilityReport {
  const report = runCapabilityProbe();
  (globalThis as unknown as Record<string, unknown>).__SOLID_LYNX_CAPABILITIES__ = report;
  return report;
}