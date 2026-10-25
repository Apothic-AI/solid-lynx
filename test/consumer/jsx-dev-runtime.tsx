import type { LynxEventHandler } from "@apothic-ai/solid-lynx";

const onTap: LynxEventHandler = event => {
  const uid: number = event.currentTarget?.uid ?? event.target.uid;
  void uid;
};

export function DevelopmentConsumerApp() {
  return (
    <view
      id="development-consumer"
      data-mode="development"
      capture-bind:tap={onTap}
      background:catchtap={onTap}
    >
      <text on:tap={onTap}>Typed through jsx-dev-runtime</text>
    </view>
  );
}
