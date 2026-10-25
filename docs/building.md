# Building and running

Two hosts, one renderer: the Lynx-for-Web target runs in a browser through
`@lynx-js/web-core`, and the native target runs in Lynx Explorer or on a device.
Both are built from the same sources with the same Solid plugin.

Everything below is split into what this repository verifies automatically and
what needs a real native runtime. The native bundle is loaded and exercised by
hand on a device; the steps and the observed result are recorded below.

| Step | Command | Verified here |
| --- | --- | --- |
| Type check | `pnpm typecheck` | yes |
| Unit tests | `pnpm test` | yes |
| Build the package | `pnpm build` | yes |
| Build the web bundle | `pnpm web:build` | yes |
| Browser suite | `PLAYWRIGHT_PORT=4186 pnpm web:test` | yes |
| Build the native bundle | `pnpm native:build` | yes |
| Run the native bundle | Lynx Explorer 4.1.0 on an Android device | yes, by hand (see Native) |

## The Solid Rspeedy integration

`@apothic-ai/solid-lynx/rspeedy` exports `pluginSolidLynx`, which is the whole
Solid-specific part of a Lynx build:

```ts
import { defineConfig } from "@lynx-js/rspeedy";
import { pluginLynx } from "@lynx-js/rsbuild-plugin";
import { pluginVanillaLynx } from "@lynx-js/vanilla-rsbuild-plugin";
import { pluginSolidLynx } from "@apothic-ai/solid-lynx/rspeedy";

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
| `moduleName` | `@apothic-ai/solid-lynx` | The compiled bundle imports this package's universal JSX runtime at its published, scoped name. |
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

Requirements for the `@apothic-ai/solid-lynx/rspeedy` entry point, which are not
needed by the runtime entry: `@rsbuild/core`, `@rsbuild/plugin-babel`, and
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
2. Loading that bundle was run by hand on a device: Lynx Explorer 4.1.0
   (`com.lynx.explorer`, engine 3.5) on an SM-A037U (Android 13). Serve `dist/`
   over `http://127.0.0.1:8099`, `adb reverse` the port, and open
   `lynx://open?url=http://127.0.0.1:8099/main.lynx.bundle`.

### Verified A03 setup

The native smoke used the Galaxy A03 / SM-A037U, Android 13 (API 33), serial
`R9WT911JVVH`. The connected tablet serial `19779010` is in use by another agent
and must not be targeted. Pin every ADB command to the A03 with
`adb -s R9WT911JVVH`; avoid commands that enumerate or address all attached
devices.

Lynx Explorer 4.1.0 (`com.lynx.explorer`, engine 3.5) was obtained from the
official `lynx-family/lynx` GitHub release:

```text
https://github.com/lynx-family/lynx/releases/download/4.1.0/LynxExplorer-noasan-release.apk
SHA-256: 6ae29787a2166974c29c2f23d87f3b20a137abcf9a8c17903ad19f3fb7f00cb6
```

The APK was verified against the release digest, is `arm64-v8a`, and is installed
on the A03. Do not reinstall it unless needed. Explorer opens the bundle through
its `lynx://open?url=...` deep link; there is no file picker.

Re-run the smoke with an A03-only loopback server and reverse tunnel. This is
what `examples/lynx-for-native/scripts/run-native-probe.sh smoke` does in one
step, with the cleanup below in an `EXIT` trap:

```bash
pnpm native:build
python3 -m http.server 8099 --bind 127.0.0.1 \
  --directory examples/lynx-for-native/dist
adb -s R9WT911JVVH reverse tcp:8099 tcp:8099
adb -s R9WT911JVVH shell am start \
  -a android.intent.action.VIEW \
  -d 'lynx://open?url=http://127.0.0.1:8099/main.lynx.bundle' \
  -p com.lynx.explorer
```

Use a fresh `?v=<unique-value>` query on the bundle URL if Explorer serves a
cached bundle. Capture the one-line `[solid-lynx parity]` report and relevant
`lynx_console` logcat output. Afterward, stop only the server started for the
test and run `adb -s R9WT911JVVH reverse --remove tcp:8099`. Do not change users,
settings, or install ArtemisAccessibilityHelper for this test.

The committed runner takes the card as an argument and does all of the above —
build, serve, reverse, deep link with a fresh `?v=` stamp, `logcat -d -s
lynx_console` plus a screenshot into `/tmp/solid-lynx-logs`, and the cleanup —
for any of the three native cards:

```bash
examples/lynx-for-native/scripts/run-native-probe.sh smoke        # [solid-lynx parity]
examples/lynx-for-native/scripts/run-native-probe.sh stylesheet   # [solid-lynx ss]
examples/lynx-for-native/scripts/run-native-probe.sh stylesheet2  # [solid-lynx ss2]
examples/lynx-for-native/scripts/run-native-probe.sh list         # [solid-lynx lp]
```

Add `--dry-run` to print the command sequence without touching a device. The
bundle stems (`main`, `stylesheet-probe`, `stylesheet-probe-v2`, `list-probe`) are
accepted as aliases, and `scripts/run-stylesheet-probe.sh` remains as a wrapper
for the `stylesheet` card. Only `--dry-run` has been executed here; no card has
been run through this runner, so the manual recipe above is still the record of
what the A03 smoke did. The captures that do exist were taken the manual way,
by opening the bundles in Lynx Explorer on an API 33 `x86_64` emulator, and are
stored under `docs/evidence/native/2026-10-25-emulator-api33-*/`.

The environment is named `lynx`, which is Rspeedy's default; an app that ships
both targets declares `environments: { lynx: {}, web: {} }` instead.

### What a native run confirmed

Two runtimes, two evidence levels: the bullets below are from the **2026-10-09
A03 hand run**, whose capture was lost, unless they say otherwise. The
**2026-10-25 API 33 `x86_64` emulator** captures are stored and re-verified, and
where they confirm a bullet it says so. Per-operation rows are in
[parity-checklist.md](parity-checklist.md).

- **Root element (resolved).** The native host exposes both `__CreatePage` and
  `__GetPageElement`, but `__GetPageElement()` returns `null` until a page
  exists. The example therefore creates the page through the documented
  `__CreatePage("0", 0)` and passes it to `runElementPapiParity` and
  `createLynxRoot`. This is the same call `createLynxRoot` makes when no `page`
  option is supplied, so no new API was needed.
- **Element handle shape (renderer defect, fixed).** Native element handles are
  opaque PrimJS objects whose `typeof` is `"unknown"`, not `"object"`. The host
  used to reject them with `Lynx failed to create <view>`; `isLynxNode()` in
  `src/lynx-host.ts` now validates creators without assuming a DOM object.
- **Inline style read-back (harness defect, fixed).** Native keeps the style out
  of the `style` attribute; `__GetAttributeByName(node, "style")` returns `null`
  and the harness reported `inline-styles` as a failure. It now prefers
  `__GetInlineStyles`, which native exposes. After that fix the run reported all
  twenty shared operations passing.
- **Rendering and events (confirmed).** The card renders an `Increment` button
  and `Native parity count: 0`; tapping increments the counter to 1 through
  `bindtap`, so flush and reactive text updates work on the device.
- **Parity (measured on the emulator; reported on the A03).** The 2026-10-25 API
  33 `x86_64` emulator run passed all twenty shared Element PAPI operations with
a stored capture
  (`docs/evidence/native/2026-10-25-emulator-api33-smoke/`; re-check it with
  `node scripts/verify-native-parity.mjs <capture>`, exit 0). The 2026-10-09 A03
  run *reported* the same twenty, but the `logcat` capture that carried the
  report was not copied out of `/tmp`, so
  [parity-checklist.md](parity-checklist.md) keeps the A03 column as reported,
not reproduced. Keep the capture on the next run, whichever device it is.
- **`processData is not a function` (observed host warning).** With
  `background: false` the bundle's `/app-service.js` is intentionally empty, and
  Explorer still invokes `processData` on it, so LogBox shows a red banner. It
  does not block loading, rendering, or tapping. The card stays main-thread
  only; a background thread would change that decision and is out of scope.
- **Dual-thread execution.** Both examples declare `background: false` and run
  the renderer on the main thread only. A card with a background thread is
  unverified, and worklets are out of scope for this package.
- **First-screen synchronization.** Whether the first screen renders from the
  first flush on a device is unverified; the browser suite only proves it for
  the web host.
- **Event delivery.** `global-bind` handlers are registered but never invoked by
  `@lynx-js/web-core`; native delivery was not part of the smoke card.
- **CSS ids and stylesheets.** Both device inventories expose `__SetCSSId`,
  `__LoadStyleSheet`, `__AdoptStyleSheet`, and `__ReplaceStyleSheets`. The
  renderer implements root-scoped `__SetCSSId`; runtime stylesheet
  loading/lifecycle is not implemented. `root.setCSSId()` has never been run on
  a device or emulator, so native `__SetCSSId` behaviour is unmeasured. The
  stylesheet bindings were exercised on the API 33 emulator and their **call
  shape** is measured — `__LoadStyleSheet` needs a second String parameter and
  returns `null`, `__AdoptStyleSheet` throws with no arguments,
  `__ReplaceStyleSheets` returns `null` without throwing — but no call returned a
  stylesheet handle, so **what a handle is and what a lifecycle would look like is
  unknown**. See [capabilities.md](capabilities.md), "The five measured stylesheet
  facts".

### Using Lynx Explorer

1. Build the bundle with `pnpm native:build`.
2. Serve `examples/lynx-for-native/dist` on loopback (for example
   `python3 -m http.server 8099 --bind 127.0.0.1`), `adb reverse tcp:8099 tcp:8099`,
   and open `lynx://open?url=http://127.0.0.1:8099/main.lynx.bundle`.
   Append a `?v=` query to bypass Explorer's bundle cache when re-running.
3. Read the console, or filter `adb logcat` for `lynx_console`. The card logs
   `[solid-lynx parity] {...}` with the full parity report **on one line**,
   because the native console bridge drops everything after the first newline.
   (The stylesheet and list cards log one `[solid-lynx ss]` / `[solid-lynx lp]`
   line per stage instead, and are read by
   `node scripts/verify-native-probe.mjs <capture>`.)
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
import { runElementPapiParity } from "@apothic-ai/solid-lynx/parity";

const report = runElementPapiParity({ label: "native", page });
// One line: the native console bridge drops everything after the first newline.
console.log(JSON.stringify(report));
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
