import { defineConfig } from "@lynx-js/rspeedy";
import { pluginLynx } from "@lynx-js/rsbuild-plugin";
import { pluginVanillaLynx } from "@lynx-js/vanilla-rsbuild-plugin";
import { pluginSolidLynx } from "solid-lynx/rspeedy";

/**
 * Lynx-for-Web build for the pattern example.
 *
 * Identical to the other examples except for the source path and the output
 * directory: forms, keyed lists, and asynchronous content are ordinary Solid
 * components, so the platform differences they run into are runtime ones, not
 * build ones. The supported parts come from `pluginSolidLynx`.
 */
export default defineConfig({
  source: {
    entry: { main: "./src/main-thread.tsx" },
  },
  environments: {
    web: {},
  },
  output: {
    distPath: {
      root: "site/public",
    },
    filename: {
      bundle: "[name].[platform].bundle",
    },
  },
  tools: {
    rspack: {
      // Only needed because this repository is authored with NodeNext
      // resolution; an app that is not does not need this.
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