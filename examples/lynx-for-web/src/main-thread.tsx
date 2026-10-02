import { createSignal } from "solid-js";
import { createLynxRoot, ensureLynxEnvironmentBasics } from "solid-lynx";
import type { LynxRoot } from "solid-lynx";

interface LynxEngine {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

declare const lynx: {
  getEngine(): LynxEngine;
};

function Counter(props: { onDispose: () => void }) {
  const [count, setCount] = createSignal(0);
  const [datasetReadout, setDatasetReadout] = createSignal("not read");
  const increment = () => setCount(value => value + 1);
  const active = () => count() % 2 === 1;
  const readDataset = (event: {
    currentTarget?: { dataset?: { count?: string | number } };
  }) => {
    setDatasetReadout(String(event.currentTarget?.dataset?.count ?? "missing"));
  };

  return (
    <view
      id="app"
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
        style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          "min-height": "48px",
          "min-width": "180px",
          padding: "12px 16px",
          "background-color": "#166534",
          color: "#ffffff",
        }}
      >
        <text>Increment</text>
      </view>
      <view
        id="alias-increment"
        role="button"
        aria-label="Increment counter with onClick"
        onClick={increment}
        style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          "min-height": "48px",
          "min-width": "180px",
          padding: "12px 16px",
          "background-color": "#1d4ed8",
          color: "#ffffff",
        }}
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
      <view
        id="dispose"
        role="button"
        aria-label="Dispose counter"
        bindtap={props.onDispose}
        style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          "min-height": "48px",
          "min-width": "180px",
          padding: "12px 16px",
          "background-color": "#475569",
          color: "#ffffff",
        }}
      >
        <text>Dispose</text>
      </view>
    </view>
  );
}

ensureLynxEnvironmentBasics();

const engine = lynx.getEngine();
let root: LynxRoot | undefined;

function renderPage(): void {
  if (root) return;

  root = createLynxRoot({
    componentId: "0",
    cssId: 0,
    transformEventNames: true,
  });
  root.render(() => <Counter onDispose={disposePage} />);
}

function disposePage(): void {
  root?.dispose();
  root = undefined;
}

function destroyLifetime(): void {
  disposePage();
  engine.removeEventListener("__RenderPage", renderPage);
  engine.removeEventListener("__DestroyLifetime", destroyLifetime);
}

engine.addEventListener("__RenderPage", renderPage);
engine.addEventListener("__DestroyLifetime", destroyLifetime);
