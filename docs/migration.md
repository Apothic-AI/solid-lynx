# Migrating a 0.x consumer to the frozen contract

`docs/contract.md` freezes the public surface at `0.1.0`. This guide is what a
consumer that wrote against an earlier `0.x` build has to change, why, and how
to prove the change is complete. It is derived from the actual API surface —
[contract.md](contract.md) is the reference — not from a changelog of intentions.

Read this with [compatibility.md](compatibility.md) open: several steps are
version gates, and the version numbers are exact for a reason.

Everything below is scoped to consumer code. No renderer source changed to
produce this document.

## 1. Self-check: is this me?

You are affected if any of these is true:

- You built JSX with `pluginBabel` and a `babel-preset-solid` entry of your own,
  rather than `pluginSolidLynx()` from `solid-lynx/rspeedy`.
- You pass a `ref` that is not a function (an object literal, `{ current: … }`,
  a DOM-style ref object).
- You assign CSS ids by looping and calling `__SetCSSId` yourself, or you expect
  a stylesheet to load at runtime.
- You write `onClick` and expect it to keep working with
  `transformEventNames: false`.
- You write `<list>` in JSX at all (§6.2: it is now a build-time error), or you
  expect the list PAPI adapter to recycle cells (it does not).
- You import `Portal` or `Dynamic` from `solid-lynx`.
- You dispose a root and then expect a second `root.render()` of the *same*
  tree object to be refused — or expect it to be allowed without disposing the
  previous one.
- You read `@lynx-js/types`-shaped attributes off `solid-lynx` JSX props.

## 2. Build configuration

### 2.1 Use `pluginSolidLynx()` instead of a hand-rolled preset

If you copied the pre-0.4 snippet from older README docs, you have a
`babel-preset-solid` entry inlined in your `lynx.config.ts`. Replace it with the
plugin, which pins the transform to what the renderer requires
(`src/rspeedy.ts:47-62`, `:125-134`):

```ts
import { defineConfig } from "@lynx-js/rspeedy";
import { pluginLynx } from "@lynx-js/rsbuild-plugin";
import { pluginVanillaLynx } from "@lynx-js/vanilla-rsbuild-plugin";
import { pluginSolidLynx } from "solid-lynx/rspeedy";

export default defineConfig({
  source: { entry: { main: "./src/main-thread.tsx" } },
  environments: { lynx: {} },           // `web: {}` for the browser target
  plugins: [
    pluginLynx(),
    pluginVanillaLynx({
      entries: { main: { mainThread: "./src/main-thread.tsx", background: false } },
    }),
    pluginSolidLynx(),
  ],
});
```

Two settings are contract, not preference:

- `generate: "universal"`. Without it the compiler emits DOM helpers and the
  bundle builds but renders nothing. This is why the setting lives in the plugin
  (`src/rspeedy.ts:16-21`).
- `moduleName: "solid-lynx"`. If you renamed the package or vendored it, pass
  `moduleName` so the compiled imports resolve. The default is `"solid-lynx"`
  (`src/rspeedy.ts:15`, `:52`).

`pluginSolidLynx()` deliberately does **not** add `pluginLynx()` or
`pluginVanillaLynx()` — see `src/rspeedy.ts:110-124`. Keep them in your config.

Covered by `test/rspeedy.test.ts:20`, `:30`, `:41`, `:49`, `:67`, `:85`. If your
own presets must run first, note the plugin puts the Solid preset at the
**front** of the preset list (`src/rspeedy.ts:70-77`) and then calls your
`babelLoaderOptions` callback (`:101-108`), which is the documented escape hatch.

### 2.2 Version gates

From [compatibility.md](compatibility.md) §2 and §7:

- `solid-js` must be `^1.9.15`. The peer range moved from `^1.9.0` because the
  installed `babel-preset-solid` 1.9.15 declares `^1.9.15`. Upgrade Solid; a
  1.9.0–1.9.14 install is outside the frozen contract.
- Node must be `^20.19.0 || >=22.12.0`. `engines.node` moved from `>=20` because
  `vite`, `@lynx-js/rspeedy`, and `@rsbuild/core` all require it.
- The Lynx toolchain versions in [compatibility.md](compatibility.md) §5 are
  exact. If you are on a different `@lynx-js/web-core` or `@lynx-js/rspeedy`,
  you are outside the tested set.

## 3. Refs

This is the change most likely to break an existing app, because the *old*
behaviour was silent.

### 3.1 Only a callable ref works

`solid-js/universal` implements `use` as `untrack(() => fn(element, arg))` and
discards the result. `babel-preset-solid` sends a **function** `ref` to `use`
and **assigns** anything else to the binding. So:

```tsx
// Still wrong: an object literal is assigned, never called.
const target = { current: undefined as LynxNode | undefined };
<view ref={target} />;
```

```tsx
// Use the package's ref object: it is callable *and* readable.
import { createLynxRef, type LynxNode } from "solid-lynx";

const target = createLynxRef<LynxNode>();
<view ref={target} />;
target.current;                                  // the node, or undefined

// Or a plain callback and return your own teardown.
<view ref={node => {
  measure(node);
  return () => release(node);
}} />;
```

The type surface rejects the object-literal form, so a `tsc` run finds it before
runtime (`test/consumer/jsx-runtime.tsx` asserts the rejection with
`@ts-expect-error`; `pnpm typecheck:consumer` compiles it).

Covered by `test/renderer.test.ts:1083`, `:1110`, `:1270`.

### 3.2 Two ordering rules you may have relied on

Both are contract, both are covered by tests, and both break code written
against the DOM renderer's assumptions:

1. **The ref binding runs before the element's props.** A ref cannot read
   attributes or classes off the node — they are not applied yet. Do the read in
   an effect or on first event.
2. **Moving an element during reconciliation does not re-fire its ref.** A keyed
   reorder keeps the same attachment; do not use a ref callback as a
   "row appeared" hook.

Covered by `test/renderer.test.ts:1214` (reorder) and the ordering note in
`docs/capabilities.md` "Refs and imperative access".

### 3.3 Cleanup is now automatic (and previously was not)

A ref's returned teardown is registered against the owning Solid scope
(`src/universal.ts:103-113`). If your 0.x code manually nulled a ref on teardown
because nothing released it, that manual step is now redundant but harmless.
`createLynxRef()` clears `current` itself when the element it attached goes away.

## 4. CSS ids

### 4.1 Replace manual `__SetCSSId` loops with `root.setCSSId()`

If you were calling the PAPI yourself, delete that and call the root:

```ts
root.setCSSId(3, "index");   // one batched __SetCSSId call
```

What changed versus hand-rolling it (`src/root.ts:56-153`):

- The call is **batched**: one `__SetCSSId(elements, cssId, entryName)` per root,
  not one per element.
- Scope is the **root's own page children**. A second root on the same page is
  never restyled. A nested element is not sent; the id reaches it through the
  element tree.
- Elements inserted into the page **after** the call get the id on arrival.
- An invalid id (`-1`, `1.5`, `NaN`) throws `TypeError` **before** the root
  records anything, so a rejected call leaves the root unchanged.
- A host without `__SetCSSId` **throws** rather than silently rendering
  unstyled. If you relied on the silent no-op, that is now a hard failure by
  design.

Covered by `test/renderer.test.ts:1302`, `:1329`, `:1349`, `:1375`, `:1388`,
`:1402`, `:1420`, `:1441`; browser equivalents at
`test/browser/lynx-for-web.test.ts:694`, `:719`, `:747`, `:766`.

### 4.2 A CSS id is not a stylesheet

`setCSSId` only selects among stylesheets the Lynx toolchain **already compiled
into the bundle**. Loading, replacing, or removing a stylesheet at runtime is
**unsupported** and will not be added by your migration: web-core exposes no
such Element PAPI. This is unchanged from the pre-1.0 position and is recorded
in [capabilities.md](capabilities.md) "Stylesheet loading and lifecycle".

If your app currently "loads" a stylesheet at runtime, it is not doing so
through this renderer. Move that work to the build (`pluginVanillaLynx` takes an
`entry.css` or a sibling `style.css`) and use `setCSSId` to select it —
`docs/capabilities.md` "CSS ids" describes that split.

## 5. Events and properties

### 5.1 `onClick` is a *translation*, and it is switchable

The `onX` → `bind*` rewriting happens only when `transformEventNames` is on
(`src/events.ts:29-34`). It defaults to `true` at the host layer
(`src/lynx-host.ts:212`), and `createLynxRoot` forwards your option unchanged
(`src/root.ts:111-113`), so:

- Omitting it ⇒ translation on.
- Passing `false` ⇒ `onClick` becomes a plain attribute and **never fires**.

The `on:<name>` form always compiles to a binding, whatever the flag says
(`src/events.ts:21-26`). If you set `transformEventNames: false` in 0.x to get
"Lynx-native only" props, keep doing that and use `bind*`/`on:` forms — do not
mix in `onClick`.

Covered by `test/renderer.test.ts:368`, `:442`.

### 5.2 Handler shapes

A prop value is either a function `(event) => void` or a
`[handler, data]` tuple called as `handler(data, event)`. Anything else throws
`TypeError` at the point the prop is set (`src/lynx-host.ts:225-238`). If you
were passing `null`, `false`, or an object to "clear" a handler, pass
`undefined` — that is the value that detaches the registration
(`src/lynx-host.ts:225-232`).

`[handler, data]` is typed (`LynxBoundEventHandler`) and compiles, but no test in
this repository dispatches through a tuple, so its runtime behaviour is
**unverified**. If you depend on it, add your own test rather than trusting it.

### 5.3 One registration per slot, and removal matches registration

Each binding is filed under `namespace:type:name` (`src/lynx-host.ts:222`) and
removed with the **same** options object shape it was added with
(`src/events.ts:68-88`). Consequences for a migrating app:

- Swapping a handler retargets the existing registration; it does not add a
  second listener (`test/renderer.test.ts:757`).
- `bindtap` and `main-thread:bindtap` on one element are two registrations, not
  one. `main-thread:` adds `closure_type: 2`; `background:` adds nothing beyond
  the slot key.
- Removing a subtree detaches all of its listeners; re-inserting restores them
  (`test/renderer.test.ts:789`).

If you were double-registering to "make sure" a handler fires, that now leaves a
stale slot when you remove one of the two.

### 5.4 `global-bind` is registered but not delivered by web-core

Unchanged, and still worth checking in a migration because it produces no error:
`@lynx-js/web-core` files a `global-bind` handler in its own slot but does not
run the global pass for function callbacks. The renderer registers and removes it
correctly. Native delivery is unmeasured. See
[capabilities.md](capabilities.md) and
[parity-checklist.md](parity-checklist.md) "Runtime behaviour".

If your app relies on `global-bind:tap`, it does not work on the web host today.
Use a `bindtap` on a common ancestor.

### 5.5 Property mapping is fixed

From `src/lynx-host.ts:302-323`, the mapping a migration must not fight:

| You write | What happens |
| --- | --- |
| `class` / `className` | `__SetClasses`, stringified |
| `style` (string or object) | `__SetInlineStyles`, forwarded as-is |
| `id` | `__SetID` when the host has it, otherwise `__SetAttribute` |
| `data-*` | dataset PAPI when the host has it, otherwise `__SetAttribute` |
| `textContent` | the Lynx `text` attribute |
| `disabled`/`checked`/`readonly`/`selected`/`multiple`/`required` (boolean) | the attribute name or `null` — never `true`/`false` |
| anything else | `__SetAttribute` |

Note the `id` fallback: on a host without `__SetID`, `id` becomes an ordinary
attribute. If you were reading `node.id`, it may be `undefined` there.

Covered by `test/renderer.test.ts:690` and, on the web host,
`test/browser/lynx-for-web.test.ts:516`.

### 5.6 Event payloads are typed, not validated

`LynxEvent` (`src/jsx-types.ts:27-40`) declares `type`, `timestamp`, `target`
(`dataset`, `id`, `uid`), `currentTarget`, and `detail`. The renderer forwards
whatever the host passes without inspecting it (`src/lynx-host.ts:248-264`). A
host that omits `currentTarget` still type-checks and still reaches your handler
with `undefined`. Guard for it if you destructure.

## 6. Lists

This section changed the most, and in the opposite direction from what an early
0.x reader would expect: there **is** now an indexed-list adapter, and `<list>`
in JSX is now a deliberate build-time error.

### 6.1 `root.createList()` is the list API

`LynxRoot.createList()` (`src/root.ts:31-61`) creates the list through
`__CreateList` and hands the host a `componentAtIndex`/`enqueueComponent` pair
that materializes exactly the requested row:

```tsx
const list = root.createList({
  items: () => tasks,              // read lazily: a callback never sees a snapshot
  getKey: task => task.id,         // optional; defaults to item identity
  children: (task, index) => (
    <view>
      <text>{task.label}</text>
      <text>#{index()}</text>
    </view>
  ),
});

list.materialize(0);   // what componentAtIndex does
list.update();         // model changed: move survivors, release dropped rows, re-install callbacks
list.dispose();        // release every row and detach the callbacks
```

Facts a migration must get right, each covered by a test:

- `index` is an **accessor**, not a number. Read `index()` inside the row so a
  row that keeps its key updates in place instead of being rebuilt
  (`src/list.ts:6-13`; `test/renderer.test.ts:1721`).
- `children` runs **once per key**. A key that moves keeps its node and its
  Solid scope; only a replaced *item* rebuilds it
  (`test/renderer.test.ts:1612`, `:1642`).
- `update()` is required to reflect a new model. The callbacks read the model
  lazily so they never serve a stale row, but rows that left the model are only
  released and the callbacks only re-installed when you call it
  (`test/renderer.test.ts:1747`, `:1770`).
- `dispose()` is idempotent, and lists a root created are disposed with the root
  (`src/root.ts:146-150`). After disposal, `materialize`/`update` throw
  (`test/renderer.test.ts:1816`).
- A host without **both** `__CreateList` and `__UpdateListCallbacks` makes
  `createList()` throw before anything is created
  (`test/renderer.test.ts:1844`, `:1857`). There is no degraded fallback, by
  design.

### 6.2 `<list>` in JSX no longer compiles, on purpose

If a 0.x app wrote `<list>` and got a container, that path is gone:

- `list` and `x-list` are **absent** from `JSX.IntrinsicElements`
  (`src/jsx-types.ts:164-176`), so JSX fails to type-check.
- `createElement("list")` throws at runtime, naming `createList()` when the host
  has the list PAPI and naming the missing PAPI when it does not
  (`src/lynx-host.ts:201-215`; `test/renderer.test.ts:1885`, `:1900`).

Migrate to `root.createList()` if the host drives row selection, or to `For` if
it does not. `list-item`, `x-list-item`, and the swiper/viewpager/web-view tags
are still ordinary intrinsics (`src/jsx-types.ts:175-181`).

### 6.3 `For` is still the right answer when the host does not drive rows

```tsx
import { For } from "solid-js";

<view>
  <For each={rows()}>{row => (
    <view><text>{row.label}</text></view>
  )}</For>
</view>;
```

`For` is Solid's own keyed list re-exported from the package
(`src/index.ts:16-25`), covered by `test/renderer.test.ts:561` (unit) and
`test/browser/patterns.test.ts:180` (keyed rows across insert, remove, and
reorder). It is not virtualized: live element count equals row count.

### 6.4 Do not claim virtualization you do not have

Two limits are stated in [capabilities.md](capabilities.md) "List
virtualization" and must not be softened in your own docs:

- **No recycling has been observed.** Every requested cell becomes a real child
  element. `operationId` and `enableReuseNotification` are accepted and given no
  meaning.
- **Native list support is unverified.** The 2026-10-09 A03 smoke rendered the
  native parity card and verified its counter tap; that card created no list and
  called neither callback.

## 7. JSX types

### 7.1 Your custom tags still work, through declaration merging

Custom tags were never part of the intrinsic list and still are not. Declare them
in your own `.d.ts`, against **both** runtime entries, using
`LynxCustomElementAttributes`:

```ts
import type { LynxCustomElementAttributes } from "solid-lynx";

type MeterAttributes = LynxCustomElementAttributes<{ value: number }>;

declare module "solid-lynx/jsx-runtime" {
  namespace JSX {
    interface IntrinsicElements { "x-meter": MeterAttributes }
  }
}
declare module "solid-lynx/jsx-dev-runtime" {
  namespace JSX {
    interface IntrinsicElements { "x-meter": MeterAttributes }
  }
}
```

The double declaration is required: TypeScript resolves the module named by
`jsxImportSource` plus the current JSX mode, so a declaration on only one entry
fails the other build. `test/consumer/custom-elements.d.ts` is the working
example, compiled by both consumer tsconfigs.

### 7.2 Expect the types to reject more than they used to

The frozen type surface deliberately rejects (`test/consumer/jsx-runtime.tsx`):

- unknown tags without a declaration,
- unknown attributes on built-in tags,
- string values for boolean PAPI properties (`disabled="yes"`),
- unchecked CSS property names in a style object,
- event props that are not a callback or `[callback, data]`,
- non-serializable dataset values (`LynxDatasetValue`, `src/jsx-types.ts:8-15`),
- ref callbacks typed as DOM elements,
- plain-object refs,
- `<list>` and `<x-list>` in JSX, which are deliberately absent so a list cannot
  silently render every row (`src/jsx-types.ts:164-176`; use
  `root.createList()`, §6.1).

If your app compiled before by accident, `pnpm typecheck` in your repo may now
report these. They are real: each is a case that silently did the wrong thing at
runtime.

### 7.3 `@lynx-js/types` is not what you are getting

These JSX types are a **bounded local surface**, not the official Lynx schema.
`@lynx-js/types` is not a dependency of this repository
([compatibility.md](compatibility.md) §8). If you need an element or attribute
that is not declared, declare it yourself with a custom-element entry — do not
assume the package will grow the official typing. This is unchanged from the 0.4
position and stated in [capabilities.md](capabilities.md) and
[contract.md](contract.md) §12.

## 8. Root lifecycle

### 8.1 `render` is one tree at a time; `dispose` is reusable

```ts
const root = createLynxRoot({ page, parentComponentId });
const dispose = root.render(() => <App />);

// A second render while the first tree is mounted throws:
//   "A Solid Lynx root can only be rendered once"
root.render(() => <App />);   // throws

dispose();                    // disposes Solid, detaches listeners, removes nodes
root.render(() => <App />);   // allowed again: fresh tree, fresh listeners
```

The returned disposer **is** the root's `dispose` (`src/root.ts:134`), and a
second call returns without throwing because there is nothing left to dispose or
remove (`src/root.ts:117-126`). That double-dispose claim is reasoned from the
code, not asserted by a test; what is tested is dispose-then-remount in
`test/renderer.test.ts:853`, and node removal in `:561`.

If your 0.x integration created a new root per mount and never disposed the old
one, that leaked listeners. Reuse the root, or dispose before replacing.

### 8.2 Several roots can share a page

Each root removes only the nodes it inserted into its page
(`src/root.ts:57-62`, `:87-108`, `:117-126`). Passing a per-root **container**
element as `page` is how the web example hosts a second root
(`examples/lynx-for-web/src/main-thread.tsx:404-411`). Covered by
`test/renderer.test.ts:1014` and `test/browser/lynx-for-web.test.ts:471`.

## 9. Deterministic cleanup

This section is the migration-critical one: it says what the renderer proves it
cleans up, and what it does not. Do not claim more in your own docs than the
right-hand column supports.

### 9.1 Proven

| What is cleaned up | Mechanism | Proven by |
| --- | --- | --- |
| Nodes the root inserted into its page are removed on `dispose()`, and no others | `src/root.ts:86-116`, `:148-158` | `test/renderer.test.ts:561`, `:1014`; browser `test/browser/lynx-for-web.test.ts:471` |
| Every listener the root registered is removed, in the slot it was filed in | `src/lynx-host.ts:453-455`, reached from `src/root.ts:149` | `test/renderer.test.ts:976` (asserts the add/remove slot tuples match), `:821` |
| Removing a subtree detaches its listeners; re-inserting restores them | `src/lynx-host.ts:266-276`, `:436-452`, `:453-455` | `test/renderer.test.ts:789` |
| Every ref the root attached is released | `src/universal.ts:103-113`, `src/refs.ts:47-56` | `test/renderer.test.ts:1300`; browser `:606`, `:630` |
| `dispose()` ends with a `__FlushElementTree`, so its removals are not left pending | `src/renderer.ts:39`, `src/root.ts:157` | `test/renderer.test.ts:2086` |
| Roots sharing a page dispose independently | `src/root.ts:86-116` | `test/renderer.test.ts:1151`; browser `:471` |
| A disposed root remounts with fresh listeners | `src/root.ts:163-168` | `test/renderer.test.ts:853`; browser `:471` |
| Swapping a handler does not add a second registration | `src/lynx-host.ts:310-315` | `test/renderer.test.ts:757`; browser `:442` |
| Lists a root created are disposed with the root, and disposing a list releases every row and its listeners | `src/root.ts:146-150`, `src/list.ts:296-305` | `test/renderer.test.ts:1983`, `:1829` |
| A root that owned all of the above leaves no residual host state — no nodes, no live registration, no ref, no list row, no CSS id left on a live element | `src/root.ts:148-158` | `test/renderer.test.ts:2086` |

### 9.2 Not proven

| Statement | Status |
| --- | --- |
| **Stylesheet cleanup** | Not applicable: the renderer never loads a stylesheet. A CSS id assigned by `setCSSId` stays on its elements; disposal removes the elements, and no un-assign call is made or needed. No test asserts anything about a stylesheet because no host here has one to assert against. This is outside the claim, not a gap in it — the 1.0 roadmap box is scoped to the resources the renderer acquires. |
| How many `__FlushElementTree` calls one `dispose()` performs | Not asserted. Two on a rendered root, three when it owned a list; only "the last call is a flush" is tested (`test/renderer.test.ts:2086`). |
| Disposal ordering between two roots disposing in the same task | Unspecified and untested. Each root removes its own nodes in insertion order. |
| Native listener-slot removal and node removal after `dispose()` | **Unmeasured.** The device run proved load, render, and tap dispatch; it did not assert cleanup afterward. |
| `global-bind` delivery after cleanup | Not observable on web-core, which never invokes the callback; the registration lifecycle itself is covered. |
| Cleanup of a root whose `page` was removed by the host first | Untested. `dispose()` only removes a node when `getParentNode(node) === page` (`src/root.ts:154`). |

### 9.3 What a migration must keep doing itself

These are outside the renderer's ownership, and no version of this package will
take them over:

- Removing the root on your host's own teardown event. Both examples do this
  through the Lynx engine: `engine.addEventListener("__RenderPage", …)` and
  `__DestroyLifetime` (`examples/lynx-for-native/src/main-thread.tsx:119-120`,
  and the Quick start in `README.md`).
- Clearing timers, subscriptions, or `AbortController`s your app created. Solid
  disposes owners; it does not know about your side channels. Use `onCleanup`.
- Stopping a build-time or server-side resource. Out of scope per `ROADMAP.md`
  "Out of scope for the renderer".
- Releasing anything you handed to the Lynx host outside the Element PAPI (native
  modules, page lifecycle). Unmeasured here.

## 10. Verification checklist

Run these from your app after migrating. The first two are the ones that catch
type-surface regressions; the rest prove runtime parity.

1. `tsc --noEmit` (or your equivalent) — catches ref shape, event handler shape,
   unknown attributes, and dataset value errors (§3, §7).
2. Your JSX/dev JSX build, then the consumer fixture pattern from this repo:
   `pnpm typecheck:consumer` here compiles `test/consumer/tsconfig.json` and
   `test/consumer/tsconfig.dev.json` against the built `dist/`, so a type-surface
   regression fails a command rather than a runtime test.
3. Render, then drive one tap handler per binding form you use: `bind*`,
   `catch*`, `capture-bind:*`, `capture-catch:*`, `main-thread:*`. On the web
   host, do **not** expect `global-bind:*` to fire (§5.4).
4. Assign a CSS id and confirm one `__SetCSSId` call carrying all page children
   (§4.1).
5. If you use `root.createList()`: ask for two out-of-order cells and confirm
   they land in index order, call `update()` after changing the model and
   confirm the callbacks were re-installed, then confirm `dispose()` leaves no
   rows and an inert callback pair (§6.1).
6. Dispose the root, then confirm: page is empty of that root's nodes, no
   listeners remain, refs are clear, lists it created are disposed, and a second
   `render()` works (§8, §9).
7. Add a `solid-lynx/parity` run to a debug build if you need to compare hosts
   ([building.md](building.md), "Running the parity harness"); it reports
   `pass`/`fail`/`unsupported` per operation and removes its own sandbox.

## 11. What this guide could not verify

- **Native behaviour beyond the recorded smoke.** Load, render, `bindtap`
  dispatch, and all twenty shared Element PAPI operations were observed once on
  Lynx Explorer 4.1.0 / engine 3.5 on an SM-A037U. Cleanup, capture/propagation,
  `global-bind`, CSS-id execution, and stylesheet semantics were not.
- **The `[handler, data]` tuple at dispatch time.** Typed, no test.
- **The `use:` directive syntax.** The function form it compiles to is tested;
  the directive form itself is not exercised in this repository.
- **The page-creating branch of `createLynxRoot`.** Every test supplies `page`.
  If your app relies on the root creating the page (`componentId`/`cssId` with no
  `page`), that path has no automated test here — `docs/contract.md` §16 lists it
  as a coverage gap, and `docs/building.md` records the device behaviour
  (`__GetPageElement()` is `null` until `__CreatePage()` is called).
- **`Suspense`, `SuspenseList`, `Switch`, `Match`, `Index`, `ErrorBoundary`.**
  Re-exported from Solid, used by no test or example here. Do not treat them as
  supported just because they import.
- **List cell recycling and native list behaviour.** The adapter is measured
  against `@lynx-js/web-core@0.26.2` only; no host has been seen to recycle a
  cell, and no device run has created a list (§6.4).

Where this guide and [contract.md](contract.md) differ, the contract wins.
Where either differs from [capabilities.md](capabilities.md) on a platform
capability, `capabilities.md` wins, because it is the file that records what was
measured.
