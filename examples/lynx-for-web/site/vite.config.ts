import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    // Keep web-core's import.meta.url-relative WASM assets attached to the
    // package modules instead of moving those modules into Vite's prebundle.
    exclude: ["@lynx-js/web-core"],
    // web-core imports Lynx Core lazily at runtime. Discover it up front so
    // first bundle evaluation does not invalidate the page during cold start.
    include: ["@lynx-js/lynx-core/web"],
  },
});
