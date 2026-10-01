# solid-lynx

Solid rendering for [Lynx](https://lynxjs.org/).

`solid-lynx` connects Solid's fine-grained reactive runtime to Lynx Element PAPI. Solid components, signals, effects, and control flow create and update Lynx elements without targeting the browser DOM or adding a virtual DOM layer.

> **Status:** early experimental release (`0.1.0`). The renderer targets Lynx Element PAPI. A host-only Lynx-for-Web browser smoke fixture is included, while loading a Solid page bundle through that host, native device coverage, and Lynx-specific build integration remain in progress.

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

The checked-in browser fixture currently verifies only the `@lynx-js/web-core/client` custom-element bootstrap and a static `<lynx-view>` host. It does not load a Solid page bundle through Element PAPI yet. The minimal Rspeedy attempt in this repository emitted a web JavaScript chunk instead of the `.lynx.bundle` expected by `<lynx-view>`, so the fixture does not claim browser coverage of Solid rendering or PAPI behavior.

## Install

```bash
pnpm add solid-lynx solid-js
pnpm add -D babel-preset-solid
```

Configure Solid to emit universal renderer calls targeting `solid-lynx`:

```js
// babel.config.js
module.exports = {
  presets: [
    ["babel-preset-solid", {
      moduleName: "solid-lynx",
      generate: "universal",
      hydratable: false,
    }],
  ],
};
```

With Rspeedy, apply this Solid transform in the JavaScript transform used by your Lynx bundle. Keep the rest of your normal Lynx/Rspeedy setup in place.

For browser validation, the fixture boots `@lynx-js/web-core/client` and a static `<lynx-view>`, rather than mounting Solid into a normal DOM node. Loading the Solid page bundle through that host remains planned in [ROADMAP.md](ROADMAP.md).

## Quick start

The convenience root uses the global Lynx Element PAPI functions. It creates a page, derives its component id, renders the Solid tree, and exposes explicit cleanup:

```tsx
import { createSignal } from "solid-js";
import { createLynxRoot } from "solid-lynx";

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

const root = createLynxRoot({
  componentId: "0",
  cssId: 0,
});

root.render(() => <App />);

// Call this from the host page-destroy lifecycle.
root.dispose();
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

### `createLynxRoot(options?)`

Creates an isolated Solid root backed by a Lynx page. The returned object contains:

- `page`: the page element used as the render parent.
- `renderer`: the underlying Solid universal renderer.
- `render(code)`: mounts the Solid tree and returns a disposer.
- `dispose()`: disposes Solid owners and removes the rendered native tree.
- `flush()`: explicitly calls `__FlushElementTree`.

### `createLynxRenderer(host, options?)`

Creates a renderer from a `LynxHost` implementation. Use this when you need multiple isolated hosts, a custom runtime, or a test double.

```ts
import { createGlobalLynxHost, createLynxRenderer } from "solid-lynx";

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

## Events and properties

Native Lynx event props work directly:

```tsx
<view
  bindtap={handleTap}
  catchtouchmove={handleMove}
  capture-bindscroll={handleScroll}
  main-thread:bindtap={handleMainThreadTap}
/>
```

The adapter also accepts familiar event forms:

| Solid prop | Lynx binding |
| --- | --- |
| `on:tap` | `bindEvent`, `tap` |
| `onTap` | `bindEvent`, `tap` |
| `onClick` | `bindEvent`, `tap` |
| `onCatchTap` | `catchEvent`, `tap` |

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
| `__AddEvent` or `__AddEventListener` | Bind event handlers |
| `__FlushElementTree` | Commit mutations |

`__CreatePage` and `__GetElementUniqueID` are additionally required when `createLynxRoot` creates a page or infers its parent component id.

## Scope and limitations

This package currently focuses on the Solid renderer and Element PAPI bridge. The surrounding Lynx toolchain and host runtime remain responsible for:

- Rspeedy configuration and bundle generation
- Native navigation and page lifecycle integration
- Dual-thread worklet compilation and scheduling
- Native list virtualization and list-specific optimizations
- Platform-specific native modules
- Production Lynx-for-Web app-bundle generation and host integration; the included fixture covers only web-core bootstrap

Solid control-flow components such as `For`, `Show`, `Switch`, `Index`, `Suspense`, and `ErrorBoundary` are re-exported from the package.

See [ROADMAP.md](ROADMAP.md) for planned milestones and completion goals.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Tests use an in-memory fake Element PAPI implementation, so the core renderer checks do not require iOS, Android, or Lynx Explorer.

### Lynx-for-Web host smoke

Install the browser used by Playwright once, then run the host-only smoke test:

```bash
pnpm install
pnpm exec playwright install chromium
pnpm web:test
```

To open the fixture manually, run `pnpm web:serve` and visit <http://127.0.0.1:4173>. The smoke test verifies that `@lynx-js/web-core/client` registers and upgrades the static `<lynx-view>` element. It does not load a Solid Lynx bundle; page rendering, reactivity, PAPI events, property updates, and disposal remain unverified in a browser.

## License

Copyright 2026 Apothic AI.

Licensed under the [Apache License, Version 2.0](LICENSE).
