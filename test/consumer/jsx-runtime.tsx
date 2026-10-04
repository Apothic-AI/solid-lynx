import { createSignal } from "solid-js";
import type {
  LynxDatasetValue,
  LynxElementAttributes,
  LynxEvent,
  LynxEventHandler,
  LynxEventPropHandler,
  LynxNode,
} from "solid-lynx";

const [count, setCount] = createSignal(0);
const onTap: LynxEventHandler = event => {
  const id: string | null = event.target.id;
  const value: LynxDatasetValue | undefined = event.currentTarget?.dataset.count;
  const offset: LynxDatasetValue = event.detail.offset;
  setCount(current => current + 1);
  void [id, value, offset];
};

const onBoundTap: LynxEventPropHandler = [
  (_data: unknown, event: LynxEvent) => {
    const eventType: string = event.type;
    void eventType;
  },
  "consumer",
];

let viewRef: LynxNode | undefined;

export function ConsumerApp() {
  return (
    <view
      id="counter"
      ref={element => {
        viewRef = element;
      }}
      data-count={count()}
      data-metadata={{ source: "consumer", active: true }}
      aria-label="Counter"
      disabled={false}
      bindtap={onTap}
    >
      <text
        style={{
          "font-size": "18px",
          "background-color": "#123456",
          "--consumer-accent": "#abcdef",
        }}
        onClick={onTap}
        main-thread:bindtap={onBoundTap}
      >
        {count()}
      </text>
      <image src="/counter.png" mode="aspectFit" />
      <scroll-view scroll-orientation="vertical" enable-scroll bindscroll={onTap}>
        <text>Scrollable content</text>
      </scroll-view>
      <x-meter value={count()} />
    </view>
  );
}

export function InvalidConsumerExamples() {
  return (
    <>
      {/* @ts-expect-error unknown Lynx tags need an explicit custom-element declaration */}
      <not-a-lynx-tag />
      {/* @ts-expect-error unknown attributes are rejected on built-in tags */}
      <view unknownAttribute="nope" />
      {/* @ts-expect-error boolean PAPI properties do not accept strings */}
      <view disabled="yes" />
      {/* @ts-expect-error style objects use checked CSS properties */}
      <view style={{ "not-a-css-property": "nope" }} />
      {/* @ts-expect-error event bindings must be callbacks or [callback, data] */}
      <view bindtap={42} />
      {/* @ts-expect-error refs point at Lynx PAPI nodes, not browser DOM elements */}
      <view ref={(element: HTMLDivElement) => void element} />
      {/* @ts-expect-error custom element props are typed by module augmentation */}
      <x-meter value="not a number" />
    </>
  );
}

const invalidDataset: LynxElementAttributes = {
  // @ts-expect-error datasets must be serializable across Lynx runtimes
  "data-invalid": Symbol("not serializable"),
};
void invalidDataset;
