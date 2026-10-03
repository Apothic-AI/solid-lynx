import { For, createSignal } from "solid-js";
import { createLynxRoot, ensureLynxEnvironmentBasics } from "solid-lynx";
import type { LynxNode, LynxRoot } from "solid-lynx";

interface LynxEngine {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

interface ListItem {
  id: number;
  label: string;
}

declare const lynx: {
  getEngine(): LynxEngine;
};

function Counter(props: { onDispose: () => void }) {
  const [count, setCount] = createSignal(0);
  const [datasetReadout, setDatasetReadout] = createSignal("not read");
  const [items, setItems] = createSignal([
    { id: 1, label: "Alpha" },
    { id: 2, label: "Bravo" },
    { id: 3, label: "Charlie" },
  ]);
  const KeyedFor = For as unknown as (props: {
    each: ListItem[];
    children: (item: ListItem) => LynxNode;
  }) => LynxNode;
  let nextItemId = 4;
  const increment = () => setCount(value => value + 1);
  const active = () => count() % 2 === 1;
  const addItem = () => {
    const id = nextItemId++;
    setItems(current => [...current, { id, label: `Item ${id}` }]);
  };
  const removeFirstItem = () => setItems(current => current.slice(1));
  const reverseItems = () => setItems(current => [...current].reverse());
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
