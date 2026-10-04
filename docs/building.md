# Building and running

Two hosts, one renderer: the Lynx-for-Web target runs in a browser through
`@lynx-js/web-core`, and the native target runs in Lynx Explorer or on a device.
Both are built from the same sources with the same Solid plugin.

Everything below is split into what this repository verifies automatically and
what needs a real native runtime. Nothing in the second group has been run yet.

| Step | Command | Verified here |
| --- | --- | --- |
| Type check | `pnpm typecheck` | yes |
| Unit tests | `pnpm test` | yes |
| Build the package | `pnpm build` | yes |
| Build the web bundle | `pnpm web:build` | yes |
| Browser suite | `PLAYWRIGHT_PORT=4186 pnpm web:test` | yes |
| Build the native bundle | `pnpm native:build` | yes |
| Run the native bundle | Lynx Explorer or a device | no, needs a native host |

## The Solid Rspeedy integration

`solid-lynx/rspeedy` exports `pluginSolidLynx`, which is the whole Solid-specific
part of a Lynx build:

```ts
import { defineConfig } from "@lynx-js/rspeedy";
import { pluginLynx } from "@lynx-js/rsbuild-plugin";
import { pluginVanillaLynx } from "@lynx-js/vanilla-rsbuild-plugin";
import { pluginSolidLynx } from "solid-lynx/rspeedy";

export default defineConfig({
  source: { entry: { main: "./src/main-thread.tsx" } },
  environments: { web: {} },
  plugins: [
    pluginLynx(),
    pluginVanillaLynx({
      entries: { main: { mainThread: "./src/main-thread.tsx", background: false } },
    }),
    pluginSolidLynx(),
  ],
});
```

It registers `babel-preset-solid` with the settings a Lynx target needs:

| Setting | Value | Why |
| --- | --- | --- |
| `moduleName` | `solid-lynx` | The compiled bundle imports this package's universal JSX runtime. |
| `generate` | `universal` | Emits `createComponent`/`insert` against the Element PAPI instead of DOM helpers. |
| `hydratable` | `false` | Lynx renders on the client; there is no markup to adopt. |
| `delegateEvents` | `[]` | Lynx binds events through the PAPI, so no runtime delegation is wanted. |
| `include` | `/\.[jt]sx$/` | The transform runs on JSX and TSX sources. |

Every setting is overridable, and `babelLoaderOptions` is passed through for
anything else an app needs:

```ts
pluginSolidLynx({
  moduleName: "@my-org/solid-lynx",
  babelLoaderOptions(options) {
    options.presets = [...(options.presets ?? []), ["my-app-preset", {}]];
  },
});
```

Requirements for the `solid-lynx/rspeedy` entry point, which are not needed by
the runtime entry: `@rsbuild/core`, `@rsbuild/plugin-babel`, and
`babel-preset-solid`. `@lynx-js/rspeedy`, `@lynx-js/rsbuild-plugin`, and
`@lynx-js/vanilla-rsbuild-plugin` come from the app's own Lynx toolchain.

Known limitation: `babel-preset-solid` treats `Portal` and `Dynamic` as built-in
components it imports from `moduleName`. This package exports `For`, `Show`,
`Switch`, `Match`, `Suspense`, `SuspenseList`, `Index`, and `ErrorBoundary` but
not `Portal` or `Dynamic`, so those two components are not available yet. Portal
and overlay support is tracked as a platform capability, not a renderer gap.

## Lynx for Web

The example under `examples/lynx-for-web` is the working reference:

1. `pnpm web:build` compiles `src/main-thread.tsx` into
   `site/public/main.web.bundle`.
2. `pnpm web:serve` serves `examples/lynx-for-web/site`, whose `index.html`
   loads that bundle through a `<lynx-view>` element.
3. `PLAYWRIGHT_PORT=4186 pnpm web:test` builds, serves, and drives it with
   Playwright.

`pnpm web:test` starts its own server, so do not run `pnpm web:serve` at the same
time. The suite needs a free port; pass it through `PLAYWRIGHT_PORT`.

The `site/vite.config.ts` keeps `@lynx-js/web-core` out of Vite's dependency
pre-bundle so its WASM assets stay resolvable, and pre-discovers
`@lynx-js/lynx-core/web` so a cold start does not invalidate the page mid-load.
Keep both settings if you copy the setup.

## Native

The example under `examples/lynx-for-native` builds the same card for a device:

1. `pnpm native:build` produces `examples/lynx-for-native/dist/main.lynx.bundle`.
   This step is verified here.
2. Loading that bundle is **not** verified here. It needs Lynx Explorer or a
   device, and the steps below have to be run by hand.

The environment is named `lynx`, which is Rspeedy's default; an app that ships
both targets declares `environments: { lynx: {}, web: {} }` instead.

### What a native run has to confirm

Each item is a real unknown, not a formality. Record the outcome in
[parity-checklist.md](parity-checklist.md).

- **Root element.** The card renders into an element the host provides. The
  example resolves `__GetPageElement()`, falling back to
  `globalThis.__SOLID_LYNX_ROOT_ELEMENT__`, and throws a named error when
  neither exists. A device run has to establish which of the two a native host
  actually provides, and the answer decides whether the renderer needs a
  documented `createLynxRoot` option for native roots.
- **Dual-thread execution.** Both examples declare `background: false` and run
  the renderer on the main thread only. A card with a background thread is
  unverified, and worklets are out of scope for this package.
- **First-screen synchronization.** Whether the first screen renders from the
  first flush on a device is unverified; the browser suite only proves it for
  the web host.
- **Event delivery.** `global-bind` handlers are registered but never invoked by
  `@lynx-js/web-core`. Whether a native host runs that pass is unverified.
- **Stylesheet loading.** The examples set inline styles only. Stylesheet
  loading, CSS ids, and stylesheet lifecycle are not implemented here.

### Using Lynx Explorer

1. Build the bundle with `pnpm native:build`.
2. Create a project in Lynx Explorer and set its card bundle to
   `examples/lynx-for-native/dist/main.lynx.bundle`, or serve that directory and
   point Explorer at it.
3. Open the debugger and watch the console. The card logs
   `[solid-lynx parity] {...}` with the full parity report.
4. Compare that report against the web column in
   [parity-checklist.md](parity-checklist.md).

Reading the report: `pass` means the host behaved as the renderer expects, `fail`
carries an `observed` value and often a `note` saying what to check, and
`unsupported` means the host does not implement that PAPI at all. An
`unsupported` operation the renderer can live without is a difference to record;
a `fail` is a defect to fix.

## Running the parity harness

The harness is exported from the package root so both examples run identical
code:

```ts
import { runElementPapiParity } from "solid-lynx/parity";

const report = runElementPapiParity({ label: "native", page });
console.log(JSON.stringify(report, null, 2));
```

It creates a sandbox element inside the given page, probes the shared Element
PAPI operations against it, mounts and disposes a small renderer tree, and then
removes the sandbox, so it is safe to run inside a live card. It needs Solid's
client build: under Solid's server build there are no reactive effects, and the
`renderer-text-update` operation reports a failure with a note saying so.

In the browser the same harness runs automatically: the
"reports shared Element PAPI parity for the web host" test in
`test/browser/lynx-for-web.test.ts` executes it inside the `<lynx-view>` and
asserts that every shared operation passes.