# Public contract (frozen for 1.0)

This document freezes the public contract of `solid-lynx@0.1.0` as it exists in
this repository. Everything here is copied from the source named next to it; the
"Covered by" column names the test that fails if the behaviour changes.

Statuses used in this document:

| Status | Meaning |
| --- | --- |
| **stable** | Part of the frozen contract. Its behaviour is covered by at least one automated test in this repository, and a change is a breaking change. |
| **provisional** | Exported and usable, but either not covered by a test or exercised only on one host. It may change in a 1.x minor release; it will not be removed without a deprecation. |
| **unsupported** | Not provided by this package. Using it fails loudly or does nothing, as described, and no compatibility promise is made. |

Anything not listed below is not part of the contract, including anything under
`src/` that is reachable only by deep import and any symbol that is exported but
not described here.

Nothing in this document changes renderer behaviour. Where a claim could not be
verified in this repository it is marked **unverified** rather than asserted.

## 1. Entry points

`package.json` `exports` decides what a consumer can import. From
`package.json:21-42`:

| Specifier | Types | Runtime | Contract |
| --- | --- | --- | --- |
| `solid-lynx` | `dist/index.d.ts` | `dist/index.js` | stable |
| `solid-lynx/jsx-runtime` | `dist/jsx-runtime.d.ts` | `dist/jsx-runtime.js` | stable for its **types**; the runtime functions are **provisional** (see below) |
| `solid-lynx/jsx-dev-runtime` | `dist/jsx-dev-runtime.d.ts` | `dist/jsx-dev-runtime.js` | stable for its **types**; the runtime functions are **provisional** (see below) |
| `solid-lynx/parity` | `dist/parity.d.ts` | `dist/parity.js` | provisional (diagnostic tooling) |
| `solid-lynx/rspeedy` | `dist/rspeedy.d.ts` | `dist/rspeedy.js` | stable |

The package is ESM only (`"type": "module"`, `package.json:18`) and declares
`"sideEffects": false` (`package.json:19`). There is no CommonJS entry, no
`./package.json` export, and no deep-import export for individual modules, so
`solid-lynx/dist/root.js` is outside the contract even though it resolves.

A note on the JSX entry points, because the distinction matters for a migration:
TypeScript resolves `jsxImportSource: "solid-lynx"` through the `jsx-runtime`
and `jsx-dev-runtime` type entries, and that type surface is contract. At build
time this repository does **not** use the automatic runtime: `pluginSolidLynx()`
registers `babel-preset-solid` with `generate: "universal"`, which emits
`createComponent`/`insert` calls against the root entry instead (§13). The
runtime functions exported by those two entry points (`jsx`, `jsxs`, `jsxDEV`,
`Fragment`) are therefore typed and shipped but exercised by no test in this
repository; they are **provisional**. See §16.

The root entry re-exports the Solid control-flow components `For`, `Show`,
`Switch`, `Match`, `Suspense`, `SuspenseList`, `Index`, and `ErrorBoundary`
directly from `solid-js` (`src/index.ts:16-25`). `Portal` and `Dynamic` are
**unsupported**: `babel-preset-solid` would import them from this package and
the import fails at build time (see [building.md](building.md), "Known
limitation", and `docs/capabilities.md`, "Overlays and portals").

`version` (`src/index.ts:70`) is the string `"0.1.0"`. It is exported, it is
**provisional**, and no test asserts it.

## 2. `createLynxRoot(options?)`

Source: `src/root.ts:66`. Signature, exactly as written:

```ts
export function createLynxRoot(options: LynxRootOptions = {}): LynxRoot
```

### 2.1 `LynxRootOptions`

`src/root.ts:11-23`:

```ts
export interface LynxRootOptions {
  /** Existing page element. If omitted, createPage is used. */
  page?: LynxNode;
  /** Component id passed to __CreatePage when a page is created. */
  componentId?: string;
  /** CSS id passed to __CreatePage when a page is created. */
  cssId?: number;
  /** Explicit parent component id for hosts without __GetElementUniqueID. */
  parentComponentId?: number;
  /** Injected PAPI surface, useful for tests and alternate Lynx runtimes. */
  papi?: LynxPapi;
  transformEventNames?: boolean;
}
```

| Option | Default | Contract | Notes |
| --- | --- | --- | --- |
| `page` | created through `createLynxPage(componentId ?? "0", cssId ?? 0, papi)` (`src/root.ts:68-69`) | stable | Passing a page is the only form covered by tests; the page-creating branch is **unverified** by an automated test (see §16). |
| `componentId` | `"0"` | stable | Used only when `page` is omitted. `test/renderer.test.ts:442` passes it while supplying `page`, so it is accepted-and-ignored there. |
| `cssId` | `0` | stable | Used only when `page` is omitted; forwarded to `__CreatePage`. |
| `parentComponentId` | `getLynxPageId(page, papi)` (`src/root.ts:70-71`) | stable | Any integer. Tests pass explicit values (`test/renderer.test.ts:527`). |
| `papi` | `globalThis` cast to `LynxPapi` (`src/root.ts:44`) | stable | The injection seam every unit test uses. |
| `transformEventNames` | `true` at the host layer (`src/renderer.ts:43`, `src/lynx-host.ts:282`) but `undefined` here unless passed | stable | See §7.2. Omitting it is not the same as passing `false`: the host's own default is `true`. |

### 2.2 `LynxRoot`

`src/root.ts:25-64`:

```ts
export interface LynxRoot {
  readonly page: LynxNode;
  readonly renderer: LynxRenderer<LynxNode>;
  render(code: () => LynxNode): () => void;
  setCSSId(cssId: number | null, entryName?: string): void;
  dispose(): void;
  flush(): void;
}
```

| Member | Contract | Behaviour | Covered by |
| --- | --- | --- | --- |
| `page` | stable | The element the root rendered into: the `page` option, or the element `__CreatePage` returned. | `test/renderer.test.ts` (implicitly, through the fake page; no test asserts `root.page` identity — **unverified as an identity assertion**) |
| `renderer` | stable | The `LynxRenderer<LynxNode>` for this root (§4). Compiler-helper routing through it is tested. | `test/renderer.test.ts:527` |
| `render(code)` | stable | Mounts the tree, returns the root's disposer. Throws `"A Solid Lynx root can only be rendered once"` while a tree is still mounted (`src/root.ts:163-166`). | `test/renderer.test.ts:377`, `:853` |
| `setCSSId(cssId, entryName?)` | stable | See §8. | `test/renderer.test.ts:1302-1441`, `test/browser/lynx-for-web.test.ts:694-766` |
| `dispose()` | stable | See §9. | `test/renderer.test.ts:561`, `:976`, `:1014` |
| `flush()` | stable | Calls `host.flush()`, i.e. `__FlushElementTree()` immediately. | `test/renderer.test.ts:505`, `:733` |

Two more `render` facts are stable and tested:

- The returned disposer is the root's `dispose`, not a per-tree disposer
  (`src/root.ts:169`). Disposing twice does not throw: the second call has no
  renderer to dispose and no owned nodes left to remove (`src/root.ts:148-158`).
  This reasoning follows from the code but is **not asserted by a test**; what
  is tested is dispose-then-render-again (`test/renderer.test.ts:853`).
- After `dispose()`, `render` is accepted again and mounts a fresh tree with
  fresh listeners (`test/renderer.test.ts:853`,
  `test/browser/lynx-for-web.test.ts:471`).

`renderLynxPage(code, options?)` (`src/root.ts:194-200`) is
`createLynxRoot(options)` followed by `root.render(code)`, returning the root.
It is exported, it is **provisional**, and no test or example calls it.

## 3. `createLynxRenderer(host, options?)`

Source: `src/renderer.ts:7`:

```ts
export function createLynxRenderer<Node extends object>(
  host: LynxHost<Node>,
  options: RendererOptions = {},
)
```

`RendererOptions` (`src/host.ts:92-95`) has exactly one field:
`transformEventNames?: boolean`.

The returned object is `LynxRenderer<Node>` = `ReturnType<typeof
createLynxRenderer<Node>>` (`src/renderer.ts:49`). Beyond the Solid universal
renderer surface it adds:

| Member | Contract | Note |
| --- | --- | --- |
| `render(code, parent)` | stable | Wraps the Solid renderer, flushes the host after mounting, and returns a disposer that disposes Solid and flushes again (`src/renderer.ts:31-41`). |
| `flush()` | stable | `host.flush()` (`src/renderer.ts:42`). |
| `parseEventProp(name)` | **provisional** | Applies `options.transformEventNames ?? true` and returns a `ParsedEventProp` (`src/renderer.ts:43`). No test calls this method; the pure functions it wraps are tested directly (§7). |

The remaining members are Solid's universal renderer surface as re-exported by
`solid-js/universal`: `effect`, `memo`, `createComponent`, `createElement`,
`createTextNode`, `insertNode`, `insert`, `spread`, `setProp`, `mergeProps`,
`use` (see `dist/renderer.d.ts`). Their signatures are Solid's, not this
package's; treat them as stable only in the shapes the package's own root
entry exposes (§5).

Using `createLynxRenderer` directly means the caller owns disposal, the
transient Solid renderer context, and page bookkeeping. `test/renderer.test.ts`
does this for isolated host tests (`:377`, `:658`).

## 4. `createGlobalLynxHost(options)` / `createLynxHost`

Source: `src/lynx-host.ts:102` and the alias at `src/lynx-host.ts:532`:

```ts
export function createGlobalLynxHost(options: GlobalLynxHostOptions): LynxHost<LynxNode>
export const createLynxHost = createGlobalLynxHost;
```

`createLynxHost` is the same function object under a shorter name. It is
**provisional**: it is exported, but no test or example calls it by that name.

### 4.1 `GlobalLynxHostOptions`

`src/lynx-host.ts:78-83`:

```ts
export interface GlobalLynxHostOptions {
  getParentComponentId: () => number;
  transformEventNames?: boolean;
  flushScheduler?: (flush: () => void) => void;
  papi?: LynxPapi;
}
```

| Option | Contract | Notes |
| --- | --- | --- |
| `getParentComponentId` | stable | Called for every element creation (`src/lynx-host.ts:216-219`, `:368`). Throws are propagated. |
| `transformEventNames` | stable | Defaults to `true` (`src/lynx-host.ts:282`). |
| `flushScheduler` | **provisional** | Overrides microtask scheduling (`src/lynx-host.ts:189`). Tests use it to run flushes synchronously; an app that supplies one takes over commit ordering. |
| `papi` | stable | Defaults to `globalThis` (`src/lynx-host.ts:162`). |

### 4.2 `LynxHost<Node>` — the interface a custom host implements

`src/host.ts:36-90`:

```ts
export interface LynxHost<Node extends object = LynxNode> {
  createElement(tagName: string): Node;
  createTextNode(value: string): Node;
  createComment(data: string): Node;
  replaceText(node: Node, value: string): void;
  setProperty(node: Node, name: string, value: unknown, previous?: unknown): void;
  setCSSId?(elements: Node[], cssId: number | null, entryName?: string): void;
  createList?(callbacks: LynxListCallbacks<Node>): Node;
  updateListCallbacks?(list: Node, callbacks: LynxListCallbacks<Node>): void;
  detachListeners?(node: Node): void;
  insertNode(parent: Node, node: Node, anchor?: Node): void;
  removeNode(parent: Node, node: Node): void;
  isTextNode(node: Node): boolean;
  getUniqueId?(node: Node): number | undefined;
  getParentNode(node: Node): Node | undefined;
  getFirstChild(node: Node): Node | undefined;
  getNextSibling(node: Node): Node | undefined;
  flush(): void;
}
```

Contract: **stable** as a type. Each optional member's absence is meaningful
rather than a default:

| Member | Absent means | Enforced by |
| --- | --- | --- |
| `setCSSId` | The host cannot assign CSS ids | `root.setCSSId()` throws (`src/root.ts:96-106`), tested by `test/renderer.test.ts:1420` |
| `createList` + `updateListCallbacks` | The host cannot virtualize | `root.createList()` throws before creating anything (`src/list.ts:117-121`), tested by `test/renderer.test.ts:1844` |
| `detachListeners` | A host-driven row removal cannot detach the row's listeners | Optional call site at `src/list.ts:162` |
| `getUniqueId` | The list PAPI cannot identify rows | `componentAtIndex` returns `undefined` rather than a bogus id (`src/list.ts:246-261`) |

`createList` and `updateListCallbacks` are treated as one capability: a host with
only the first is reported as missing the second, at the call, rather than
failing later during `update()` or `dispose()` (`src/lynx-host.ts:123-126`,
tested by `test/renderer.test.ts:1857`).

`createComment(data)` is part of the interface but no code in this package calls
it — `src/lynx-host.ts:346-356` is its only occurrence in `src/`, and the Solid
universal renderer this package configures does not request a comment creator.
The method exists so an implementation satisfies the type; treat its semantics
as **unverified**.

`LynxNode` is `interface LynxNode { readonly [key: string]: unknown }`
(`src/host.ts:1-3`). It is an opaque handle, not a DOM node.

## 5. The JSX compile contract (compiler helpers)

`solid-lynx`'s root entry exports the helper functions that
`babel-preset-solid` with `generate: "universal"` emits
(`src/index.ts:1-14`, implementations in `src/universal.ts`). Contract:
**stable**, because a compiled bundle does not work without them.

| Export | Signature (`dist/universal.d.ts`) | Note |
| --- | --- | --- |
| `createComponent` | `<T>(component: (props: T) => LynxNode, props: T): LynxNode` | stable |
| `createElement` | `(tagName: string): LynxNode` | stable |
| `createTextNode` | `(value: string): LynxNode` | stable |
| `insertNode` | `(parent: LynxNode, node: LynxNode, anchor?: LynxNode): void` | stable |
| `insert` | `(parent: LynxNode, accessor: (() => unknown) \| unknown, marker?: LynxNode \| null, initial?: unknown): LynxNode` | stable |
| `spread` | `(node: LynxNode, accessor: (() => unknown) \| unknown, skipChildren?: boolean): void` | stable |
| `setProp` | `<T>(node: LynxNode, name: string, value: T, previous?: T): T` | stable |
| `mergeProps` | `(...sources: unknown[]): unknown` | stable |
| `use` | `<A, T>(fn: (element: LynxNode, arg: A) => T, element: LynxNode, arg?: A): T` | stable; the ref/`use:` path, §6 |
| `render` | `(code: () => LynxNode, parent: LynxNode): () => void` | stable |
| `effect` | `<T>(fn: (previous?: T) => T, initial?: T): void` | stable |
| `memo` | `<T>(fn: () => T, equals?: boolean): () => T` | stable |

The list types are exported from the root entry as **types only**
(`src/index.ts:48-49`): `LynxList`, `LynxListOptions`, `LynxListRow`, and
`LynxListCallbacks`. `createLynxList` itself is **not** exported from the package
root, so the supported entry point is `root.createList()` (§11.1).

Also exported from `src/universal.ts` code and from the root entry:

- `initializeLynxRootContext(id: number)` — sets the module-level
  `parentComponentId` that the module-level renderer uses; throws `TypeError` for
  a non-integer. **Provisional**: exported, no test calls it, and it mutates
  module state shared by every importer.
- `ensureLynxEnvironmentBasics()` — installs `globalThis.queueMicrotask` from a
  promise if the host lacks it. **Provisional**: called by both examples
  (`examples/lynx-for-web/src/main-thread.tsx:2`,
  `examples/lynx-for-native/src/main-thread.tsx:2`) but covered by no test.

The module-level helpers route to the renderer registered for the current Solid
owner, falling back to a module-level renderer
(`src/universal.ts:21-24`). Two roots in one realm are kept apart by that owner
lookup, which `test/renderer.test.ts:527` covers.

## 6. Refs and imperative access

Source: `src/refs.ts`. Contract: **stable**.

```ts
export type LynxRefCallback<Element extends LynxNode = LynxNode> = (
  element: Element,
) => (() => void) | void;

export interface LynxRefObject<Element extends LynxNode = LynxNode> {
  (element: Element): () => void;
  current: Element | undefined;
}

export type LynxRef<Element extends LynxNode = LynxNode> =
  | LynxRefCallback<Element>
  | LynxRefObject<Element>;

export function createLynxRef<Element extends LynxNode = LynxNode>(): LynxRefObject<Element>
```

Frozen behaviour, each item traceable to a test:

| Statement | Covered by |
| --- | --- |
| A callback ref receives the live Lynx PAPI node, not a DOM element, and its returned teardown runs when the owning Solid scope is disposed. | `test/renderer.test.ts:1083`, `:1130`; `test/browser/lynx-for-web.test.ts:630` |
| `createLynxRef()` is callable as a `ref` value and holds `current`; `current` is cleared by its teardown. | `test/renderer.test.ts:1110`; `test/browser/lynx-for-web.test.ts:606` |
| Disposing the root clears every ref it attached. | `test/renderer.test.ts:1163` |
| An older attachment's teardown does not clear a newer attachment. | `test/renderer.test.ts:1197` |
| Reconciliation that moves an element (keyed reorder) does not re-fire the ref. | `test/renderer.test.ts:1214` |
| A ref returning a non-function does not throw at disposal. | `test/renderer.test.ts:1270` |
| A ref run with no Solid owner registers no teardown and returns it to the caller. | `test/renderer.test.ts:1283` |
| A `ref` never becomes an element attribute. | `docs/capabilities.md` "Refs and imperative access"; the type surface is enforced by `test/consumer/jsx-runtime.tsx` |

Ordering, frozen and documented in `src/universal.ts` and
`docs/capabilities.md`: the Solid JSX transform emits the ref binding **before**
the element's props, so a ref cannot rely on attributes being set yet.

Not supported, stable as a rejection: a plain `{ current }` object literal as a
`ref` value. The type rejects it and `test/consumer/jsx-runtime.tsx`
asserts the rejection with `@ts-expect-error`.

`use(fn, element, arg)` and the `use:` directive take the same path and get the
same cleanup (`src/universal.ts:103-113`). The `use:` **directive** form has no
automated test in this repository, so treat that specific syntax as
**provisional**; the function form it compiles to is tested.

## 7. Events and properties

### 7.1 Event prop grammar

Source: `src/events.ts:1-45` (pattern, table, `parseEventProp`, `eventBindType`). Contract: **stable**.

```ts
const lynxEventPattern = /^(?:(main-thread|background):)?(global-bind|bind|catch|capture-bind|capture-catch):?([A-Za-z]+)$/;
```

Recognized forms, with the bind type the host is told (`src/events.ts:47-56`):

| Prop form | `ParsedEventProp.type` | `bind_type` |
| --- | --- | --- |
| `bind<name>` or `bind:<name>` | `bindEvent` | 1 |
| `catch<name>` or `catch:<name>` | `catchEvent` | 4 |
| `capture-bind<name>` / `capture-bind:<name>` | `capture-bind` | 2 |
| `capture-catch<name>` / `capture-catch:<name>` | `capture-catch` | 3 |
| `global-bind<name>` / `global-bind:<name>` | `global-bindEvent` | 5 |
| `on:<name>` | `bindEvent` | 1 |
| `onTap` (with `transformEventNames`) | `bindEvent`, event `tap` | 1 |
| `onClick` (with `transformEventNames`) | `bindEvent`, event `tap` | 1 |
| `onCatchTap` (with `transformEventNames`) | `catchEvent`, event `tap` | 4 |

Event names are lowercased (`src/events.ts:42`). The `main-thread:` and
`background:` prefixes are namespace qualifiers, not separate bind types; only
`main-thread` adds `closure_type: 2` to the listener options
(`src/events.ts:86`). A `background:` binding carries no extra listener option,
so the namespace is recorded in the slot key only (`src/lynx-host.ts:362`).

Every registration and removal is made with the **same** options object shape,
because hosts key a listener slot by name, bind type, and pass
(`src/events.ts:68-77`, `src/events.ts:78-88`). Covered by
`test/renderer.test.ts:582`, `:658`, `:976`; browser equivalents in
`test/browser/lynx-for-web.test.ts:331`, `:377`.

Frozen handler shapes (`src/lynx-host.ts:304-315`): a function
`(event) => void`, or a `[handler, data]` tuple where the handler is called as
`handler(data, event)`. Anything else throws
`TypeError: Event prop <prop> must be a function or [function, data]`. The
tuple form is typed as `LynxBoundEventHandler` (`src/jsx-types.ts:47-50`) and is
used from `test/consumer/jsx-runtime.tsx`; no unit test dispatches through a
tuple, so the runtime tuple behaviour is **unverified by test**.

Frozen lifecycle: listeners exist only while their node is in the rendered tree.
Inserting registers a node's bindings, removing detaches the whole subtree's
bindings, and re-inserting registers them again
(`src/lynx-host.ts:266-276`, `:196-205` via `:337-353`, `:354-355`). Covered by
`test/renderer.test.ts:789`.

### 7.2 `transformEventNames`

Contract: **stable**. When `true` (the default at the host layer,
`src/lynx-host.ts:282`), plain `onX` props are rewritten to Lynx `bind*` props
(`src/events.ts:29-34`). When `false`, an `onClick` prop is written to the
element as an ordinary attribute and never dispatched. `on:<name>` is always
translated regardless of this flag (`src/events.ts:21-26`).

Note the layering: `createLynxRoot` passes `options.transformEventNames`
straight through (`src/root.ts:134-136`), so leaving it out of root options
still yields `true` because the host applies its own default. Passing `false` is
the only way to disable it.

### 7.3 JSX event prop types

Source: `src/jsx-types.ts:65-103`. Contract: **stable**.

`LynxElementAttributes` declares index signatures for every accepted event prop
name: `bind*`, `bind:*`, `catch*`, `catch:*`, `capture-bind*`,
`capture-bind:*`, `capture-catch*`, `capture-catch:*`, `global-bind*`,
`global-bind:*`, `on*`, `on:*`, `main-thread:*`, and `background:*`, each typed
`LynxEventPropHandler | undefined` (`src/jsx-types.ts:89-102`).

The event object is a platform-neutral Element PAPI event, not a DOM event
(`src/jsx-types.ts:27-40`):

```ts
export interface LynxEventTarget {
  readonly dataset: Readonly<Record<string, LynxDatasetValue>>;
  readonly id: string | null;
  readonly uid: number;
}

export interface LynxEvent<Detail extends LynxEventDetail = LynxEventDetail> {
  readonly type: string;
  readonly timestamp: number;
  readonly target: LynxEventTarget;
  readonly currentTarget: LynxEventTarget | null;
  readonly detail: Detail;
}
```

`LynxEventDetail` is `Readonly<Record<string, LynxDatasetValue>>`
(`src/jsx-types.ts:17`). These are compile-time shapes only: the renderer
forwards the object the host passes to the listener without inspecting it
(`src/lynx-host.ts:318-334`), so a host that omits `currentTarget` or `detail`
is outside the type contract rather than caught by it. That gap is **unverified
at runtime**.

### 7.4 Property mapping

Source: `src/lynx-host.ts:365-399`. Contract: **stable**. Properties are
dispatched in this order; the first match wins:

| Property | PAPI call | Note |
| --- | --- | --- |
| `children`, `key`, `ref` | none | Dropped silently (`src/lynx-host.ts:366`). |
| any event prop (§7.1) | `__AddEventListener` / `__AddEvent` | Checked before every other rule. |
| `class`, `className` | `__SetClasses(node, String(value) ?? "")` | A non-string value is stringified. |
| `style` | `__SetInlineStyles(node, value)` | Objects and strings are forwarded as-is; no conversion. |
| `id` (only when the host has `__SetID`) | `__SetID(node, String(value) or null)` | Without `__SetID`, `id` falls through to `__SetAttribute`. |
| `data-*` (only when the host has `__AddDataset` or `__SetDataset`) | `__AddDataset(node, key, value)` or `__SetDataset(node, dataset)` | The dataset object is maintained per node by the host adapter. |
| `textContent` | `__SetAttribute(node, "text", String(value) ?? "")` | |
| `disabled`, `checked`, `readonly`, `selected`, `multiple`, `required` with a boolean value | `__SetAttribute(node, name, value ? name : null)` | Boolean attributes are written as the attribute name or `null`, never `true`/`false`. |
| everything else | `__SetAttribute(node, name, value ?? null)` | |

Covered by `test/renderer.test.ts:442`, `:690`; browser equivalent at
`test/browser/lynx-for-web.test.ts:516`.

`replaceText(node, value)` writes `__SetAttribute(node, "text", value)` and
requires the node to already be inserted; otherwise it throws
`"Cannot update a Lynx text node before it has been inserted"`
(`src/lynx-host.ts:357-364`). That throw is **unverified by test**.

### 7.5 Flush model

Contract: **stable**. Mutations queue one microtask flush; `queueMicrotask` is
used when present and a promise otherwise (`src/lynx-host.ts:184-200`). An
explicit `flush()` clears the queue and calls `__FlushElementTree` immediately.
This coalescing is covered by `test/renderer.test.ts:505`, `:733` and, against
the real web host, by `test/browser/lynx-for-web.test.ts:569`.

## 8. CSS ids

Source: `src/root.ts:31-40`, `src/root.ts:56-158`; host side
`src/lynx-host.ts:395-406`. Contract: **stable**.

```ts
setCSSId(cssId: number | null, entryName?: string): void
```

Frozen behaviour:

| Statement | Covered by |
| --- | --- |
| One batched `__SetCSSId(elements, cssId, entryName)` call for every element the root owns **directly in its page**. | `test/renderer.test.ts:1302`; `test/browser/lynx-for-web.test.ts:694` |
| An element the root inserts into the page after the assignment gets the id on arrival. | `test/renderer.test.ts:1329`; browser `:789` |
| A nested element is not included: the id goes on the subtree root and reaches the rest through the element tree. | `test/renderer.test.ts:1349` |
| A later call replaces the recorded id. | `test/renderer.test.ts:1375`; browser `:789` |
| `null` is forwarded untouched so the host resolves it. | `test/renderer.test.ts:1388`; browser `:821` |
| A non-integer or negative id throws `TypeError` **before** anything is recorded, leaving the root unchanged. | `test/renderer.test.ts:1402` |
| A host without `__SetCSSId` throws `"solid-lynx cannot assign a CSS id: this Lynx host does not implement Element PAPI __SetCSSId()"` instead of styling nothing. | `test/renderer.test.ts:1420` |
| A second root sharing the page is never restyled by the first. | `test/renderer.test.ts:1441`; browser `:853` |

Assignment is scoped by `page` identity: the adapter records a node as owned
only when its insert parent is `=== page` (`src/root.ts:117-131`).

**Important limit, and part of the contract:** `setCSSId` only *selects* among
stylesheets the Lynx toolchain already compiled into the bundle. Loading,
adopting, replacing, or removing a stylesheet at runtime is **unsupported**:
web-core exposes no Element PAPI for it, and the native globals the device
inventory listed (`__LoadStyleSheet`, `__AdoptStyleSheet`,
`__ReplaceStyleSheets`) have unmeasured semantics. See
[capabilities.md](capabilities.md), "Stylesheet loading and lifecycle".

Native status of `__SetCSSId`: the device run recorded that the global exists,
but `root.setCSSId()` has never been exercised on a device. Native behaviour is
**unmeasured**, not supported.

## 9. Deterministic cleanup

Contract: **stable**. This section states exactly what is proven, and by which
test. The migration guide repeats it from a consumer's point of view
([migration.md](migration.md), "Deterministic cleanup").

| Cleanup | Mechanism (source) | Proven by |
| --- | --- | --- |
| Root disposal removes the nodes the root rendered into its page, and only those. | `src/root.ts:148-158`; ownership recorded in `src/root.ts:86-116` | `test/renderer.test.ts:561`, `:1014`; browser `test/browser/lynx-for-web.test.ts:471` |
| Root disposal releases every listener the root registered, in the slot it was filed in. | `src/lynx-host.ts:453-455` (detach subtree on remove), reached from `src/root.ts:149` | `test/renderer.test.ts:976` (compares add/remove slot tuples), `:821` |
| Removing a subtree detaches its listeners; re-inserting registers them again. | `src/lynx-host.ts:266-276` | `test/renderer.test.ts:789` |
| Root disposal clears every ref it attached. | `src/universal.ts:103-113` (`onCleanup`), `src/refs.ts:47-56` | `test/renderer.test.ts:1163`; browser `:690` |
| Disposal flushes the host (`__FlushElementTree`) once at the end. | `src/root.ts:157` | `test/renderer.test.ts:733` |
| Roots sharing one page dispose independently. | `src/root.ts:86-116` | `test/renderer.test.ts:1014`; browser `:527` |
| A disposed root can be rendered into again, with fresh listeners. | `src/root.ts:163-168` | `test/renderer.test.ts:853`; browser `:527` |

**Not proven / not applicable:**

- **Stylesheet cleanup.** There is nothing to clean up: the renderer never loads
  a stylesheet (§8). A CSS id assigned through `setCSSId` stays assigned to the
  elements it was applied to; disposal removes the elements, so no un-assign call
  is made or needed. No test asserts anything about a stylesheet, because no host
  in this repository has one to assert against.
- **Cleanup ordering between two roots.** Each root removes its own nodes in
  insertion order; no test asserts a specific interleaving when two roots
  dispose in the same task.
- **Native disposal.** The device run exercised tap dispatch and rendering; it
  did not assert listener-slot removal or node removal afterwards. Native
  cleanup is **unmeasured**.

## 10. The Element PAPI surface the renderer requires

Source: `src/lynx-host.ts:6-76` (`LynxPapi`). The interface declares more than
the renderer requires; the table below separates what is actually called from
what is only declared.

### 10.1 Required — the adapter throws a named error when missing

Each is reached through `requirePapi()` (`src/lynx-host.ts:171-177`), which throws
`solid-lynx requires Lynx Element PAPI <name>()`.

| Operation | Called at | Needed for |
| --- | --- | --- |
| `__CreateElement` | `src/lynx-host.ts:219` | Fallback creator for any tag without a built-in creator. |
| `__CreateRawText` | `src/lynx-host.ts:339` | Every text node. |
| `__SetAttribute` | `src/lynx-host.ts:362` (text), `:387` (`textContent`), `:389` (boolean attrs), `:391` (all other props) | Text updates, `textContent`, boolean attributes, all other props. |
| `__SetClasses` | `src/lynx-host.ts:372-373` | `class` / `className`. |
| `__SetInlineStyles` | `src/lynx-host.ts:375` | `style`. |
| `__AppendElement` | `src/lynx-host.ts:438` | Insert with no anchor. |
| `__InsertElementBefore` | `src/lynx-host.ts:440` | Insert with an anchor. |
| `__RemoveElement` | `src/lynx-host.ts:455` | Removal and disposal. |
| `__FirstElement` | `src/lynx-host.ts:487` | `getFirstChild`. |
| `__NextElement` | `src/lynx-host.ts:496` | `getNextSibling`. |
| `__FlushElementTree` | `src/lynx-host.ts:182` | Every flush. |

`__CreatePage` and `__GetElementUniqueID` are additionally required by
`createLynxPage` (`src/lynx-host.ts:517-530`) and `getLynxPageId`
(`src/lynx-host.ts:506-515`) — that is, when `createLynxRoot` creates the page or
derives `parentComponentId` instead of receiving them. Both throw a named error
rather than proceeding (`__CreatePage` at `:522-524`, `__GetElementUniqueID` at
`:507-509`, a failed page creation at `:526-528`, an invalid page id at
`:511-513`).

### 10.2 Optional — used when present, with a documented fallback

| Operation | Contract | Fallback |
| --- | --- | --- |
| `__CreateView`, `__CreateText`, `__CreateImage`, `__CreateScrollView`, `__CreateFrame` | **provisional** | Built-in creators used in preference to `__CreateElement` (`src/lynx-host.ts:94-102`, `:147-151`). Their existence is confirmed on the web host and by the fake PAPI; native parity covered creation through `__CreateView` and `__CreateElement` only. |
| `__CreateWrapperElement` | stable as an error | `createComment` throws `"Solid control flow requires Lynx __CreateWrapperElement() support"` (`:276-286`). Needed for Solid control flow. |
| `__GetElementUniqueID` | stable | Only for page-id derivation; `parentComponentId` can be passed instead. |
| `__SetID` | stable | Without it, `id` is written through `__SetAttribute`. |
| `__AddDataset` / `__SetDataset` | stable | Without either, `data-*` falls through to `__SetAttribute`. |
| `__SetCSSId` | stable | Absent ⇒ `setCSSId()` throws (§8). |
| `__GetParent` | stable | Used only when the host adapter has no recorded parent (`:366-369`). |
| `__AddEventListener` / `__RemoveEventListener` | stable | Preferred binding path (`:157-191`). If neither is present, `__AddEvent` is used, and if that is absent too, the adapter throws `"solid-lynx requires __AddEvent() or __AddEventListener()"` (`:167-174`). |

### 10.3 Declared but never called

`LynxPapi` also declares `__CreateComponent` (`src/lynx-host.ts:9`) and
`__ReplaceElements` (`src/lynx-host.ts:50`). No code in `src/` calls either; they are type
surface only. Do not rely on the adapter using them, and do not treat their
absence as a missing capability.

### 10.4 Handle validation

`isLynxNode(value)` (`src/lynx-host.ts:151-157`) rejects only `null`,
`undefined`, and the primitive types. It does **not** require `typeof value ===
"object"`, because a native PrimJS host returns handles whose `typeof` is
`"unknown"` (`docs/building.md`, "Element handle shape"). Covered by
`test/renderer.test.ts:407`, `:432`. This is stable behaviour: a change here
breaks native rendering.

## 11. Indexed-list adapter

Status: **stable for the API shape, provisional for virtualization claims.** The
adapter exists and is tested against web-core only; no host in this repository
has been observed to recycle a cell, and nothing has run on a device.

Source: `src/list.ts` (321 lines), reached through `LynxRoot.createList()`.

### 11.1 Entry point

`src/root.ts:31-61`:

```ts
createList<T>(options: LynxListOptions<T>): LynxList<T>;
```

`createLynxList(host, renderer, defaultParent, options)` is also exported from
`src/list.ts:113` but **not** from the package root (`src/index.ts:48-49` exports
only the types), so it is not reachable by a consumer of `solid-lynx`. Use
`root.createList()`.

`root.createList()` throws when the host does not implement both
`__CreateList` and `__UpdateListCallbacks` — the pair is treated as one
capability (`src/lynx-host.ts:123-126`, `src/root.ts:184-188`). It throws rather
than falling back to an ordinary container, because a container would look
correct and virtualize nothing. Covered by `test/renderer.test.ts:1844`, `:1857`.

Lists a root created are disposed with the root (`src/root.ts:146-150`), so a
`root.dispose()` releases every row.

### 11.2 `LynxListOptions<T>`

`src/list.ts:23-49`:

```ts
export interface LynxListOptions<T> {
  /** Element that receives the list element. Defaults to the root's page. */
  parent?: LynxNode;
  /** The current rows, read lazily inside every row callback. */
  items: () => readonly T[];
  /** Builds one row; called once per key. */
  children: (item: T, index: Accessor<number>) => LynxNode;
  /** Stable identity for a row. Defaults to the item itself. */
  getKey?: (item: T, index: number) => unknown;
}
```

| Option | Contract | Note |
| --- | --- | --- |
| `parent` | stable | Defaults to the root's page, which puts the list under the root's CSS-id assignment and disposal (`src/list.ts:307`). |
| `items` | stable | Read on every `materialize`/`update`, so a callback never serves a snapshot. |
| `children` | stable | Runs once per key. A key that moves keeps its node and its Solid scope; only a replaced item rebuilds. Covered by `test/renderer.test.ts:1721`, `:1642`. |
| `getKey` | stable | Defaults to item identity, matching Solid's `For`. |

`index` is an `Accessor<number>`, not a number: reading it inside the row's own
render scope updates the row in place rather than tearing it down
(`src/list.ts:6-13`). That is frozen behaviour and covered by
`test/renderer.test.ts:1721`.

### 11.3 `LynxList<T>`

`src/list.ts:51-85`:

```ts
export interface LynxList<T> {
  readonly list: LynxNode;
  readonly rows: readonly LynxListRow<T>[];
  materialize(index: number): LynxNode | undefined;
  update(): void;
  dispose(): void;
  readonly disposed: boolean;
}
```

`LynxListRow<T>` is `{ readonly key: unknown; readonly index: Accessor<number>;
readonly item: T; readonly node: LynxNode }` (`src/list.ts:14-21`).

| Member | Contract | Behaviour and coverage |
| --- | --- | --- |
| `list` | stable | The element `__CreateList` returned. |
| `rows` | stable | Materialized rows in ascending index order. |
| `materialize(index)` | stable | Materializes the row at `index`, returns its node, or `undefined` when the index is past the model. Throws `RangeError` for a non-integer or negative index. Covered by `test/renderer.test.ts:1528`, `:1788`, `:1806`. |
| `update()` | stable | Reconciles materialized rows with the model, then re-installs the callbacks through `__UpdateListCallbacks`. Covered by `test/renderer.test.ts:1747`, `:1612`, `:1770`. |
| `dispose()` | stable | Releases every row, leaves an inert callback pair installed, flushes. Idempotent. Covered by `test/renderer.test.ts:1816`. Calling `materialize`/`update` after it throws. |
| `disposed` | stable | `true` after `dispose()`. |

### 11.4 The host callbacks

`createList` hands the host a `LynxListCallbacks` pair (`src/host.ts:25-34`):

```ts
export interface LynxListCallbacks<Node extends object = LynxNode> {
  componentAtIndex(
    list: Node, listId: number, cellIndex: number,
    operationId: number, enableReuseNotification: boolean,
  ): number | undefined;
  enqueueComponent(list: Node, listId: number, sign: number): void;
}
```

Two details are settled by the web host's implementation rather than by its
declarations, and are documented as such in `src/host.ts:5-24` and
`docs/capabilities.md` "List virtualization":

- `componentAtIndex` is declared `=> void` but the host reads a number from it,
  so this adapter returns the row's **unique id** (`src/list.ts:246-252`).
- `enqueueComponent`'s `sign` is the unique id of the element the host is
  removing, not a row index (`src/list.ts:253-261`).

Callbacks are generation-tagged: a callback from a superseded generation does
nothing, so a host holding an old pair cannot materialize rows the current model
does not have (`src/list.ts:241-245`).

Host-driven removal releases the row's scope **and** its event registrations,
through the new optional `LynxHost.detachListeners` (`src/host.ts:66-73`,
`src/lynx-host.ts:467-469`), because a host that removes an element itself never
reaches this adapter's `removeNode`. Covered by
`test/renderer.test.ts:1662`, `:1562`.

### 11.5 `<list>` in JSX is a build-time error, by design

`list` and `x-list` are deliberately **absent** from `JSX.IntrinsicElements`
(`src/jsx-types.ts:164-176`). `createElement("list")` throws, naming
`createList()` when the host has the PAPI and naming the missing PAPI when it
does not (`src/lynx-host.ts:201-215`). Covered by
`test/renderer.test.ts:1885`, `:1900`.

`list-item`, `x-list-item`, `x-swiper`, `x-swiper-item`, `x-viewpager-ng`, and
`x-web-view` remain ordinary `LynxElementAttributes` intrinsics
(`src/jsx-types.ts:175-181`).

### 11.6 What is measured, and what is not

Measured against `@lynx-js/web-core@0.26.2` only, per
`docs/capabilities.md` "List virtualization":

| Claim | Coverage |
| --- | --- |
| The list is created through `__CreateList` with the parent component id and both callbacks | `test/renderer.test.ts:1511` |
| Only the requested row is materialized, in index order (including sparse, out-of-order requests) | `test/renderer.test.ts:1528`, `:1583`; `test/browser/patterns.test.ts:322` |
| `componentAtIndex` answers with the row's unique id | `test/renderer.test.ts:1544` |
| The same key keeps one node across requests | `test/renderer.test.ts:1703` |
| A surviving row moves in place without another host request | `test/renderer.test.ts:1612`, `:1721` |
| Callbacks are re-installed on model change | `test/renderer.test.ts:1747`; `test/browser/patterns.test.ts:351` |
| The web host's own `update-list-info` request path drives the pair | `test/browser/patterns.test.ts:382` |
| A host without the PAPI fails clearly | `test/renderer.test.ts:1844`, `:1857`; `test/browser/patterns.test.ts:370` |

**Not measured, and not claimed:**

- **No recycling has been observed.** Every requested cell becomes a real child
  element; `operationId` and `enableReuseNotification` are accepted and given no
  meaning (`docs/capabilities.md` "List virtualization").
- **Native list support is unverified.** The 2026-10-09 A03 smoke rendered the
  native parity card and verified its `bindtap` counter; that card created no
  list and called neither callback (`docs/capabilities.md`, same section;
  `docs/session-handoff.md` "Remaining Work").
- Cell recycling, list scroll behaviours, and `sticky-offset`/`span-count`
  attributes are outside this adapter.

`For` remains the supported path when the host does **not** drive row selection:
it reconciles through ordinary element operations (`src/index.ts:16-25`), covered
by `test/renderer.test.ts:561` and `test/browser/patterns.test.ts:207`. It is not
virtualized: live element count equals row count.

## 12. JSX types

Source: `src/jsx-types.ts`. Contract: **stable for the declared surface, and
explicitly bounded** — it is not an exhaustive Lynx schema.

Frozen:

| Item | Source |
| --- | --- |
| `JSX.Element = LynxNode`, `JSX.Child = LynxChild` | `src/jsx-types.ts:140-141` |
| `JSX.ElementChildrenAttribute { children: {} }` | `src/jsx-types.ts:143-145` |
| `JSX.IntrinsicAttributes { key?: string \| number; ref?: LynxRef }` | `src/jsx-types.ts:147-150` |
| `JSX.IntrinsicElements`: `view`, `text`, `image`, `scroll-view`, the matching `x-*` tags, `x-input`, `x-textarea`, `input`, `textarea`, `list-item`, `x-list-item`, `x-swiper`, `x-swiper-item`, `x-viewpager-ng`, `x-web-view` | `src/jsx-types.ts:153-182` |
| `list` and `x-list` are **deliberately absent** from `JSX.IntrinsicElements`, so `<list>` is a build-time error; use `root.createList()` (§11.5) | `src/jsx-types.ts:164-176` |
| `LynxElementAttributes`, `LynxTextAttributes`, `LynxImageAttributes`, `LynxScrollViewAttributes`, `LynxInputAttributes`, `LynxTextareaAttributes`, `LynxCustomElementAttributes<Extra>` | `src/jsx-types.ts:65-137` |
| `LynxStyle = string \| LynxStyleProperties \| null \| undefined`, where `LynxStyleProperties` is Solid's `CSSProperties` plus `--*` custom properties | `src/jsx-types.ts:20-24` |
| `LynxDatasetValue` — the serializable dataset boundary | `src/jsx-types.ts:8-15` |

Custom tags are **provisional**: they are opt-in through declaration merging,
demonstrated by `test/consumer/custom-elements.d.ts` for both
`solid-lynx/jsx-runtime` and `solid-lynx/jsx-dev-runtime`.

The type-level rejections are part of the contract and are asserted with
`@ts-expect-error` in `test/consumer/jsx-runtime.tsx` (unknown tags, unknown
attributes on built-in tags, string boolean properties, unchecked CSS
properties, non-function event handlers, non-serializable dataset values, DOM
element ref callbacks, plain-object refs) and
`test/consumer/jsx-dev-runtime.tsx`. `pnpm typecheck:consumer` compiles both, so
a regression in any of those rejections fails that command.

Explicitly **unsupported / out of contract**: exhaustive `@lynx-js/types`
coverage. `@lynx-js/types` is not a dependency of this repository — it appears
nowhere in `package.json` or `pnpm-lock.yaml` — so official native JSX typings
are **unverified** and are not claimed. `docs/capabilities.md` and
`docs/session-handoff.md` say the same; this document does not upgrade that
statement.

Also outside the contract: the `LynxHost` interface's `createComment(data)`
parameter. It is part of the type (§4.2) but nothing in this package calls it,
so no behaviour is promised for the `data` argument.

## 13. The Rspeedy integration

Source: `src/rspeedy.ts`, exposed as `solid-lynx/rspeedy`. Contract: **stable**.

```ts
export function pluginSolidLynx(options: SolidLynxPluginOptions = {}): RsbuildPlugin[]

export interface SolidLynxPluginOptions {
  moduleName?: string;                        // default "solid-lynx"
  generate?: "universal" | "dom" | "ssr" | "hydrate";  // default "universal"
  hydratable?: boolean;                       // default false
  delegateEvents?: string[];                  // default []
  include?: PluginBabelOptions["include"];    // default /\.[jt]sx$/
  babelLoaderOptions?: PluginBabelOptions["babelLoaderOptions"];
}
```

Frozen behaviour:

- `pluginSolidLynx()` returns exactly one Rsbuild plugin, a `pluginBabel` with
  the Solid preset prepended to the loader's presets
  (`src/rspeedy.ts:125-134`). Covered by `test/rspeedy.test.ts:85`.
- The preset is added **ahead of** an app's own presets
  (`src/rspeedy.ts:70-77`). Covered by `test/rspeedy.test.ts:30`, `:41`.
- `moduleName` and the other options are overridable and pass through
  (`src/rspeedy.ts:47-62`). Covered by `test/rspeedy.test.ts:49`.
- An app's `babelLoaderOptions` callback runs **after** the Solid transform
  (`src/rspeedy.ts:101-108`). Covered by `test/rspeedy.test.ts:67`.

Three helpers are also exported and are **provisional** as public API (they are
test seams, covered by tests, but no example imports them):
`solidLynxBabelPreset`, `applySolidLynxBabelPreset`,
`solidLynxBabelLoaderOptions`.

The plugin deliberately does **not** include the Lynx engine plugins;
`pluginLynx()` and `pluginVanillaLynx()` stay in the app's config
(`src/rspeedy.ts:110-124`, and the three example configs under `examples/`).

## 14. Diagnostics: `solid-lynx/parity`

Source: `src/parity.ts`. Contract: **provisional** — a diagnostic tool, not a
rendering API.

```ts
export function runElementPapiParity(options: ElementPapiParityOptions = {}): ParityReport
export function formatParityReport(report: ParityReport): string
export const parityOperationIds: readonly string[]  // 20 ids
```

`ElementPapiParityOptions`: `label?`, `papi?`, `page?`, `componentId?`,
`cssId?`, `parentComponentId?` (`src/parity.ts:47-63`). `ParityReport` carries
`label`, `operations`, `failures`, and a `summary` of pass/fail/unsupported
counts (`src/parity.ts:34-45`).

Frozen semantics, each covered by `test/parity.test.ts`: a missing PAPI function
is `unsupported` rather than `fail` (`:154`); a throwing probe is `fail` (`:167`);
the harness removes its own sandbox (`:125`); a supplied `page` is used instead
of creating one (`:184`); with no reachable page every operation reports the
same blocked cause (`:197`); inline styles are read back through
`__GetInlineStyles` when present (`:133`); a lost reactive text update carries an
explanatory note (`:214`); the markdown formatter matches the checklist table
(`:235`); and all twenty operations pass on a complete host (`:114`).

Running it against a live card is documented in
[building.md](building.md) and its results are recorded in
[parity-checklist.md](parity-checklist.md).

## 15. Outside the contract

Every item here is **unsupported** unless stated, and each statement matches
[capabilities.md](capabilities.md), [parity-checklist.md](parity-checklist.md),
and [ROADMAP.md](../ROADMAP.md).

| Area | Position | Where it is recorded |
| --- | --- | --- |
| Dual-thread execution, worklets, first-screen synchronization | Not implemented by this renderer. Both examples build with `background: false`. A background-thread card is unverified; worklets belong to Lynx's compiler and are out of scope. | `ROADMAP.md` 0.3 unchecked item and "Out of scope"; `docs/building.md` "Dual-thread execution"; `docs/parity-checklist.md` "Runtime behaviour" |
| Native `global-bind` delivery | The renderer registers and removes the binding correctly; whether a host invokes it is unmeasured. web-core files the handler in its own slot but does not run the global pass for function callbacks. | `docs/capabilities.md`; `docs/parity-checklist.md`; `README.md` "Events and properties" |
| Event capture/propagation parity on native | The capture, bubble, and catch passes are tested against the fake PAPI and the web host. Native is **not measured**. | `docs/parity-checklist.md` "Runtime behaviour"; `test/renderer.test.ts:887-950` |
| Native stylesheet lifecycle | `__LoadStyleSheet`, `__AdoptStyleSheet`, `__ReplaceStyleSheets` exist in the native global inventory; their signatures and semantics were not tested. Not integrated. | `docs/capabilities.md` "Stylesheet loading and lifecycle"; `ROADMAP.md` 0.4 open item |
| Native list behaviour and cell recycling | The renderer has a list adapter (§11) measured against web-core only. No host in this repository has been observed to recycle a cell, and no device run has created a list or called either list callback, so native list support is **unmeasured**. | `docs/capabilities.md` "List virtualization"; `docs/session-handoff.md`; `ROADMAP.md` 0.4 list entry |
| Gesture PAPI | No gesture binding form. `gesture-*` props are written as plain attributes and never fire — the one documented silent failure. | `docs/capabilities.md` "Gestures" |
| Animation PAPI exposure | `__ElementAnimate` exists on web-core; nothing in this renderer calls it and the package exposes no animation API. Use inline styles and CSS transitions. | `docs/capabilities.md` "Animation" |
| Portals and overlays | No `Portal`, no `Dynamic`, no overlay contract. Importing `Portal` fails at build time. `<overlay>` is an ordinary child. | `docs/capabilities.md` "Overlays and portals"; `docs/building.md` "Known limitation" |
| Exhaustive `@lynx-js/types` | Not a dependency; native JSX typings unverified. §12. | `docs/capabilities.md`; `docs/session-handoff.md` |
| `createResource`, streaming render | Not provided. `Suspense` and `SuspenseList` are re-exported from Solid but no test exercises them. | `docs/capabilities.md` "Asynchronous content" |
| Native navigation and app lifecycle | Owned by the surrounding Lynx app. | `ROADMAP.md` "Out of scope"; `README.md` "Scope and limitations" |
| Rspeedy bundling internals, native modules | Owned by the toolchain. | `ROADMAP.md` "Out of scope" |
| Web-core `bindchange`, `bindsubmit` | Not delivered by the web host. The supported pattern is `bindinput` plus `bindconfirm`. Native form events unverified. | `docs/capabilities.md` "Form input events" |

## 16. Coverage gaps in this document

These items are exported or described above but have **no automated test in
this repository**. They are listed so a reader can tell a frozen promise from a
documented intention:

- The page-creating branch of `createLynxRoot` (`__CreatePage` +
  `__GetElementUniqueID`), `renderLynxPage`, `createLynxPage`, `getLynxPageId`,
  and `createLynxHost` by name.
- `initializeLynxRootContext` and `ensureLynxEnvironmentBasics`.
- `version`.
- `renderer.parseEventProp` as a method (the pure `parseEventProp` is tested).
- The `[handler, data]` event tuple at dispatch time (it is type-checked only).
- The `background:` namespace at dispatch time (it is type-checked only, in
  `test/consumer/jsx-dev-runtime.tsx`).
- `replaceText` before insertion (the throw), and `host.createComment` semantics.
- Every native runtime claim, except: the 2026-10-09 run reported the card
  loading, rendering, a `bindtap` counter updating, and all twenty parity
  operations passing. That run's capture was not kept, so
  `docs/parity-checklist.md` marks the native column reported, not reproduced and
  nothing here may be cited as a present pass. The native stylesheet probe and native list
  probe cards are built by `pnpm native:build` and covered by host-free recorder
  tests (`test/stylesheet-probe-report.test.ts`,
  `test/list-probe-report.test.ts`), but neither has been run on a device, so
  their native findings are unmeasured. No native runtime executes in CI.
- The runtime functions of `solid-lynx/jsx-runtime` and
  `solid-lynx/jsx-dev-runtime` (`jsx`, `jsxs`, `jsxDEV`, `Fragment`). Only their
  types are exercised, by the two consumer fixtures.
- `Suspense`, `SuspenseList`, `Switch`, `Match`, `Index`, and `ErrorBoundary`
  are re-exported but used by no test or example in this repository. They are
  **provisional**, not stable.
- **List cell recycling and native list behaviour.** The adapter (§11) is
  measured against `@lynx-js/web-core@0.26.2` only. No host has been seen to
  recycle a cell, `operationId`/`enableReuseNotification` are given no meaning,
  and no device run has created a list or called either list callback. Treat
  native list support as **unverified**, not as a covered claim.
