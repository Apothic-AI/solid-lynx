import { For, Show, createSignal } from "solid-js";
import { createLynxRoot, ensureLynxEnvironmentBasics } from "solid-lynx";
import type { LynxNode, LynxRoot } from "solid-lynx";
import { installPapiProbe } from "./papi-probe.js";

interface LynxEngine {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

interface ListItem {
  id: number;
  label: string;
}

interface TapEvent {
  currentTarget?: { dataset?: Record<string, string | number> };
}

declare const lynx: {
  getEngine(): LynxEngine;
};

const KeyedFor = For as unknown as (props: {
  each: ListItem[];
  children: (item: ListItem) => LynxNode;
}) => LynxNode;
const ToggleShow = Show as unknown as (props: {
  when: boolean;
  children: () => LynxNode;
}) => LynxNode;

const probe = installPapiProbe();

const buttonStyle = {
  display: "flex",
  "align-items": "center",
  "justify-content": "center",
  "min-height": "48px",
  "min-width": "180px",
  padding: "12px 16px",
  "background-color": "#334155",
  color: "#ffffff",
};

function Counter(props: { onDispose: () => void }) {
  const [count, setCount] = createSignal(0);
  const [datasetReadout, setDatasetReadout] = createSignal("not read");
  const [items, setItems] = createSignal([
    { id: 1, label: "Alpha" },
    { id: 2, label: "Bravo" },
    { id: 3, label: "Charlie" },
  ]);
  let nextItemId = 4;
  const increment = () => setCount(value => value + 1);
  const active = () => count() % 2 === 1;
  const addItem = () => {
    const id = nextItemId++;
    setItems(current => [...current, { id, label: `Item ${id}` }]);
  };
  const removeFirstItem = () => setItems(current => current.slice(1));
  const reverseItems = () => setItems(current => [...current].reverse());
  const readDataset = (event: TapEvent) => {
    setDatasetReadout(String(event.currentTarget?.dataset?.count ?? "missing"));
  };

  return (
    <view
      id="counter"
      style={{
        display: "flex",
        "flex-direction": "column",
        gap: "8px",
        padding: "8px",
      }}
    >
      <text id="count" aria-live="polite">{`Counter: ${count()}`}</text>
      <view
        id="increment"
        role="button"
        aria-label="Increment counter"
        bindtap={increment}
        style={{ ...buttonStyle, "background-color": "#166534" }}
      >
        <text>Increment</text>
      </view>
      <view
        id="alias-increment"
        role="button"
        aria-label="Increment counter with onClick"
        onClick={increment}
        style={{ ...buttonStyle, "background-color": "#1d4ed8" }}
      >
        <text>Increment with onClick</text>
      </view>
      <view
        id="status"
        role="status"
        bindtap={readDataset}
        class={`status ${active() ? "status-active" : "status-ready"}`}
        data-count={String(count())}
        style={{
          "background-color": active() ? "#9a3412" : "#166534",
          color: "#ffffff",
          padding: "8px",
        }}
      >
        <text>{`Status: ${active() ? "active" : "ready"} (${count()})`}</text>
      </view>
      <text id="dataset-readout">{`Dataset: ${datasetReadout()}`}</text>
      <view id="dispose" role="button" aria-label="Dispose counter" bindtap={props.onDispose} style={buttonStyle}>
        <text>Dispose</text>
      </view>
      <view id="list-controls">
        <view id="add-item" role="button" bindtap={addItem}>
          <text>Add item</text>
        </view>
        <view id="remove-first-item" role="button" bindtap={removeFirstItem}>
          <text>Remove first item</text>
        </view>
        <view id="reverse-items" role="button" bindtap={reverseItems}>
          <text>Reverse items</text>
        </view>
      </view>
      <view id="items">
        <KeyedFor each={items()} children={item => <text id={`item-${item.id}`}>{item.label}</text>} />
      </view>
    </view>
  );
}

/**
 * Ordinary attributes, inline styles, datasets, and boolean properties. The
 * step signal walks the target element through the states the browser suite
 * inspects, and the burst signal is written several times in one synchronous
 * task so flush coalescing can be measured.
 */
function Properties(props: { step: number; burst: number }) {
  return (
    <view id="properties">
      <text id="properties-step">{`Properties step ${props.step} burst ${props.burst}`}</text>
      <view
        id="properties-target"
        role="note"
        aria-label={props.step === 2 ? undefined : `Property target ${props.step}-${props.burst}`}
        data-kind={props.step === 2 ? undefined : props.step === 0 ? "initial" : "updated"}
        data-burst={String(props.burst)}
        disabled={props.step !== 1}
        checked={props.step !== 2}
        class={props.burst === 0 ? "target" : `target target-${props.burst}`}
        style={
          props.step === 1
            ? "background-color: #1d4ed8; color: #ffffff"
            : {
              "background-color": props.burst % 2 === 0 ? "#0f172a" : "#7c2d12",
              color: "#ffffff",
              padding: `${4 + props.burst * 2}px`,
            }
        }
      >
        <text>{`target ${props.step}-${props.burst}`}</text>
      </view>
    </view>
  );
}

/**
 * Event dispatch, propagation, and binding lifetime. Handlers append to a log
 * that the browser suite reads back through `#event-log`.
 */
function Events() {
  const [log, setLog] = createSignal<string[]>([]);
  const [mode, setMode] = createSignal<"first" | "second" | "none">("first");
  const [nested, setNested] = createSignal(true);
  const record = (entry: string) => setLog(current => [...current, entry]);
  const first = () => record("replace-first");
  const second = () => record("replace-second");
  const replaced = () => (mode() === "none" ? undefined : mode() === "first" ? first : second);
  const cycleMode = () => setMode(current => (current === "first" ? "second" : current === "second" ? "none" : "first"));
  const toggleNested = () => setNested(value => !value);

  return (
    <view id="events">
      <text id="event-log">{`Events: ${log().join(" | ")}`}</text>

      <view id="event-bubble-parent" bindtap={() => record("bubble-parent")}>
        <view id="event-bubble-child" role="button" bindtap={() => record("bubble-child")}>
          <text>bubble child</text>
        </view>
      </view>

      <view id="event-catch-parent" bindtap={() => record("catch-parent")}>
        <view id="event-catch-child" role="button" catchtap={() => record("catch-child")}>
          <text>catch child</text>
        </view>
      </view>

      <view id="event-capture-parent" capture-bind:tap={() => record("capture-parent")}>
        <view id="event-capture-child" role="button" bindtap={() => record("capture-child")}>
          <text>capture child</text>
        </view>
      </view>

      <view id="event-capture-catch-parent" capture-catch:tap={() => record("capture-catch-parent")}>
        <view id="event-capture-catch-child" role="button" bindtap={() => record("capture-catch-child")}>
          <text>capture catch child</text>
        </view>
      </view>

      <view id="event-global-host" global-bind:tap={() => record("global-host")}>
        <view id="event-global-child" role="button" bindtap={() => record("global-child")}>
          <text>global child</text>
        </view>
      </view>

      <view id="event-namespace-parent" main-thread:bindtap={() => record("namespace-parent")}>
        <view id="event-namespace-child" role="button" main-thread:bindtap={() => record("namespace-child")}>
          <text>namespaced child</text>
        </view>
      </view>

      <view id="event-replace-parent" bindtap={() => record("replace-parent")}>
        <view id="event-replace-target" role="button" bindtap={replaced()}>
          <text>{`replacement target (${mode()})`}</text>
        </view>
      </view>

      <view id="event-nested-host">
        <view id="event-nested-toggle" role="button" bindtap={toggleNested}>
          <text>Toggle nested subtree</text>
        </view>
        <ToggleShow
          when={nested()}
          children={() => (
            <view id="event-nested" role="button" bindtap={() => record("nested")}>
              <text>nested child</text>
            </view>
          )}
        />
      </view>

      <view id="event-cycle-mode" role="button" bindtap={cycleMode}>
        <text>Cycle replacement mode</text>
      </view>
    </view>
  );
}

interface AppProps {
  onDispose: () => void;
  registerBurst: (burst: () => void) => void;
}

function App(props: AppProps) {
  const [step, setStep] = createSignal(0);
  const [burst, setBurst] = createSignal(0);

  const advance = () => setStep(value => (value + 1) % 3);
  const burstProperties = () => {
    setBurst(1);
    setBurst(2);
    setBurst(3);
  };

  props.registerBurst(burstProperties);

  return (
    <view id="app">
      <Counter onDispose={props.onDispose} />
      <Properties step={step()} burst={burst()} />
      <view id="properties-controls">
        <view id="properties-advance" role="button" bindtap={advance} style={buttonStyle}>
          <text>Advance properties</text>
        </view>
        <view id="properties-burst" role="button" bindtap={burstProperties} style={buttonStyle}>
          <text>Burst properties</text>
        </view>
      </view>
      <Events />
    </view>
  );
}

ensureLynxEnvironmentBasics();

const engine = lynx.getEngine();
let root: LynxRoot | undefined;
let disposedRoot: LynxRoot | undefined;
let burstProperties: (() => void) | undefined;

function renderPage(): void {
  if (root) return;

  root = createLynxRoot({
    componentId: "0",
    cssId: 0,
    transformEventNames: true,
  });
  root.render(() => (
    <App
      onDispose={disposePage}
      registerBurst={burst => {
        burstProperties = burst;
      }}
    />
  ));
  probe.registerControls({
    burst: () => burstProperties?.(),
    flush: () => root?.flush(),
    remount: () => renderPage(),
    remountDisposedRoot: () => {
      disposedRoot?.render(() => (
        <view id="remounted-root">
          <text>remounted</text>
        </view>
      ));
    },
  });
}

function disposePage(): void {
  if (!root) return;
  disposedRoot = root;
  root.dispose();
  root = undefined;
}

function destroyLifetime(): void {
  disposePage();
  engine.removeEventListener("__RenderPage", renderPage);
  engine.removeEventListener("__DestroyLifetime", destroyLifetime);
}

engine.addEventListener("__RenderPage", renderPage);
engine.addEventListener("__DestroyLifetime", destroyLifetime);