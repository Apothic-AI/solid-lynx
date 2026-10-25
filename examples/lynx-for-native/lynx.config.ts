import { defineConfig } from "@lynx-js/rspeedy";
import { pluginLynx } from "@lynx-js/rsbuild-plugin";
import { pluginVanillaLynx } from "@lynx-js/vanilla-rsbuild-plugin";
import { pluginSolidLynx } from "@apothic-ai/solid-lynx/rspeedy";

/**
 * Native build for the parity card, the two stylesheet probes, and the list
 * probe.
 *
 * It differs from the Lynx-for-Web config in two ways only: the environment is
 * Lynx's own `lynx` instead of `web`, and the output goes to `dist` instead of
 * the demo site. Everything Solid specific comes from `pluginSolidLynx`, which
 * is the point of the shared plugin.
 *
 * Build with `pnpm native:build`, which produces `dist/main.lynx.bundle`,
 * `dist/stylesheet-probe.lynx.bundle`, `dist/stylesheet-probe-v2.lynx.bundle`,
 * and `dist/list-probe.lynx.bundle`.
 * Loading any of them needs Lynx Explorer or a device; see `docs/building.md`.
 */
export default defineConfig({
  source: {
    entry: {
      main: "./src/main-thread.tsx",
      // A second, disposable card used to measure the native stylesheet PAPI on
      // a device. It shares this config and this toolchain rather than having
      // its own build, so a measurement runs against the same setup as the
      // parity smoke. `scripts/run-stylesheet-probe.sh` loads it.
      "stylesheet-probe": "./src/stylesheet-probe.ts",
      // The same measurement, second attempt: it answers what v1 left open (the
      // second parameter of __LoadStyleSheet) and asks whether a style-object
      // path exists. Kept beside v1 rather than replacing it, because v1's
      // capture is the ground truth v2 starts from.
      "stylesheet-probe-v2": "./src/stylesheet-probe-v2.ts",
      // A third card, the same shape as the stylesheet probe, measuring the
      // native list PAPI and cell recycling on a device.
      "list-probe": "./src/list-probe.ts",
    },
  },
  environments: {
    // Rspeedy's default Lynx environment; this is what a device or Lynx
    // Explorer loads. An app that also ships Lynx for Web adds a `web`
    // environment next to it, as examples/lynx-for-web does.
    lynx: {},
  },
  output: {
    distPath: {
      root: "dist",
    },
    filename: {
      bundle: "[name].[platform].bundle",
    },
  },
  tools: {
    rspack: {
      // Only needed because this repository is authored with NodeNext
      // resolution; see the note in examples/lynx-for-web/lynx.config.ts.
      resolve: {
        extensionAlias: {
          ".js": [".ts", ".tsx", ".js"],
        },
      },
    },
  },
  plugins: [
    pluginLynx(),
    pluginVanillaLynx({
      entries: {
        main: {
          mainThread: "./src/main-thread.tsx",
          background: false,
        },
        "stylesheet-probe": {
          mainThread: "./src/stylesheet-probe.ts",
          background: false,
        },
        "stylesheet-probe-v2": {
          mainThread: "./src/stylesheet-probe-v2.ts",
          background: false,
        },
        "list-probe": {
          mainThread: "./src/list-probe.ts",
          background: false,
        },
      },
    }),
    pluginSolidLynx(),
  ],
});