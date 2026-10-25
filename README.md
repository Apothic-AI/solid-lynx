# solid-lynx

Solid rendering for [Lynx](https://lynxjs.org/).

> **Installed name:** `@apothic-ai/solid-lynx`. This README, the docs, and the
> repository call the renderer solid-lynx; the npm package is scoped because the
> unscoped `solid-lynx` on npm belongs to an unrelated project. Every import below
> uses the scoped specifier, and the subpaths are `@apothic-ai/solid-lynx/rspeedy`,
> `/parity`, `/jsx-runtime`, and `/jsx-dev-runtime`. See
> [CHANGELOG.md](CHANGELOG.md), "Package name".

`solid-lynx` connects Solid's fine-grained reactive runtime to Lynx Element PAPI. Solid components, signals, effects, and control flow create and update Lynx elements without targeting the browser DOM or adding a virtual DOM layer.

> **Status:** stable `1.0.0` release of the renderer and its Element PAPI bridge. The public host, root, event, JSX, ref, CSS-id, list, Rspeedy, and parity surfaces are frozen and each item is mapped to its covering test in [docs/contract.md](docs/contract.md). The supported Solid, Lynx, Rspeedy, Node, and pnpm versions, and how narrow each range is, are in [docs/compatibility.md](docs/compatibility.md); upgrading from `0.x` is covered by [docs/migration.md](docs/migration.md); per-capability support and measurement status is in [docs/capabilities.md](docs/capabilities.md).
>
> What is actually verified: 303 unit tests across twelve files — the renderer checks against an in-memory fake Element PAPI, the two native capture verifiers, the stored-evidence requirement, the probe recorders, the Rspeedy plugin, the packaging check below, a consumer install that packs this workspace and imports the unpacked tarball, and a guard that fails when any document disagrees with the counts here — plus the consumer fixtures compiled by `pnpm typecheck:consumer`, the Lynx-for-Web bundle and the pattern card in Chromium (17 + 9 tests), and the native smoke card, which **reported** loading, rendering and passing all twenty shared Element PAPI operations in Lynx Explorer 4.1.0 on an Android device on 2026-10-09 — that run's capture was not kept, so `docs/parity-checklist.md` records the native column as reported, not reproduced. The tarball that `pnpm pack` produces is checked twice: `test/packaging.test.ts` in the repository reads the real file list and fails if a link in this README, or in any shipped doc, points at something the package does not contain, and `test/consumer-install.test.ts` unpacks that tarball into a temp app, installs only `solid-js` beside it, and imports every documented entry through node's own ESM resolution. `.github/workflows/ci.yml` defines six jobs — `unit`, then `node-matrix`, `solid-matrix`, `browser`, `native-build` and `native-evidence` — triggered on `pull_request` and on `push` to `master`; `native-build` only compiles the bundle and attaches no device, and `native-evidence` would fail a pull request that changes native-facing code without a stored, verifier-passing capture, an explicit recorded decision, or a recorded pending run (`docs/evidence/native/README.md`). **No workflow has executed on GitHub Actions for any commit here** — `gh run list` returns no runs and the workflow is not on `origin/master` — so the numbers above are local results and the CI column is a definition, not a record.
>
> What is **not** verified, and must not be assumed from this release: native stylesheet lifecycle, native list semantics and cell recycling, native `global-bind` delivery, event capture/propagation parity on native, dual-thread/worklets/first-screen, gesture PAPI, animation PAPI exposure, and portals/overlays. This renderer does not implement the ones marked unimplemented in [docs/capabilities.md](docs/capabilities.md), and the native stylesheet and list probe cards have not been run on a device, so they measure nothing yet. [CHANGELOG.md](CHANGELOG.md) records exactly what 1.0.0 contains and why.

## Why this exists

ReactLynx provides an excellent React experience for Lynx. This project explores the same platform from a Solid perspective:

- Fine-grained updates instead of component-wide rerenders.
- A small host adapter over the current Lynx Element PAPI.
- Isolated renderer and root instances, so multiple roots do not share mutable page state.
- A fake-PAPI test seam that makes renderer behavior testable without a mobile toolchain.

The package is a rendering layer. It does not replace Lynx, Rspeedy, native navigation, or the Lynx dual-thread build pipeline.

## Rendering model

`solid-lynx` targets Lynx's Element PAPI rather than `document.createElement`. This is the same framework boundary used by ReactLynx: the UI framework emits Lynx element operations, and the Lynx runtime owns the actual rendering.

The native path is:

```text
Solid component
  -> solid-lynx
  -> Lynx Element PAPI
  -> Lynx native engine
  -> native UI
```

The browser path uses Lynx for Web. `@lynx-js/web-core` implements the Lynx runtime contract in the browser, and `<lynx-view>` hosts the Lynx page:

```text
Solid component
  -> solid-lynx
  -> Lynx Element PAPI
  -> @lynx-js/web-core
  -> <lynx-view>
  -> browser DOM
```

The browser DOM is an implementation detail of Lynx for Web. `solid-lynx` does not provide a direct DOM renderer fallback, and application code should not assume that `document` or `window` are available inside a Lynx page. See the [Lynx web integration documentation](https://lynxjs.org/guide/start/integrate-with-existing-apps) for the surrounding web host setup.

The checked-in fixture boots `@lynx-js/web-core/client` and loads the generated `main.web.bundle` in `<lynx-view>`. Rspeedy uses the published `pluginLynx` and `pluginVanillaLynx` plugins, a main-thread-only entry, Babel's universal Solid transform, and Lynx for Web's encoder. The bundle renders and updates through Element PAPI; the app is not mounted into a host-side DOM node.

## Install

```bash
pnpm add @apothic-ai/solid-lynx solid-js
pnpm add -D @lynx-js/rspeedy @lynx-js/rsbuild-plugin \
  @lynx-js/vanilla-rsbuild-plugin @lynx-js/lynx-core \
  @rsbuild/core @rsbuild/plugin-babel babel-preset-solid
```

Configure Solid to emit universal renderer calls targeting the package. The
module name is the published, scoped one: the renderer is called solid-lynx
throughout this repository and in the docs, but the name it is installed under is
`@apothic-ai/solid-lynx`, because the unscoped `solid-lynx` on npm belongs to an
unrelated package. A build that names the unscoped form emits imports nothing can
resolve.

```js
// babel.config.cjs
module.exports = {
  presets: [
    ["babel-preset-solid", {
      moduleName: "@apothic-ai/solid-lynx",
      generate: "universal",
      hydratable: false,
    }],
  ],
};
```

The web example applies this transform in its Rspeedy config and emits a real Lynx web bundle:

```ts
import { defineConfig } from "@lynx-js/rspeedy";
import { pluginLynx } from "@lynx-js/rsbuild-plugin";
import { pluginVanillaLynx } from "@lynx-js/vanilla-rsbuild-plugin";
import { pluginBabel } from "@rsbuild/plugin-babel";

export default defineConfig({
  source: { entry: { main: "./src/main-thread.tsx" } },
  environments: { web: {} },
  output: {
    distPath: { root: "site/public" },
    filename: { bundle: "[name].[platform].bundle" },
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
            moduleName: "@apothic-ai/solid-lynx",
            generate: "universal",
            hydratable: false,
          },
        ]);
      },
    }),
  ],
});
```

`@lynx-js/lynx-core` supplies the web-core optional peer. The Vite host excludes `@lynx-js/web-core` from dependency prebundling so its relative WASM asset keeps the correct URL and MIME type, and includes the peer's lazy web entry so Vite discovers it before the first page load:

```ts
import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    exclude: ["@lynx-js/web-core"],
    include: ["@lynx-js/lynx-core/web"],
  },
});
```

## Quick start

The convenience root uses the global Lynx Element PAPI functions. It creates a page, derives its component id, renders the Solid tree, and exposes explicit cleanup:

```tsx
import { createSignal } from "solid-js";
import { createLynxRoot } from "@apothic-ai/solid-lynx";

function App() {
  const [count, setCount] = createSignal(0);

  return (
    <view class="page">
      <text>Clicked {count()} times</text>
      <view bindtap={() => setCount(count() + 1)}>
        <text>Tap me</text>
      </view>
    </view>
  );
}

const engine = lynx.getEngine();
let root: ReturnType<typeof createLynxRoot> | undefined;

function renderPage() {
  if (root) return;
  root = createLynxRoot({ componentId: "0", cssId: 0 });
  root.render(() => <App />);
}

function destroyPage() {
  root?.dispose();
  root = undefined;
  engine.removeEventListener("__RenderPage", renderPage);
  engine.removeEventListener("__DestroyLifetime", destroyPage);
}

engine.addEventListener("__RenderPage", renderPage);
engine.addEventListener("__DestroyLifetime", destroyPage);
```

For an existing page element, pass the page and its component id instead of asking the root to create one:

```ts
const root = createLynxRoot({
  page,
  parentComponentId: __GetElementUniqueID(page),
});

root.render(() => <App />);
```

The root flushes the initial tree immediately. Later property, event, text, insert, and remove operations are coalesced into a microtask. Use `root.flush()` when your host lifecycle needs an explicit commit.

## Public API

The API below is frozen for the 1.0 line: [docs/contract.md](docs/contract.md)
records every signature, marks each item stable, provisional, or unsupported,
and names the test that covers it, including the parts that are explicitly not
part of the contract.

### `createLynxRoot(options?)`

Creates an isolated Solid root backed by a Lynx page. The returned object contains:

- `page`: the page element used as the render parent.
- `renderer`: the underlying Solid universal renderer.
- `render(code)`: mounts the Solid tree and returns a disposer.
- `setCSSId(cssId, entryName?)`: assigns a compiled CSS id to the elements this root owns in its page.
- `createList(options)`: creates a list through `__CreateList` with an indexed row model. See [Indexed lists](#indexed-lists).
- `dispose()`: disposes Solid owners, releases the listeners the root filed, and removes the nodes the root rendered.
- `flush()`: explicitly calls `__FlushElementTree`.

Several roots can share one page, each with its own container element passed as `page` and its own parent component id. Disposing a root releases only the nodes that root rendered, so the other roots keep rendering and dispatching. A disposed root can be rendered into again: `render` is refused only while a previous tree is still mounted, and the new tree registers fresh listeners.

### `createLynxRenderer(host, options?)`

Creates a renderer from a `LynxHost` implementation. Use this when you need multiple isolated hosts, a custom runtime, or a test double.

```ts
import { createGlobalLynxHost, createLynxRenderer } from "@apothic-ai/solid-lynx";

const host = createGlobalLynxHost({
  getParentComponentId: () => pageId,
});

const renderer = createLynxRenderer(host);
const dispose = renderer.render(() => <App />, page);

dispose();
```

### `createGlobalLynxHost(options)`

Adapts current Lynx Element PAPI globals. Pass `papi` to inject an explicit API object, which is useful for tests and alternate hosts:

```ts
const host = createGlobalLynxHost({
  papi: testPapi,
  getParentComponentId: () => pageId,
  transformEventNames: true,
});
```

## Refs and imperative access

`ref` is transformed by the Solid JSX compile step, so it is not a renderer prop. A function ref receives the Lynx PAPI node itself, and returning a function from it registers that function as the owning Solid scope's teardown:

```tsx
import { createLynxRef } from "@apothic-ai/solid-lynx";

const target = createLynxRef<LynxNode>();

<view ref={target} />;
<text ref={node => measure(node)} />;

target.current; // the node, or undefined once its scope is disposed
```

The attachment is released when the scope that created the element is disposed, so removing a conditional subtree clears the ref and disposing a root clears every ref it owns. Two details of the transform are worth knowing: the ref binding runs before the element's props are applied, so a ref cannot rely on attributes being set yet, and reconciliation that moves an element does not re-fire its ref.

`use(fn, element, arg)` and the `use:` directive take the same path and get the same cleanup.

Only a callable ref is accepted. A plain `{ current }` object is not usable here, because the transform assigns a non-function ref to its target instead of calling it; the types reject it rather than letting it fail silently.

## CSS ids

`root.setCSSId(cssId, entryName?)` assigns a compiled CSS id through `__SetCSSId`:

```ts
root.setCSSId(0, "main");
```

The call is batched: one PAPI call carrying every element that root owns directly in its page, and elements the root puts in that page later get the same id. The id goes on the root of a subtree rather than each descendant. `null` is forwarded untouched for the host to resolve, an invalid id throws before anything is recorded, and a host without `__SetCSSId` throws rather than silently rendering unstyled.

This selects a stylesheet the Lynx toolchain already compiled into the bundle. Loading, replacing, or removing a stylesheet at runtime is not supported: no Lynx Element PAPI does it. See [docs/capabilities.md](docs/capabilities.md).

## Events and properties

Native Lynx event props work directly:

```tsx
<view
  bindtap={handleTap}
  catchtouchmove={handleMove}
  capture-bind:scroll={handleScroll}
  capture-catch:tap={handleCaptureCatch}
  global-bind:tap={handleGlobalTap}
  main-thread:bindtap={handleMainThreadTap}
/>
```

Both the colon form (`bind:tap`) and the compact form (`bindtap`) are recognized, as is the namespaced `main-thread:` and `background:` prefix.

The adapter also accepts familiar event forms:

| Solid prop | Lynx binding |
| --- | --- |
| `on:tap` | `bindEvent`, `tap` |
| `onTap` | `bindEvent`, `tap` |
| `onClick` | `bindEvent`, `tap` |
| `onCatchTap` | `catchEvent`, `tap` |

Each binding form is filed in its own host dispatch slot, keyed by binding type, event name, and namespace, and is registered and removed with the same `__AddEventListener` options. Listeners exist only while their node is part of the rendered tree: inserting a node registers its bindings, removing a node detaches the bindings of its whole subtree, and re-inserting it registers them again. Disposing a root therefore releases every listener it created.

`@lynx-js/web-core` files a `global-bind` handler in the `global-bindEvent` slot but does not run the global pass for function callbacks, so a `global-bind:tap` prop is registered and removed correctly yet is not invoked by that host. The fake PAPI tests cover that pass; whether a native host runs it is not measured.

The following properties have dedicated handling:

- `class` and `className` through `__SetClasses`
- String or object `style` through `__SetInlineStyles`
- `id` through `__SetID` when available
- `data-*` through dataset PAPI operations
- `textContent` through the Lynx `text` attribute
- Boolean attributes such as `disabled`, `checked`, and `readonly`
- All other properties through `__SetAttribute`

Reactive text updates preserve the raw text node and update it through `__SetAttribute(rawText, "text", value)`.

## Element PAPI surface

The global adapter uses these current Lynx operation names:

| Operation | Purpose |
| --- | --- |
| `__CreateElement`, `__CreateView`, `__CreateText`, `__CreateRawText` | Create native nodes |
| `__AppendElement`, `__InsertElementBefore`, `__RemoveElement` | Mutate the tree |
| `__FirstElement`, `__NextElement`, `__GetParent` | Traverse the tree |
| `__SetAttribute`, `__SetClasses`, `__SetInlineStyles` | Update properties |
| `__SetID`, `__AddDataset` or `__SetDataset` | Update id and dataset |
| `__SetCSSId` (optional) | Assign a compiled CSS id to elements |
| `__CreateList`, `__UpdateListCallbacks` (optional) | Create a list and refresh its row callbacks |
| `__AddEventListener` / `__RemoveEventListener`, or `__AddEvent` | Bind and unbind event handlers |
| `__FlushElementTree` | Commit mutations |

`__CreatePage` and `__GetElementUniqueID` are additionally required when `createLynxRoot` creates a page or infers its parent component id. `__SetCSSId` is optional and used only by `setCSSId`. The list operations are optional and used only by `createList`.

## Indexed lists

`<list>` is not an ordinary element: the host only recycles rows when the framework hands it `componentAtIndex` and `enqueueComponent`, which `createElement(tagName)` cannot pass. Writing `<list>` in JSX therefore throws, and the tag is not in the JSX element types, instead of silently rendering every row as a real child. `root.createList()` is the supported path:

```ts
const list = root.createList({
  items: () => tasks,                       // read lazily, so a callback never sees a stale model
  getKey: task => task.id,                  // optional; defaults to the item itself
  children: (task, index) => (
    <view>
      <text>{task.label}</text>
      <text>#{index()}</text>
    </view>
  ),
});

list.materialize(0);                         // what `componentAtIndex` does
list.update();                               // model changed: move surviving rows, release dropped ones, re-install the callbacks
list.dispose();                              // release every row and detach the callbacks
```

The host owns row selection: it asks for the `cellIndex` it wants, and this model materializes exactly that row. `children` runs once per key, so a key that moves to another index updates its row in place instead of rebuilding it, which is Solid's `For` identity. `index` is an accessor for the same reason.

`update()` is what reflects a new model without another host request: surviving rows move to their new indices and the list is reordered, keeping their nodes. A key whose item was replaced is rebuilt, because its content came from the old item. Rows keep ascending index order however the host asks for them, including sparse and out-of-order requests.

Verified against `@lynx-js/web-core@0.26.2` only. No host in this repository has been seen to recycle a cell, and nothing has run on a device, so native list support is unverified. A host that does not expose both `__CreateList` and `__UpdateListCallbacks` throws from `createList()` before anything is created, rather than degrading: the two are required together because every model change and every disposal re-installs the callbacks. Details and measurements are in [docs/capabilities.md](docs/capabilities.md#list-virtualization).

## Scope and limitations

This package currently focuses on the Solid renderer and Element PAPI bridge. The surrounding Lynx toolchain and host runtime remain responsible for:

- Rspeedy configuration and bundle generation
- Native navigation and page lifecycle integration
- Dual-thread worklet compilation and scheduling
- Cell recycling and native list behaviour (the list PAPI adapter is implemented and web-verified; see [Indexed lists](#indexed-lists))
- Platform-specific native modules
- Production Lynx-for-Web serving and host integration beyond the included example

Solid control-flow components such as `For`, `Show`, `Switch`, `Index`, `Suspense`, and `ErrorBoundary` are re-exported from the package.

See [ROADMAP.md](ROADMAP.md) for planned milestones and completion goals.
For current native-device evidence, remaining platform gaps, and fresh-session
continuation instructions, see [docs/session-handoff.md](docs/session-handoff.md).
Upgrading from an earlier `0.x` build? [docs/migration.md](docs/migration.md) lists
what to change against the frozen contract, including refs, CSS ids, event props,
JSX types, the list API, and what deterministic cleanup does and does not prove.

## Development

Use Node.js 20.19+ or 22.12+ with pnpm for the Rspeedy/Vite example toolchain.
The exact supported Solid, Lynx, and Rspeedy versions, and how narrow each
range is, are recorded in [docs/compatibility.md](docs/compatibility.md).

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Tests use an in-memory fake Element PAPI implementation, so the core renderer checks do not require iOS, Android, or Lynx Explorer.

### Lynx-for-Web Solid bundle

Build the Solid TSX entry with the Lynx vanilla plugin and web encoder:

```bash
pnpm install
pnpm web:build
```

The bundle is `examples/lynx-for-web/site/public/main.web.bundle`, loaded by `<lynx-view url="/main.web.bundle">`. For browser testing, install Chromium once and run:

```bash
pnpm exec playwright install chromium
pnpm web:test
```

To open the fixture manually, run `pnpm web:serve` and visit <http://127.0.0.1:4173>. The example includes `#count`, the `bindtap` button `#increment`, the `onClick` button `#alias-increment`, reactive `#status`, `#dataset-readout` (updated from `event.currentTarget.dataset.count` when `#status` is tapped), and `#dispose`. The serial Chromium suite passed all three checks: bundle loading and mount inside `<lynx-view>`, both event props with reactive class/style and dataset updates, and unmounting through `#dispose`.

## License

Copyright 2026 Apothic AI.

Licensed under the [Apache License, Version 2.0](LICENSE).
