/**
 * Test probe for the Playwright suite.
 *
 * The browser tests need to observe the Element PAPI contract rather than only
 * the DOM the web platform renders from it: flush coalescing and listener
 * registration have no DOM observable. This module wraps the main-thread PAPI
 * globals of the current Lynx-for-Web realm before any Solid root is created,
 * records what the adapter calls, and exposes PAPI-level reads of the element
 * tree.
 *
 * The probe is installed on the realm global (`__SOLID_LYNX_PROBE__`). Each
 * `<lynx-view>` runs its own bundle inside its own realm, so tests reach the
 * probe for a view through that view's main-thread iframe and every view keeps
 * an independent trace.
 */

type PapiFunction = (...args: any[]) => any;

interface PapiGlobal {
  __FlushElementTree?: PapiFunction;
  __AddEventListener?: PapiFunction;
  __RemoveEventListener?: PapiFunction;
  __GetPageElement?: PapiFunction;
  __QuerySelector?: PapiFunction;
  __GetTag?: PapiFunction;
  __GetID?: PapiFunction;
  __GetElementUniqueID?: PapiFunction;
  __GetAttributes?: PapiFunction;
  __GetAttributeNames?: PapiFunction;
  __GetAttributeByName?: PapiFunction;
  __GetDataset?: PapiFunction;
  __GetClasses?: PapiFunction;
  __GetChildren?: PapiFunction;
  __GetParent?: PapiFunction;
  __GetComputedStyleByKey?: PapiFunction;
}

export interface ListenerCall {
  op: "add" | "remove";
  name: string;
  bindType: number | undefined;
  capture: boolean | undefined;
  closureType: number | undefined;
  elementId: string | null;
  uniqueId: number;
}

export interface ElementSnapshot {
  tag: string;
  id: string | null;
  uniqueId: number;
  attributes: Record<string, string>;
  attributeNames: string[];
  inlineStyle: string | null;
  dataset: Record<string, unknown>;
  classes: string[];
  childCount: number;
  children: { tag: string; id: string | null }[];
  parentId: string | null;
}

export interface FlushMeasurement {
  /** Flushes observed while the mutations ran synchronously. */
  during: number;
  /** Flushes observed after pending microtasks and a macrotask have run. */
  total: number;
}

export interface ListenerBalance {
  elementId: string | null;
  uniqueId: number;
  name: string;
  bindType: number | undefined;
  capture: boolean | undefined;
  closureType: number | undefined;
  adds: number;
  removes: number;
}

export interface ProbeControls {
  /** Applies several property mutations in one synchronous task. */
  burst(): void;
  /** Calls the Solid root's explicit flush. */
  flush(): void;
  /** Creates a fresh root and renders the app again. */
  remount(): void;
  /** Renders into the most recently disposed root instance. */
  remountDisposedRoot(): void;
  /** Drops the recorded event log so each tap can be asserted in isolation. */
  clearEventLog(): void;
  /** Hosts a second, independent root in a component of the same page. */
  mountSecondaryRoot(): void;
  /** Disposes the second root and leaves the primary root untouched. */
  disposeSecondaryRoot(): void;
  /** Taps the binding registered by the disposed-root remount. */
  remountTapCount(): number;
  /** Runs the shared Element PAPI parity harness against this web host. */
  parityReport(): unknown;
}

export interface PapiProbe {
  readonly flushes: number;
  readonly listenerCalls: ListenerCall[];
  registerControls(controls: ProbeControls): void;
  reset(): void;
  flushCount(): number;
  snapshot(id: string): ElementSnapshot | null;
  computedStyle(id: string, key: string): string | null;
  pageChildren(): { tag: string; id: string | null }[];
  measureFlushes(): Promise<FlushMeasurement>;
  measureFlushesWithExplicitFlush(): Promise<FlushMeasurement>;
  remount(): void;
  remountDisposedRoot(): void;
  clearEventLog(): void;
  mountSecondaryRoot(): void;
  disposeSecondaryRoot(): void;
  remountTapCount(): number;
  parityReport(): unknown;
  listenerCallsFor(id: string): ListenerCall[];
  listenerCallsForUniqueId(uniqueId: number): ListenerCall[];
  listenerBalances(): ListenerBalance[];
}

const settled = () => new Promise<void>(resolve => setTimeout(resolve, 0));

export function installPapiProbe(): PapiProbe {
  const papi = globalThis as unknown as PapiGlobal;
  const controls = { current: undefined as ProbeControls | undefined };
  let flushes = 0;
  const listenerCalls: ListenerCall[] = [];

  const originalFlush = papi.__FlushElementTree;
  if (typeof originalFlush === "function") {
    papi.__FlushElementTree = (...args: unknown[]) => {
      flushes += 1;
      return originalFlush(...args);
    };
  }

  const wrapListenerApi = (name: "__AddEventListener" | "__RemoveEventListener") => {
    const original = papi[name];
    if (typeof original !== "function") return;
    const op = name === "__AddEventListener" ? "add" : "remove";
    papi[name] = (element: any, eventName: string, listener: unknown, options?: any) => {
      listenerCalls.push({
        op,
        name: eventName,
        bindType: options?.bind_type,
        capture: options?.capture,
        closureType: options?.closure_type,
        elementId: papi.__GetID?.(element) ?? element?.getAttribute?.("id") ?? null,
        uniqueId: papi.__GetElementUniqueID?.(element) ?? -1,
      });
      return original(element, eventName, listener, options);
    };
  };
  wrapListenerApi("__AddEventListener");
  wrapListenerApi("__RemoveEventListener");

  const elementById = (id: string) => {
    const page = papi.__GetPageElement?.();
    if (!page) return null;
    return papi.__QuerySelector?.(page, `#${id}`) ?? null;
  };

  const describe = (element: any): ElementSnapshot | null => {
    if (!element) return null;
    const children = (papi.__GetChildren?.(element) ?? []) as any[];
    const parent = papi.__GetParent?.(element) as any;
    return {
      tag: papi.__GetTag?.(element) ?? element.tagName.toLowerCase(),
      id: papi.__GetID?.(element) ?? null,
      uniqueId: papi.__GetElementUniqueID?.(element) ?? -1,
      attributes: papi.__GetAttributes?.(element) ?? {},
      attributeNames: papi.__GetAttributeNames?.(element) ?? [],
      inlineStyle: papi.__GetAttributeByName?.(element, "style") ?? null,
      dataset: { ...(papi.__GetDataset?.(element) ?? {}) },
      classes: papi.__GetClasses?.(element) ?? [],
      childCount: children.length,
      children: children.map(child => ({
        tag: papi.__GetTag?.(child) ?? child.tagName.toLowerCase(),
        id: child.getAttribute?.("id") ?? null,
      })),
      parentId: parent ? papi.__GetID?.(parent) ?? null : null,
    };
  };

  const measure = async (explicitFlush: boolean): Promise<FlushMeasurement> => {
    const actions = controls.current;
    if (!actions) throw new Error("probe controls are not registered yet");
    const before = flushes;
    actions.burst();
    if (explicitFlush) actions.flush();
    const during = flushes - before;
    await settled();
    return { during, total: flushes - before };
  };

  const probe: PapiProbe = {
    get flushes() {
      return flushes;
    },
    listenerCalls,
    registerControls(next) {
      controls.current = next;
    },
    reset() {
      flushes = 0;
      listenerCalls.length = 0;
    },
    flushCount: () => flushes,
    snapshot: id => describe(elementById(id)),
    computedStyle(id, key) {
      const element = elementById(id);
      if (!element) return null;
      return papi.__GetComputedStyleByKey?.(element, key) ?? null;
    },
    pageChildren() {
      const page = papi.__GetPageElement?.();
      const children = (papi.__GetChildren?.(page) ?? []) as any[];
      return children.map(child => ({
        tag: papi.__GetTag?.(child) ?? child.tagName.toLowerCase(),
        id: child.getAttribute?.("id") ?? null,
      }));
    },
    measureFlushes: () => measure(false),
    measureFlushesWithExplicitFlush: () => measure(true),
    remount() {
      controls.current?.remount();
    },
    remountDisposedRoot() {
      controls.current?.remountDisposedRoot();
    },
    clearEventLog() {
      controls.current?.clearEventLog();
    },
    mountSecondaryRoot() {
      controls.current?.mountSecondaryRoot();
    },
    disposeSecondaryRoot() {
      controls.current?.disposeSecondaryRoot();
    },
    remountTapCount() {
      return controls.current?.remountTapCount() ?? 0;
    },
    parityReport() {
      return controls.current?.parityReport();
    },
    listenerCallsFor(id) {
      const element = elementById(id);
      if (!element) return [];
      return probe.listenerCallsForUniqueId(papi.__GetElementUniqueID?.(element) ?? -1);
    },
    listenerCallsForUniqueId(uniqueId) {
      return listenerCalls.filter(call => call.uniqueId === uniqueId);
    },
    /**
     * Counts registrations and removals per element, event name, and dispatch
     * slot, so a test can assert that disposal released every listener it filed
     * and left no unpaired registration behind.
     */
    listenerBalances() {
      const balances = new Map<string, ListenerBalance>();
      for (const call of listenerCalls) {
        const key = [
          call.uniqueId,
          call.name,
          call.bindType,
          call.capture,
          call.closureType,
        ].join("|");
        let balance = balances.get(key);
        if (!balance) {
          balance = {
            elementId: call.elementId,
            uniqueId: call.uniqueId,
            name: call.name,
            bindType: call.bindType,
            capture: call.capture,
            closureType: call.closureType,
            adds: 0,
            removes: 0,
          };
          balances.set(key, balance);
        }
        if (call.op === "add") balance.adds += 1;
        else balance.removes += 1;
      }
      return [...balances.values()];
    },
  };

  (globalThis as unknown as Record<string, unknown>).__SOLID_LYNX_PROBE__ = probe;
  return probe;
}
