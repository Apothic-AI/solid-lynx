import type { LynxCustomElementAttributes } from "solid-lynx";

type MeterAttributes = LynxCustomElementAttributes<{
  value: number;
}>;

declare module "solid-lynx/jsx-runtime" {
  namespace JSX {
    interface IntrinsicElements {
      "x-meter": MeterAttributes;
    }
  }
}

declare module "solid-lynx/jsx-dev-runtime" {
  namespace JSX {
    interface IntrinsicElements {
      "x-meter": MeterAttributes;
    }
  }
}
