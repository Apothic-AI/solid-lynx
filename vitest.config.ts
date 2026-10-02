import { configDefaults, defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    conditions: ["browser"],
    // Node resolves Solid's server entry by default. Lynx is a live client
    // renderer, so tests must exercise Solid's reactive runtime.
    alias: [
      {
        find: /^solid-js$/,
        replacement: fileURLToPath(new URL("./node_modules/solid-js/dist/solid.js", import.meta.url)),
      },
    ],
  },
  test: {
    environment: "node",
    server: {
      deps: {
        inline: [/solid-js/],
      },
    },
    include: ["test/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "test/browser/**"],
  },
});
