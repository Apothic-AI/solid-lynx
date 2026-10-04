import { defineConfig } from "@lynx-js/rspeedy";
import { pluginLynx } from "@lynx-js/rsbuild-plugin";
import { pluginVanillaLynx } from "@lynx-js/vanilla-rsbuild-plugin";
import { pluginSolidLynx } from "solid-lynx/rspeedy";

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
      // The package and this example are authored for NodeNext resolution, so
      // relative imports carry the `.js` extension TypeScript requires. An app
      // that does not author its own sources with NodeNext does not need this.
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
          // The Solid renderer runs entirely on the main thread, so this card
          // ships no background thread.
          background: false,
        },
      },
    }),
    pluginSolidLynx(),
  ],
});