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
| not measured | Not yet run against that host in this repository. |

The shared Element PAPI parity card **has** run on a device: all twenty shared
operations were reported passing on Lynx Explorer 4.1.0 on an SM-A037U on
2026-10-09. That run's capture was not kept, so
[parity-checklist.md](parity-checklist.md) records the native column as
**reported, not reproduced**, and `scripts/verify-native-parity.mjs` is what
makes the next run checkable; see also [building.md](building.md). The
capability probe below has only been run in a browser, so the Native column of
the summary table stays `not measured`. `@lynx-js/types` is not a dependency of
this repository, so native JSX typings remain unverified and are marked as such
rather than assumed.

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
| List virtualization (`__CreateList`) | supported, measured | not measured | `root.createList()` materializes a row by index, keyed; the host owns which cells it asks for. No recycling observed; the A03 smoke did not exercise list callbacks. |
| Gestures | unsupported, measured | not measured | `gesture-*` props become plain attributes and never fire. |
| Animation | host-only, measured | not measured | Use inline styles and CSS transitions. |
| Overlays and portals | unsupported, measured | not measured | `<overlay>` is an ordinary child; importing `Portal` fails at build time. |
| Form input events | partially supported, tested | not measured | `bindinput` and `bindconfirm` deliver; `bindchange` does not. |
| Asynchronous content | supported, tested | not measured | Promise plus signal. No `createResource`, no streaming. |
| Refs and imperative access | supported, tested | not measured | A ref receives the live Lynx node and is released with its Solid scope. |
| CSS ids | supported, tested | not measured | `root.setCSSId()` assigns a compiled CSS id to a root's own page children. |
| Stylesheet loading and lifecycle | unsupported, by inspection | not measured | web-core has no PAPI for it; native exposes `__LoadStyleSheet` and friends (observed, not measured), so there is nothing implemented to call. |

## Findings

### Keyed lists

`For` is Solid's own keyed list and the renderer reconciles it through ordinary
element operations, so nothing platform-specific is involved. The pattern suite
adds, removes, and reverses rows and asserts that retained rows keep their
identity.

This is the supported way to render a list on both hosts. It is not virtualized:
the number of live elements equals the number of rows. Use `root.createList()`
when the host drives row selection through the list PAPI; see
[List virtualization](#list-virtualization).

### List virtualization

web-core implements the protocol. `__CreateList(parentComponentUniqueId,
componentAtIndex, enqueueComponent)` creates an `x-list` element and stores those
two callbacks on it, and `__UpdateListCallbacks(element, componentAtIndex,
enqueueComponent)` replaces them (`dist/client/mainthread/elementAPIs/createElementAPI.js`
and `dist/client/mainthread/elementAPIs/pureElementPAPIs.js`, declared as
`CreateListPAPI` and `UpdateListCallbacksPAPI` in `dist/types/IElementPAPI.d.ts`).

The renderer now supplies that pair. `root.createList()` creates the list element
and hands over a `componentAtIndex` that materializes exactly the row for the
`cellIndex` it was asked for, and an `enqueueComponent` that releases the row the
host is removing. Two details the declarations leave open are settled by the host
implementation rather than by a guess:

- `componentAtIndex` is declared `=> void`, but the host reads a number from it:
  `const sign = componentAtIndex(...); if (typeof sign === "number")
  insert(get_dom_by_unique_id(sign))`. It returns the row's unique id.
- `enqueueComponent`'s `sign` is the unique id of the element being removed
  (`enqueueComponent(element, uniqueId, __GetElementUniqueID(removedEle))`), not
  a row index, so it releases that row's scope and leaves the node removal to
  the host.

Row selection stays with the host. Nothing in web-core calls the pair on its own;
it calls them from the `update-list-info` attribute on the list element, whose
value is `{ insertAction: { position }[], removeAction: number[] }`. The pattern
card drives that path directly and the browser suite asserts the result: asking
for cells 2 and 0 materializes those two rows in index order, and then removing
child 1 drops it from both the element tree and the row model.

What is measured, on this host only:

- Rows are keyed. The same key keeps its node across requests, so asking for the
  same cell twice creates nothing the second time; a key that moves to another
  index updates in place, exactly as Solid's `For` does.
- Rows are placed at their index. The list element holds them in ascending index
  order even when the host asks for cells out of order and sparse. The anchor is
  the first materialized row with a greater index, not "the row at position
  `index`": while rows are missing, the position among the rows that exist is
  not the index they hold in the model.
- A model change re-installs the callbacks through `__UpdateListCallbacks`, and
  the surviving rows move to their new index and are reordered with no further
  host request, keeping their nodes and their Solid scopes. A row whose key left
  the model is released, and a surviving key whose *item* was replaced is
  rebuilt under the same key, because its content came from the old item.
- A host-driven removal is complete. `enqueueComponent` releases the row's scope
  *and* the event registrations it filed, because a host that removes an element
  itself never reaches this host's `removeNode`, which is what normally detaches
  them.
- Disposal releases every row and leaves an inert pair installed, so a host that
  still holds the list cannot repopulate a disposed model.

Two things it does not do:

- **No recycling is observed.** Every cell the host asks for becomes a real child
  element, and no host in this repository has been seen to recycle one.
  `operationId` and `enableReuseNotification` are accepted and given no meaning.
- **`<list>` in JSX fails.** `createElement("list")` has no way to pass the row
  callbacks, so it throws and the tag is not in the JSX element types, rather
  than creating a container that would look correct and virtualize nothing. A
  host that does not expose `__CreateList` and `__UpdateListCallbacks` together
  throws the same way from `root.createList()`, before anything is created: the
  adapter treats the pair as one capability, because a list that cannot re-install
  its callbacks is a list that fails on the first model change instead of at the
  call that could report it.

**Native list behavior remains unmeasured.** The A03 smoke on 2026-10-09
rendered the existing native card (`Native parity count: 0`) and a `bindtap`
updated it to `1`, but the card did not create a list or call either list
callback. No device run has exercised these callbacks; this smoke is evidence
for native card rendering and tap delivery only, not for native list support.
The renderer treats the list PAPI as optional and fails loudly when its required
operations are absent. Nothing here establishes native list behavior.

Real virtualization would need a host that asks for cells on its own, and native
validation of both callbacks against the native list.

A measurement card for that validation exists and has not been run on a device
yet. `examples/lynx-for-native/src/list-probe.ts` builds through
`pnpm native:build` as `dist/list-probe.lynx.bundle`; it shares its shape with the
stylesheet probe (`[solid-lynx lp]` stages, one JSON line each, recorder helpers
in `list-probe-report.ts` covered by `test/list-probe-report.test.ts`) so one
runner drives all three cards. It is a measurement, not support: it calls
`root.createList()` with three toy items and logs one line per stage —
`inventory` (what the host exposes, with `typeof`, `fn.length`, `fn.name`, and
`String(fn)`, no calls), `create`, `materialize`, `reorder`, `shrunk`, `summary`,
and `done`. **Its device run is pending.** No line from it has been observed, so
nothing below changes: no native list behavior is measured, and no host has been
seen to recycle a cell. What the card cannot establish even when it runs is
also recorded in its own `summary` stage: recycling driven by a viewport, scroll
behavior, and cell reuse timing all need a scrolling list, and the card creates
none.

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

There is no stylesheet-loading Element PAPI on the web host. The complete
web-core surface is
`__AddClass`, `__AddInlineStyle`, `__SetClasses`, `__SetCSSId`, and
`__SetInlineStyles`; nothing adds, replaces, or removes a stylesheet, and no
stylesheet-named identifier appears anywhere in `web-core`. A stylesheet is
compiled into the bundle by the Lynx toolchain, and `__SetCSSId` only selects
among the ones already there.

Supporting it would mean inventing an API the host does not have, so it is
recorded as unsupported rather than approximated. An app that needs a
runtime-loaded stylesheet has to drive its own host.

Native is not measured for semantics, but the device run did record the global
PAPI inventory: a native host **does** expose `__LoadStyleSheet`,
`__AdoptStyleSheet`, and `__ReplaceStyleSheets`, names web-core does not have.
What they accept and do is untested here, so this document does not claim they
work; `@lynx-js/types` is still not a dependency, so their contract is not
described either.

### The native stylesheet probe

A measurement card for the three native stylesheet operations exists:
`examples/lynx-for-native/src/stylesheet-probe.ts`. It is built by
`pnpm native:build` and loaded on a device through `lynx://open?url=...` like the
parity card. It records one JSON line per stage under a `[solid-lynx ss]` prefix,
because the native console bridge drops everything after the first newline and a
stage that fails hard must not take earlier evidence with it:

| Stage | What it does | Why that is allowed |
| --- | --- | --- |
| `inventory` | `typeof`, `fn.length`, `fn.name`, `String(fn)` for each of the three | Reading a binding cannot mutate the card. `fn.length` is the declared parameter count, recorded as evidence about the binding and not read as a signature. |
| `no-arguments` | Calls each of the three with no arguments | A call with no arguments cannot produce a stylesheet, so it cannot change anything; the error text is the only engine-authored statement of what the binding requires that exists without a handle. |
| `load-missing-url` | `__LoadStyleSheet` pointed at a path the loopback server returns 404 for | The load has to fail, which separates "accepts a URL-shaped argument" from "rejects its argument" without letting anything load. |
| `load-real-url` | `__LoadStyleSheet` pointed at a real, inert stylesheet next to the bundle | The only call that can change anything, and it changes a disposable card. It is the first step to any handle or ownership contract. |
| `summary` | States explicitly what was not exercised and why | Keeps the report from being read as a claim about the unexercised operations. |

Adopting and replacing are **not** called with fabricated arguments. Both need a
stylesheet handle or a stylesheet set whose membership and ownership this probe
has no contract for, so any call would either prove nothing or would strip the
card's own styles. They are recorded as unmeasured with that reason rather than
guessed at.

**This has not been run yet.** The probe is built and its recorder is covered by
host-free tests, but the A03 run has not happened: during this attempt the device
was not attached over adb (`adb -s R9WT911JVVH get-state` reported
`device 'R9WT911JVVH' not found` while a Samsung device was present on the USB
bus). So this section records what the probe *will* measure, and the paragraph
above is unchanged: the three names are known to exist on the A03, and their
signatures and lifecycle remain unmeasured.

#### Running it

One runner drives all three native cards,
`examples/lynx-for-native/scripts/run-native-probe.sh` in the repository, and
the card is its argument:

```bash
examples/lynx-for-native/scripts/run-native-probe.sh stylesheet --dry-run
```

| Card | Argument (aliases) | Bundle | Console prefix |
| --- | --- | --- | --- |
| parity smoke | `smoke` (`main`) | `main.lynx.bundle` | `[solid-lynx parity]` |
| this probe | `stylesheet` (`stylesheet-probe`) | `stylesheet-probe.lynx.bundle` | `[solid-lynx ss]` |
| list probe | `list` (`list-probe`) | `list-probe.lynx.bundle` | `[solid-lynx lp]` |

The former entry point,
`examples/lynx-for-native/scripts/run-stylesheet-probe.sh`, is kept in the
repository as a thin wrapper that execs the general script with `stylesheet`, so
earlier instructions still work. An unknown card is a usage error and exits 2.

`--dry-run` prints every command in the order a real run executes it and touches
no device, so the sequence can be reviewed without hardware. Drop the flag to do
the run: the script builds with `pnpm native:build`, serves
examples/lynx-for-native/dist on `127.0.0.1:8099`, adds
`adb -s R9WT911JVVH reverse tcp:8099`, opens
`lynx://open?url=http://127.0.0.1:8099/<card>.lynx.bundle?v=<run stamp>`,
captures `logcat -d -s lynx_console` and a screenshot into
`/tmp/solid-lynx-logs`, and prints the lines carrying the chosen card's prefix.
For this probe that means the `[solid-lynx ss]` lines.

It is pinned to the A03 serial `R9WT911JVVH`: it never enumerates devices, it
refuses to run if `DEVICE_SERIAL`, `ADB_SERIAL`, or `ANDROID_SERIAL` is set to
anything else, and it exits 3 with a message if `adb -s R9WT911JVVH get-state`
is not `device`, changing nothing. It traps `EXIT` so it kills only the server it
started (from the pid file it wrote) and removes only its own `tcp:8099`
reverse, then prints `adb reverse --list`. `LOOPBACK_PORT` and `LOG_DIR` override
the port and output directory.

A run that captures no line for the chosen prefix exits 5 and points at the log
and screenshot rather than reporting a result; the script does not parse the
stages, so reading the capture is still the measurement.

**No card has been run on a device through this script.** Only `--dry-run` has
been executed, for all three cards and for the wrapper (exit 0 each). A reviewed
command sequence is not a measurement, so everything above about the three
stylesheet operations — and everything about native list behaviour — remains
unmeasured.

## Remaining blockers

- The Native column of the summary table. The shared Element PAPI parity card has
  run on a device, but the capability probe has not, so no per-capability native
  claim in this document is verified.
- Native PAPI names: the device run recorded the global inventory (for example
  `__SetCSSId`, `__LoadStyleSheet`, `__AdoptStyleSheet`, `__ReplaceStyleSheets`
  all exist), but their semantics were not exercised, so nothing here asserts
  what a native host does with these same names.
- Gestures are the only silent failure. Making them fail loudly would mean
  changing the property path in `src/lynx-host.ts`, which is renderer behaviour
  rather than a platform capability, so it is left for a deliberate change.
- List virtualization now has a renderer-side indexed row model
  (`root.createList()`), measured against web-core. What is still missing is a
  host that recycles cells and any native run at all: native list support is
  unverified, not merely untested.
- Native `__SetCSSId` exists — the device inventory lists it — but
  `root.setCSSId()` has not been exercised on a device, so that path is still
  unmeasured even though the renderer already treats the PAPI as optional and
  fails loudly when a host lacks it.
- Stylesheet loading has no PAPI on either host to verify, so the capability is
  absent rather than blocked. It would have to be re-opened only if a host
  exposed one.
