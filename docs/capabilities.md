# Platform capabilities

The renderer drives the Element PAPI and nothing else. A platform capability is
therefore reachable only when **both** halves are true: the host exposes the PAPI
or element, and the renderer has a path that calls it. This document records the
answer per capability, what happens today if an app uses one anyway, and what
support would require.

Statuses used here:

| Status | Meaning |
| --- | --- |
| `supported` | The renderer has a working path and it is covered by an automated test. |
| `host-only` | The host provides the capability, but the renderer has no path to it. It works only if the app drives the PAPI itself. |
| `unsupported` | Neither host nor renderer provides it. Using it fails or silently does nothing, as described. |
| not measured | Requires Lynx Explorer or a device. Nothing in this repository has run it. |

Nothing native has been validated. `@lynx-js/types` is not a dependency of this
repository, so native PAPI names and semantics are unverified here and are marked
as such rather than assumed.

## How these answers are produced

`runCapabilityProbe()` in `examples/lynx-patterns/src/capability-probe.ts` measures
each capability on the host it runs in:

1. It records which PAPI names exist.
2. It wraps the PAPI functions the renderer could plausibly call, renders probe
   elements, and records which calls actually happened.
3. It removes its own container afterwards, so it does not disturb the app.

The probe publishes its report on `globalThis.__SOLID_LYNX_CAPABILITIES__` and
renders it into the card, so the same measurements are available in a browser and
on a device. The pattern suite asserts the web findings:

```
pnpm exec playwright test --config test/browser/patterns.playwright.config.ts
```

## Summary

| Capability | Web (`@lynx-js/web-core` 0.26.2) | Native | Status today |
| --- | --- | --- | --- |
| Keyed lists (`For`) | supported, tested | not measured | Works. Rows move instead of being recreated. |
| List virtualization (`<list>`, `__CreateList`) | host-only, measured | not measured | `<list>` is an ordinary container; one element per row, nothing recycled. |
| Gestures | unsupported, measured | not measured | `gesture-*` props become plain attributes and never fire. |
| Animation | host-only, measured | not measured | Use inline styles and CSS transitions. |
| Overlays and portals | unsupported, measured | not measured | `<overlay>` is an ordinary child; importing `Portal` fails at build time. |
| Form input events | partially supported, tested | not measured | `bindinput` and `bindconfirm` deliver; `bindchange` does not. |
| Asynchronous content | supported, tested | not measured | Promise plus signal. No `createResource`, no streaming. |
| Refs and imperative access | supported, tested | not measured | A ref receives the live Lynx node and is released with its Solid scope. |
| CSS ids | supported, tested | not measured | `root.setCSSId()` assigns a compiled CSS id to a root's own page children. |
| Stylesheet loading and lifecycle | unsupported, by inspection | not measured | No Element PAPI adds, replaces, or removes a stylesheet, so there is nothing to call. |

## Findings

### Keyed lists

`For` is Solid's own keyed list and the renderer reconciles it through ordinary
element operations, so nothing platform-specific is involved. The pattern suite
adds, removes, and reverses rows and asserts that retained rows keep their
identity.

This is the supported way to render a list on both hosts. It is not virtualized:
the number of live elements equals the number of rows.

### List virtualization

web-core has the full protocol: `__CreateList(parentComponentUniqueId,
componentAtIndex, enqueueComponent)` creates an `x-list` element and stores those
callbacks on it, `__UpdateListCallbacks` refreshes them, and an `update-list-info`
attribute drives insertion and removal through them. The `list` tag maps to
`x-list`, and the element accepts `recyclable`, `span-count`, `sticky-offset`, and
`item-count`.

The callbacks are the crux: the host only recycles rows when the framework
supplies a way to instantiate a row component at an index, and this renderer has
no such model. The probe records `host list callbacks wired: no`, which is the
measured form of that statement.

Today: `<list>` renders as an ordinary container. A 1000-row list creates 1000
elements, with no failure and no recycling. Nothing warns you, which is why this
is called out here rather than left to be discovered.

Supporting it would need a renderer path that calls `__CreateList` with real
callbacks, a Solid list model that can materialize a row at an index, and native
validation of the recycling protocol.

### Gestures

web-core defines `__SetGestureDetector` and `__RemoveGestureDetector` as literal
no-ops, with the comment that gesture recognition is not implemented on web yet
and the stubs exist so bundles using `main-thread:gesture` still render
(`@lynx-js/web-core/dist/client/mainthread/elementAPIs/createElementAPI.js`, the
gesture stubs next to `__FlushElementTree`). No gesture name appears in the host's
DOM-to-Lynx event map either.

This renderer has no gesture binding form. The probe sets `gesture-bindtap`
alongside a real `bindtap` and records that only `__SetAttribute` was called: the
gesture prop is written as an attribute and never dispatched.

Today: a gesture binding silently does nothing. That is the one silent failure in
this document, and it is deliberate to record rather than to hide; an app that
needs gestures must not rely on this renderer.

Supporting it would need a binding form that maps a gesture prop to
`__SetGestureDetector`, a host that implements gesture recognition, and native
validation of the gesture parameters.

### Animation

web-core implements `__ElementAnimate` on top of the Web Animations API: it maps
Lynx timing options (`duration`, `delay`, `direction`, `iterationCount`, `fillMode`,
`timingFunction`) onto `element.animate` and keeps a per-name animation map. The
probe confirms both the PAPI and `element.animate` on a created element.

No part of the renderer calls it, and there is no animation API in the package.

Today: use inline styles and CSS transitions, which are supported on both hosts.
Keyframe animation through the PAPI is unreachable from this renderer.

Supporting it would need a declarative API mapped to `__ElementAnimate`, a
decision about how animation options differ between web and native, and native
validation.

### Overlays and portals

The host maps an `overlay` tag to `x-overlay-ng` and exposes `__InvokeUIMethod`,
so the element exists on web. This package exports no `Portal` or `Dynamic`
component: Solid's portal moves DOM into another DOM parent, and a Lynx element
tree has no such second parent.

Today: an `<overlay>` element is created as an ordinary child with no overlay
behaviour. Importing `Portal` from `solid-lynx` fails at build time because the
package does not export it, which fails loudly rather than degrading silently.

Supporting it would need a Lynx overlay contract (what element hosts overlay
content and how it is presented), a decision on whether a portal is expressible in
a single-parent element tree at all, and native validation, since overlay is a
native module.

### Form input events

Measured on the web host, from its DOM-to-Lynx event map and the `x-input`
element:

| Event | Web host | Notes |
| --- | --- | --- |
| `bindinput` | delivered | The field forwards its `input` event with `detail.value`, `textLength`, `cursor`, and selection offsets. |
| `bindconfirm` | delivered | The field forwards the form `submit` event, which it emits on Enter, as a Lynx `confirm` event with `detail.value`. |
| `bindchange` | not delivered | No `change` entry in the host's event map, and the field emits no such event. |
| `bindsubmit` on a `<form>` | not delivered | The host maps a field's `submit` to `confirm`, and does not wrap a form element. |

So the supported form pattern reads every keystroke with `bindinput` and treats
Enter as `bindconfirm`. A native card would normally bind `bindsubmit` on a
`<form>`; that path is unverified here and must be re-checked on a device.

One more host detail worth knowing: `disabled` on a `view` is an attribute only.
It does not stop taps, so the pattern example uses it to reflect validity and
still requires the handler to be correct.

### Asynchronous content

The supported path is a promise resolved outside any reactive scope whose result
arrives through a signal, rendered with `Show` and `For`. The pattern suite covers
the idle, pending, ready, and error states, including a retry from the error
state.

There is no `createResource` in this package and no streaming render, so a
resource that suspends is not available. `Suspense` and `SuspenseList` are
re-exported from Solid, but they are not exercised by any test here, so treat them
as unverified rather than supported.

### Refs and imperative access

`babel-preset-solid` transforms `ref` before the bundle exists. A function ref
becomes `use(ref, element)` and anything else is assigned to the binding it was
written against, which is why only a callback is a usable `ref` value. The
package's universal `use` now registers the binding's cleanup with the owning
Solid scope, so refs are released when their conditional subtree or root is
disposed:

```tsx
const target = createLynxRef<LynxNode>();
<view ref={target} />;
target.current; // the node, or undefined once its scope is disposed
```

A ref receives the Lynx PAPI node itself, not a browser DOM element, and the
browser suite asserts the `ref` never becomes an attribute. Two ordering details
are part of the contract and are covered by tests: the transform emits the ref
binding *before* the element's props, so a ref cannot rely on attributes being
set yet; and reconciliation that moves an element does not re-fire its ref.

Supported: callback refs, `createLynxRef()`, the `use:` directive, and
`use(fn, element, arg)` called directly. Not supported: ref objects the compiler
cannot invoke, such as a plain `{ current }` literal. The type rejects those
rather than letting them fail silently.

Native is unverified, but nothing here is platform-specific: the work is Solid
ownership plus the node identity the renderer already hands out.

### CSS ids

`__SetCSSId` is part of `@lynx-js/web-core`'s `ElementPAPIs` surface, declared in
`dist/types/IElementPAPI.d.ts` alongside the operations this renderer already
calls. Its contract is deliberately batched:

```ts
SetCSSIdPAPI = (elements: HTMLElement[], cssId: number | null, entryName: string | undefined) => void
```

so `root.setCSSId(cssId, entryName?)` assigns one id to every element that root
owns directly in its page in a single call, and to elements the root puts in that
page afterwards. A nested element is not sent: the id goes on the root of the
subtree and reaches the rest through the element tree. `null` is forwarded
untouched, because resolving it belongs to the host.

Three things are deliberate. Assignment is scoped to the root, so a second root
sharing the same page is never restyled by the first. An invalid id throws
before anything is recorded, so a rejected call leaves the root unchanged. And a
host without the PAPI throws rather than silently styling nothing, which is the
failure mode this document exists to prevent.

The browser suite asserts the Element PAPI contract rather than a visual
result, because a CSS id only has a visible effect if the bundle contains a
compiled stylesheet for it. `examples/lynx-for-web` ships inline styles only and
its bundle has no `styleSheetInfo`, so nothing there can show a change of
stylesheet. Adding one is a build-configuration step
(`pluginVanillaLynx` takes an `entry.css` or a sibling `style.css`), not a
renderer feature.

### Stylesheet loading and lifecycle

There is no Element PAPI for this. The complete web-core surface is
`__AddClass`, `__AddInlineStyle`, `__SetClasses`, `__SetCSSId`, and
`__SetInlineStyles`; nothing adds, replaces, or removes a stylesheet, and no
stylesheet-named identifier appears anywhere in `web-core`. A stylesheet is
compiled into the bundle by the Lynx toolchain, and `__SetCSSId` only selects
among the ones already there.

Supporting it would mean inventing an API the host does not have, so it is
recorded as unsupported rather than approximated. An app that needs a
runtime-loaded stylesheet has to drive its own host.

Native is unverified here in both directions: `@lynx-js/types` is not a
dependency, so this document does not claim what a native host does with these
same names, nor that native lacks a stylesheet operation.

## Remaining blockers

- Every native column. No Lynx Explorer or device run has happened, so no native
  capability claim in this document is verified.
- Native PAPI names and semantics are unverified: `@lynx-js/types` is not a
  dependency here, so nothing in this document asserts what a native host does
  with these same names.
- Gestures are the only silent failure. Making them fail loudly would mean
  changing the property path in `src/lynx-host.ts`, which is renderer behaviour
  rather than a platform capability, so it is left for a deliberate change.
- List virtualization needs a Solid list model that can instantiate a row at an
  index. That is a renderer design question, not a host capability question.
- Whether a native host implements `__SetCSSId` is unverified. The renderer
  treats it as optional precisely so that a host without it fails loudly instead
  of rendering unstyled, but that path has not been exercised on a device.
- Stylesheet loading has no PAPI on either host to verify, so the capability is
  absent rather than blocked. It would have to be re-opened only if a host
  exposed one.
