import { defineConfig } from "@lynx-js/rspeedy";
import { pluginLynx } from "@lynx-js/rsbuild-plugin";
import { pluginVanillaLynx } from "@lynx-js/vanilla-rsbuild-plugin";
import { pluginBabel } from "@rsbuild/plugin-babel";

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
    pluginBabel({
      include: /\.(?:jsx|tsx)$/,
      babelLoaderOptions(options) {
        options.presets ??= [];
        options.presets.unshift([
          "babel-preset-solid",
          {
            moduleName: "solid-lynx",
            generate: "universal",
            hydratable: false,
          },
        ]);
      },
    }),
  ],
});
