import type { LynxCustomElementAttributes } from "@apothic-ai/solid-lynx";

type MeterAttributes = LynxCustomElementAttributes<{
  value: number;
}>;

declare module "@apothic-ai/solid-lynx/jsx-runtime" {
  namespace JSX {
    interface IntrinsicElements {
      "x-meter": MeterAttributes;
    }
  }
}

declare module "@apothic-ai/solid-lynx/jsx-dev-runtime" {
  namespace JSX {
    interface IntrinsicElements {
      "x-meter": MeterAttributes;
    }
  }
}
