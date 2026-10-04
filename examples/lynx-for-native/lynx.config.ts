import { defineConfig } from "@lynx-js/rspeedy";
import { pluginLynx } from "@lynx-js/rsbuild-plugin";
import { pluginVanillaLynx } from "@lynx-js/vanilla-rsbuild-plugin";
import { pluginSolidLynx } from "solid-lynx/rspeedy";

/**
 * Native build for the parity card.
 *
 * It differs from the Lynx-for-Web config in two ways only: the environment is
 * Lynx's own `lynx` instead of `web`, and the output goes to `dist` instead of
 * the demo site. Everything Solid specific comes from `pluginSolidLynx`, which
 * is the point of the shared plugin.
 *
 * Build with `pnpm native:build`, which produces `dist/main.lynx.bundle`.
 * Loading it needs Lynx Explorer or a device; see `docs/building.md`.
 */
export default defineConfig({
  source: {
    entry: { main: "./src/main-thread.tsx" },
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
      },
    }),
    pluginSolidLynx(),
  ],
});