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

**Two native runtimes, and they are not interchangeable.** This document says
which one a native statement came from, every time it matters:

| Runtime | What exists | What it can back |
| --- | --- | --- |
| **A03 tablet** (`R9WT911JVVH`, SM-A037U, Android 13, `arm64-v8a`, Explorer 4.1.0) | **Prose only.** The 2026-10-09 hand run's capture was written to `/tmp` and lost. | A *report* of behaviour. Where it is the only source, the row says so; it backs none of the measured native cells below. |
| **API 33 emulator** (AVD `lynx33`, serial `emulator-5554`, Android 13 / API 33, `x86_64`, Explorer 4.1.0, APK SHA-256 `6ae29787a2166974c29c2f23d87f3b20a137abcf9a8c17903ad19f3fb7f00cb6`) | **Stored captures** under `docs/evidence/native/2026-10-25-emulator-api33-*/`. Three are records — capture plus `manifest.json` — that a verifier re-checks with exit 0; the v2 stylesheet capture has no manifest, so it is supporting bytes only. | Element PAPI and engine behaviour **on this emulator**. |

Both run the same Lynx Explorer 4.1.0 build — the APK digest recorded for the A03
in [compatibility.md](compatibility.md) §4 is the digest in every emulator
manifest — so the Element PAPI and the engine are the same code. The silicon is
not: the A03 is `arm64-v8a` and the emulator is `x86_64`, and an emulator has no
real digitizer, no phone GPU, and no memory pressure. An emulator capture
**cannot** be used to claim A03 behaviour, GPU behaviour, touch latency, or
memory-pressure behaviour, and nothing below does.

The shared Element PAPI parity card **has** run on both: all twenty shared
operations were reported passing on the A03 on 2026-10-09, and the same twenty
operations passed on the emulator on 2026-10-25 with a stored capture. The A03's
capture was not kept, so
[parity-checklist.md](parity-checklist.md) keeps that run as its own `reported`
historical note while recording the emulator column as measured, and
`scripts/verify-native-parity.mjs` is what makes the next run checkable; the
stylesheet and list cards' stage lines are read by `scripts/verify-native-probe.mjs`,
its sibling, with the same exit codes. See also [building.md](building.md).

How a run is kept is now a checked requirement rather than a convention. A
verifier-passing capture is stored at `docs/evidence/native/<date-or-id>/` beside
a `manifest.json`, and `scripts/require-native-evidence.mjs` — wired into the
`native-evidence` CI job to run over every pull request — fails a change to
native-facing code that carries neither that nor an explicit recorded
`decision.json`. That job has not run on GitHub Actions yet; the failure above
is the script's measured behaviour, not an observed CI event. A third record, `pending.json`, states that the run is
scheduled and blocked on hardware; it is accepted when it covers every
native-facing path in the change, and it makes the gate exit 3 ("pending, not a
pass") rather than 0, so a release can be explicit about an absent measurement
without claiming one. The three pending records this release first shipped for
`smoke`, `stylesheet` and `list` were deleted in `85ddd12` once the emulator
captures existed; the A03 half of what they said is the historical note above,
and the cards still have no A03 capture.
[evidence/native/README.md](evidence/native/README.md) is the
contract. It enforces that evidence exists and is re-verifiable; it does not
execute a device, so a capability row still moves only on a run someone
performed. This release stores three verifier-passing emulator captures under
`docs/evidence/native/2026-10-25-emulator-api33-*/` (plus the v2 stylesheet
capture, which has no manifest), and they are what moved the stylesheet and list
rows below out of "nothing has run". The
capability probe below has only been run in a browser, so the per-capability
Native column of the summary table stays `not measured` — the emulator ran the
parity, stylesheet and list cards, not this probe. `@lynx-js/types` is not a
dependency of this repository, so native JSX typings remain unverified and are
marked as such rather than assumed.

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

| Capability | Web (`@lynx-js/web-core` 0.26.2) | Native (emulator measure where noted; otherwise not measured) | Status today |
| --- | --- | --- | --- |
| Keyed lists (`For`) | supported, tested | not measured | Works. Rows move instead of being recreated. |
| List virtualization (`__CreateList`) | supported, measured | create/materialize/reorder/shrink measured on the API 33 emulator; **recycling not observed** | `root.createList()` materializes a row by index, keyed; the host owns which cells it asks for. On the measured engine a permuted model moved 3 rows keeping element identity, a shrink to 1 released 2 rows, and `enqueueComponent` was never called. No host has been seen to recycle a cell. |
| Gestures | unsupported, measured | not measured | `gesture-*` props become plain attributes and never fire. |
| Animation | host-only, measured | not measured | Use inline styles and CSS transitions. |
| Overlays and portals | unsupported, measured | not measured | `<overlay>` is an ordinary child; importing `Portal` fails at build time. |
| Form input events | partially supported, tested | not measured | `bindinput` and `bindconfirm` deliver; `bindchange` does not. |
| Asynchronous content | supported, tested | not measured | Promise plus signal. No `createResource`, no streaming. |
| Refs and imperative access | supported, tested | not measured | A ref receives the live Lynx node and is released with its Solid scope. |
| CSS ids | supported, tested | not measured | `root.setCSSId()` assigns a compiled CSS id to a root's own page children. |
| Stylesheet loading and lifecycle | unsupported, by inspection | load measured on the API 33 emulator; **lifecycle unmeasured** | web-core has no PAPI for it, so there is nothing implemented to call. Native exposes `__LoadStyleSheet` and friends; on the measured engine `[url, "utf-8"]` returns `null` and reaches `probe.css`, a `[url]`-only call and any non-String second argument throw with named errors, and **no call returned a stylesheet handle**, so nothing is owned, nothing can be removed, and no rule is shown to be applied. |

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
  still holds the list cannot repopulate a disposed model. A root that owns the
  list releases it before its own nodes, so disposing the root leaves no row,
  no row listener, and no materializable cell behind (`test/renderer.test.ts:2086`
  covers that whole-root case).

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

**Native list behavior is now measured on an emulator, and recycling is not.**
The A03 smoke on 2026-10-09 rendered the existing native card
(`Native parity count: 0`) and a `bindtap` updated it to `1`, but that card did
not create a list or call either list callback — it is evidence for native card
rendering and tap delivery only, and **no A03 run has ever created a list**. The
list measurement that exists was taken on the API 33 `x86_64` emulator instead
(`docs/evidence/native/2026-10-25-emulator-api33-list/`, seven stages, verifier
exit 0).

#### What the list card measured on the API 33 emulator

1. **The inventory is three bindings, not four.** `__CreateList` and
   `__UpdateListCallbacks` are present (`arity` 3 each); `__UpdateListComponents`
   and `__GetListComponents` are **`undefined`** on this engine. `__AddEventListener`
   and `__RemoveEventListener` are present. That is one engine's inventory and is
   recorded per run rather than assumed.
2. **`create` returned a handle** — `returnedHandle: true`, `handleTypeof:
   "unknown"`, a `listId` of 14. `typeof` `"unknown"` is the normal native PrimJS
   reading, not a failure.
3. **`materialize` produced 3 children** for a 3-item model (unique ids 15, 17,
   19), and the host did not ask for any of them itself:
   `hostAskedAfterUpdate`, `hostAskedWhileMaterializing` and `hostAskedOnItsOwn`
   are all `false`.
4. **A permuted model moved 3 rows and kept their identity.**
   `keyedIdentityPreserved: true`, `existingRowsMoved: 3`, element ids went from
   `[15, 17, 19]` to `[19, 15, 17]`, `sameNode` names all three, and
   `anyRowReleased: false` with `released: []` — no row was rebuilt or released
   by the reorder.
5. **A shrink to 1 released 2 rows.** `diff.released` is `["charlie",
   "bravo"]`, `kept` is `["alpha"]`, children went 3 → 1, and the surviving
   child kept id 15.
6. **`enqueueComponent` was never called in any stage.** `hostCallCounts` reads
   `componentAtIndex: 0`, `enqueueComponent: 0`, `updateListCallbacks: 3`, and the
   per-stage `hostRecycled` in `shrunk` is `false`.

That sixth finding is the recycling answer, and it is still a **negative** one:
recycling remains unobserved. What changed is where that sentence applies. It used
to be "no device run has created a list"; it is now "a measured engine created a
list, moved rows, and released rows without ever calling `enqueueComponent`". The
card's own `summary.unmeasured` says why a zero cannot be read as an inability:

> Nothing in this card scrolls. A native list recycles cells in response to a
> viewport asking for them, and no stage produces that request, so a zero
> enqueueComponent count cannot be read as the host being unable to recycle.

Scroll behaviour, cell reuse timing, `operationId` and `enableReuseNotification`
semantics, and `__UpdateListComponents`/`__GetListComponents` are all listed as
unmeasured in that same stage. So: native list support is **measured for
create, materialize, keyed reorder and shrink on this emulator**, and
**unmeasured for recycling, scrolling and cell reuse**, and there is still no A03
list run of any kind.

Real virtualization would need a host that asks for cells on its own, and native
validation of both callbacks against the native list.

A measurement card for that validation **has been run**, on the same emulator
engine as the stylesheet captures, and it measured the card rather than the
host's recycling: the list rendered, the element tree and row model agreed across
a materialize, a reorder and a shrink, and the host never called
`enqueueComponent` during the run. `examples/lynx-for-native/src/list-probe.ts`
builds through `pnpm native:build` as `dist/list-probe.lynx.bundle`; it shares its
shape with the stylesheet probe (`[solid-lynx lp]` stages, one JSON line each,
recorder helpers in `list-probe-report.ts` covered by
`test/list-probe-report.test.ts`) so one runner drives every native card. It is a
measurement, not support: it calls `root.createList()` with three toy items and
logs one line per stage:

| Stage | What it does | Why that is allowed |
| --- | --- | --- |
| `inventory` | `typeof`, `fn.length`, `fn.name`, `String(fn)` for the four list bindings, plus `namedPresent` and whether the counting layer installed | No call is made, so nothing is mutated. `fn.length` is recorded as evidence about the binding, not read as a signature. |
| `create` | `root.createList()` with three toy items, then `flush()` | Reports whether a handle came back and what `typeof` says about it, because a native PrimJS element reports `typeof === "unknown"` and is still usable. |
| `materialize` | Gives the host its chance first (`update()`), then materializes rows through the model's `materialize()` | Scores the two apart: `hostAskedAfterUpdate`, `hostAskedWhileMaterializing`, and `hostAskedOnItsOwn` are the host's half; `requestedCount`/`materialized` are the probe's. |
| `reorder` | Installs a permuted model and calls `update()` | Compares element unique ids before and after, so a moved row is not mistaken for a rebuilt one; `elementOrderChanged` is the host-visible half. |
| `shrunk` | Installs a one-item model and calls `update()` | Records which rows were released and whether the host called `enqueueComponent` during the stage — recycling is the host's decision, so the counter is the only honest evidence either way. |
| `summary` | States what was measured and what was not, and carries the final `hostCallCounts` | Keeps the report from claiming more than it did, and is where the recycling answer lands. |
| `done` | `status: "all stages logged"` | Says the card reached the end. |

#### What can be verified by process

The same checker reads a `[solid-lynx lp]` capture
(`scripts/verify-native-probe.mjs`), and requires the seven stages above in that
order. Beyond presence and parseability it checks the two distinctions the card
exists to make:

- **"the host asked for this row" is not merged with "the probe materialized
  this row".** `materialize` must carry both halves, and
  `hostAskedOnItsOwn` must equal
  `hostAskedAfterUpdate || hostAskedWhileMaterializing` — a capture whose derived
  field disagrees with its own inputs is a finding.
- **whether `enqueueComponent` was ever called is answered, including when it
  was not.** `summary.hostCallCounts.enqueueComponent` must be present and a
  number. A recorded `0` is a complete answer ("the host never called it on this
  card") and the capture verifies; an omitted counter is a finding, because the
  capture then leaves open the question the card was run to close. The same
  fields are required on `shrunk`, where `hostRecycled` is derived from the
  counter.

The checker also records that a list arity is only ever checked for being a
number, for the same reason as the stylesheet card.

**Its device run is pending.** No line from it has been observed, so nothing
below changes: no native list behavior is measured, and no host has been seen to
recycle a cell. A verified fixture proves the checker works, not that a device
produced the stages. What the card cannot establish even when it runs is
also recorded in its own `summary` stage: recycling driven by a viewport, scroll
behavior, and cell reuse timing all need a scrolling list, and the card creates
none.
#### The inventory's names, and the two bindings that are absent

A real capture found that this card's `inventory` stage could not name the
binding it described. Every probed global was supposed to be recorded with its
own name, but the card spread the runtime's description over the name it had
filed the binding under, and a native binding reports `fn.name === ""`. On the
measured engine `__CreateList` and `__UpdateListCallbacks` are present, report
arity `3` and an empty `fn.name`, and arrived in the capture **nameless** — so a
reader could no longer tell which binding a row described. The probed name is now
written last and always wins (`describeListInventory`), while the name the
runtime reports is kept separately as `fnName` and the row records where its name
came from (`enumeratedAs`: `own`, `absent`, or `unreadable`). An inventory that
cannot name the binding it probed is not evidence.

That fix also makes the absent bindings legible, and the two that are absent on
the measured engine are the two the summary stage already lists as inventoried
only. **On the measured engine, `__UpdateListComponents` and
`__GetListComponents` are absent**: both are listed in the card's inventory and
both report `typeof: "undefined"`. That is a fact about the one engine this
repository has measured (Lynx Explorer 4.1.0 on API 33 `x86_64`), and it is not
generalised to all native hosts — another Lynx build may expose them. Neither was
called, and neither is claimed to exist anywhere else; what the capture now says,
unambiguously, is which two names the host does not expose.

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
behaviour. Importing `Portal` from `@apothic-ai/solid-lynx` fails at build time
because the package does not export it, which fails loudly rather than degrading
silently.

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

Native is not measured for the renderer's purposes, and the inventory half is
measured: both the A03 hand run and the API 33 emulator capture record that a
native host **does** expose `__LoadStyleSheet`, `__AdoptStyleSheet`, and
`__ReplaceStyleSheets`, names web-core does not have. What they accept and do is
now partly measured on the emulator — see "The five measured stylesheet facts"
below — and the parts that are not measured are named there rather than left
implied. `@lynx-js/types` is still not a dependency, so their declared contract
is not described either.

#### The five measured stylesheet facts

All of these calls were made on the API 33 emulator, Lynx Explorer 4.1.0, and
every one is traceable to a stored line. The v2 capture's own `summary` counts
them: `attemptsRecorded: 16`, `callsThatThrew: 10`, `callsThatReturned: 6`,
`handlesReturned: 0`. The arity facts come from the **v2** capture's
`loadstyle-arity`, `adopt-arity` and `replace-arity` stages; the one-argument
negative result is independently recorded in the **v1** capture's
`load-real-url` stage, on the same engine.

| # | Fact | Engine answer | Where |
| --- | --- | --- | --- |
| 1 | `__LoadStyleSheet` requires **two** parameters, the second a **String** | `[url]` throws `LoadStyleSheet param size should >= 2`; `[url, null]`, `[url, 0]`, `[url, {}]`, `[url, function(){}]`, `[url, []]` throw `LoadStyleSheet param 1 should be String`; `[url, "utf-8"]` and `[url, url2]` **return `null`** | v2 `loadstyle-arity`; v1 `load-real-url` |
| 2 | `__AdoptStyleSheet` requires **>= 1** parameter | `[]` throws `AdoptStyleSheet param size should >= 1`; `[null]` and `[{}]` throw `AdoptStyleSheet param 0 should be RefCounted` | v2 `adopt-arity` |
| 3 | `__ReplaceStyleSheets` accepts nothing and reports nothing | `[]`, `[null]`, `[[]]` all **return `null`** and none throws — so nothing about a set's ownership is proven by the call | v2 `replace-arity` |
| 4 | **No call in any card returned a stylesheet handle** | `returnedHandles: 0` in both v2 arity stages and in the lifecycle stage; `__CreateStyleObject` exists and returns a **plain object** (`typeof "object"`, empty keys), not an opaque handle | v2 `loadstyle-arity`, `adopt-arity`, `replace-arity`, `style-object-path`, `lifecycle` |
| 5 | The **lifecycle is still unmeasured**, and why | No handle means nothing to adopt and no set to replace with; the v2 card recorded that in its own `summary.unmeasured` rather than inferring it | v2 `summary` |

The second parameter is therefore an **encoding/label string**, not an instance or
context: everything that is not a String is rejected by name, and the Strings
that were tried were accepted. `fn.length` is `0` for all three operations, so
`fn.length` is **not** the signature — this is the trap the earlier version of
this section warned about, and the engine's own error text is the answer. The
engine enforces parameter count and type at call time, so a caller that reads
`arity` and passes one argument gets a throw, not a load.

**Fact 5 is the one that keeps this capability out of the renderer.** Fact 4 is
why fact 5 follows, and the v2 capture says it in its own words, in
`summary.unmeasured`:

> No call in this card returned a handle, so there is nothing to adopt and no
> set to replace with. The cases that could run (null, {}, []) were run and are
> recorded above; the handle cases were skipped rather than fabricated.

So: **what a stylesheet handle is, how one is created, how it is adopted, and how
a set of them is replaced are all unknown.** A load that reaches a stylesheet
returns `null`; it does not say the sheet is owned, is applied, can be removed,
or that a rule in it took effect. The card loads `probe.css`, whose rules match
nothing it renders, precisely so that a successful load cannot change what the
card observes. Nothing in `src/` may call these bindings on the strength of what
is measured here, and nothing does.

Two limits on the table above, stated so it is not read as more than it is: all
five facts are from **one runtime** (the API 33 `x86_64` emulator), and **none of
them is an A03 measurement** — the A03 run observed the three globals and nothing
more. If the tablet's engine ever disagrees, that is a new measurement, not a
contradiction of one.

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
| `load-real-url` | `__LoadStyleSheet` called twice against a real, inert stylesheet next to the bundle: once as `[url]`, then as `[url, "utf-8"]` | The only calls that can change anything, and they change a disposable card. Both are recorded in this one stage, in this order, because the contrast is the evidence — see below. The verifier reads the last call, which is the two-argument load. |
| `summary` | States explicitly what was not exercised and why | Keeps the report from being read as a claim about the unexercised operations. |
| `done` | `status: "all stages logged"` | Says the card reached the end, so a capture that stops earlier is visibly short. |

Adopting and replacing are **not** called with fabricated arguments. Both need a
stylesheet handle or a stylesheet set whose membership and ownership this probe
has no contract for, so any call would either prove nothing or would strip the
card's own styles. They are recorded as unmeasured with that reason rather than
guessed at.

### The second native stylesheet probe (v2)

The v1 run left one question open — the mandatory second parameter of
`__LoadStyleSheet` — and its inventory listed eight style-related globals it never
examined (`__CreateStyleObject`, `__SetStyleObject`, `__UpdateStyleObject`,
`__SetParsedStyles`, `__GetComputedStyles`, `__GetInlineStyle`,
`__GetComputedStyleByKey`, `__AddInlineStyle`). A stylesheet lifecycle, if one
exists on this engine, probably runs through a style object rather than only
through a load.

`examples/lynx-for-native/src/stylesheet-probe-v2.ts` is a **separate card** that
asks those two questions, in one run, under its own `[solid-lynx ss2]` prefix and
its own `probe` name (`native-stylesheet-papi-v2`). v1 is untouched: its capture
is the ground truth v2 reasons from, and a card whose stage set grew would make
the two captures incomparable. Both are built by `pnpm native:build`.

| Stage | What it does | Why that is allowed |
| --- | --- | --- |
| `inventory-v2` | `typeof`, `fn.length`, `fn.name`, `String(fn)` and own property names for **every** style-named global, discovered from the host and unioned with the fourteen v1 recorded | Reading a binding cannot mutate the card. Identical `String(fn)` text is recorded once in `sources` and the name/prototype/own-property set once in `shapes`, then referenced — see the size note below. |
| `loadstyle-arity` | The core experiment: `__LoadStyleSheet` with exactly `[url]`, `[url, null]`, `[url, 0]`, `[url, {}]`, `[url, "utf-8"]`, `[url, function(){}]`, `[url, []]`, `[url, url2]`, each recorded verbatim | A bounded list on a disposable card. `url` and `url2` are two different stylesheets really served beside the bundle, so the last case is not the first case twice. A failure is a result: if all eight produce the same error, the finding is that the binding needs a parameter this probe cannot fabricate. |
| `adopt-arity` | `__AdoptStyleSheet` with no arguments, `null`, `{}`, and the handle from any successful load | The handle case only exists if the load stage produced one. `handleAvailable` records whether it did, which is the difference between "the host rejected this handle" and "this card never had one". |
| `replace-arity` | `__ReplaceStyleSheets` with no arguments, `[null]`, `[[]]`, and an array from a successful call if one exists | v1 measured "no arguments" returning `null`, so a call that accepts nothing and one that accepts an empty set are separate cases rather than one assumed answer. |
| `style-object-path` | `__CreateStyleObject()` and `__CreateStyleObject({})`; if either returns an opaque handle, `__SetParsedStyles`, `__SetStyleObject` and `__UpdateStyleObject` are called with it | Only a handle this card created is ever passed back. A primitive, `null`, or `undefined` return is not a handle, and no fabricated one is substituted. |
| `lifecycle` | Reads the card's own styles back through `__GetInlineStyles`, `__GetInlineStyle`, `__GetComputedStyles` and `__GetComputedStyleByKey` after every write | Read-only bindings only, run last, and the staged stylesheets match nothing the card renders, so the stage can show that a call did not break the card and cannot claim a rule was applied. |
| `summary` | What was measured, with counters derived from the stages above, and what was not, with the reason | Includes the number of *distinct answers* the eight load cases produced, so an all-threw run reads as the single finding it is rather than as eight unexplained errors. |
| `done` | `status: "all stages logged"` | A capture that stops earlier is visibly short. |

#### The delivered-line budget

Every stage line is measured against **2,040 bytes**, the largest complete,
parseable line in v1's capture and therefore the largest line the native console
bridge is known to deliver intact. A stage that arrives truncated is worse than a
missing one: it is the stage that would have answered the question.

Two measurements drove the design. With the fourteen globals v1 reported, writing
each one's `String(fn)`, `name`, prototype flag and own property names out in full
produced a 2,957-byte `inventory-v2` line; interning the source text and the shape
brought it to 1,781 bytes. An all-threw `loadstyle-arity`, where every one of the
eight attempts repeats the same 70-character engine error, produced 2,666 bytes
until the error text was interned into an `errors` table, after which it is 1,889.

Interning creates its own failure mode — a key that does not resolve loses the
engine's words while the line still looks complete — so the verifier checks every
`source`, `shape` and error key against the table it names, and the card carries a
richest-first fallback: the full payload, then the same attempts without the
redundant argument descriptions, then that without the grouping echo. Whichever
form is used is recorded in `fitForm`, and if none fits the payload says
`overBudget` rather than emitting a line that may be truncated.

Two rules the card keeps from v1: nothing is inferred from a name, and an arity is
never turned into an expected parameter list. One rule it adds: **it never claims
a stylesheet lifecycle.** Every stage records calls and their results. If
`__LoadStyleSheet` turns out to need a second parameter that only the engine can
supply — an instance or context handle — that is recorded as the finding, because
a value invented to satisfy the arity would measure the probe instead of the host.

`scripts/verify-native-probe.mjs` reads a `[solid-lynx ss2]` capture as a fourth
card. It checks that every required stage is present once, in order; that
`loadstyle-arity` records eight distinct labelled attempts; that the handle-bearing
cases state whether a handle was available; that `style-object-path` either calls a
setter or says why it could not; and that `summary`'s counters add up to the
attempts it summarises. It deliberately does **not** require any case to succeed:
an all-threw capture is a complete answer to the question the card asks, so a
checker that treated it as a finding would invert the card's purpose. A
`lifecycle` payload whose `claim` reads as an applied rule or an owned sheet is a
finding (`lifecycle-claim`).

**v2 has now been run once on the same engine, and it answered the arity
question.** A `[solid-lynx ss2]` capture was taken on Lynx Explorer 4.1.0 on API
33 `x86_64` (`docs/evidence/native/2026-10-25-emulator-api33-stylesheet-v2/capture.log`)
and its `loadstyle-arity` stage produced the three distinct answers in the table
above — which is where the encoding-string contract v1's `load-real-url` stage now
uses comes from. **That directory holds a capture and no `manifest.json`, so it
is supporting bytes rather than a record**: the evidence gate does not count it,
and neither does any claim here beyond "the bytes say this". Nothing about the
style-object path or a lifecycle was answered by it: `style-object-path` found
`__CreateStyleObject` existing but returning no opaque handle, so no setter was
called with one, and `lifecycle` recorded reads of the card's own styles only.
Those two questions remain what a further run is for, and the v2 `summary` stage
states them in `unmeasured` — see "The five measured stylesheet facts" above.

#### What can be verified by process

`scripts/verify-native-probe.mjs` reads a capture and exits with the same three
codes as the parity verifier — 0 verified, 1 findings, 2 could not evaluate. For
a `[solid-lynx ss]` capture it checks:

- all six stages above are present, once each, in that order, and every line
  after the marker parses as JSON;
- `inventory` describes all three bindings, and any `arity` it records is a
  *number* — the checker never turns `fn.length` into an expected parameter
  count, and says so in the source (see `checkArityFields`);
- `load-missing-url` recorded an absolute URL and a `threw`, and `load-real-url`
  recorded a *different* absolute URL and a return rather than a throw. That is
  the "the mutating stage reached the real stylesheet while the missing-URL stage
  failed" claim, checked against the capture's own fields rather than asserted;
- `summary.unmeasured` is present and non-empty. The wording is not checked — it
  belongs to the card — only that the summary does not assert nothing.

A capture with an unknown extra stage still verifies: the rule is *at least* the
required set, so a later card that logs more does not fail its own checker.

```bash
examples/lynx-for-native/scripts/run-native-probe.sh stylesheet
node scripts/verify-native-probe.mjs \
  /tmp/solid-lynx-logs/lynx_console-stylesheet-<stamp>.log
```

**The card has since been run once, on an Android emulator, and the run did not
answer what it was built to answer.** The capture
(`docs/evidence/native/2026-10-25-emulator-api33-stylesheet/capture.log`, taken on
Lynx Explorer 4.1.0 on an API 33 `x86_64` emulator, serial `emulator-5554`, rather
than on the A03; its `manifest.json` records that runtime and verifier exit 0)
recorded three facts that change how this section has to be read:

1. `fn.length` is `0` for all three operations. The arity the table above records
   as evidence is therefore not the signature, and cannot be used as one.
2. `__LoadStyleSheet` threw `error code: 111101 / error message: LoadStyleSheet
   param size should >= 2` when called with **no** arguments and again when
   called with a **single string URL**. The second parameter is mandatory and v1
   never identified it, so the `load-real-url` stage measured a rejected call,
   not a load.
3. `__AdoptStyleSheet` reported `AdoptStyleSheet param size should >= 1`, and
   `__ReplaceStyleSheets` returned `null` with no arguments instead of throwing.

The stages, the field names, and the verifier above are unchanged and are still
what a v1 capture is checked against. What the run changed is the claim this
document may make from it: the three names are confirmed to exist, and nothing
about their signatures, their ownership, or a lifecycle is measured. A verifier
that accepts a synthetic fixture is not a device run, which is why
`test/fixtures/native-probe/README.md` labels every fixture as not evidence.

#### The second parameter, measured — and what v1 now records

The v2 card's `loadstyle-arity` stage answered the question v1 left open by
calling `__LoadStyleSheet` with a bounded list of second arguments on the same
engine. Three distinct answers came back, and they are the contract v1's
`load-real-url` stage now uses:

| Case | Outcome | Engine answer |
| --- | --- | --- |
| `[url]` | threw | `LoadStyleSheet param size should >= 2` |
| `[url, null]`, `[url, 0]`, `[url, {}]`, `[url, function(){}]`, `[url, []]` | threw | `LoadStyleSheet param 1 should be String` |
| `[url, "utf-8"]`, `[url, url2]` | returned | `null` |

The second parameter is therefore an **encoding/label string**, not an instance
or context handle: everything that is not a String is rejected by name, and the
one String that was tried was accepted. (`url2` is a second URL being read as a
label, which says a String is accepted rather than that `"utf-8"` in particular
is.) The v1 capture itself measures the negative half: its one-argument attempt
threw, and it is kept in the capture as exactly that.

With that measurement, v1's `load-real-url` stage records **both** calls, in
this order:

1. `[url]` — the one-argument form v1 shipped. Recorded as a **measured
   negative result**: on the measured engine it throws `LoadStyleSheet param
   size should >= 2`, so the engine requires a second, String parameter and one
   URL is not enough to load anything.
2. `[url, "utf-8"]` — the load, and the last call in the stage, so
   `scripts/verify-native-probe.mjs` reads it as the one that reached the served
   stylesheet. With the fix, v1 records a load of `probe.css` that **did not
   throw**.

Neither call returned a **handle**: the accepted form returns `null` on the
measured engine, so there is still nothing to adopt, nothing to replace, and
nothing owned. All three operations — `__LoadStyleSheet`, `__AdoptStyleSheet`,
`__ReplaceStyleSheets` — remain **unmeasured for lifecycle**. A load that reaches
a stylesheet says the binding accepts a URL and an encoding label; it does not
say the sheet is owned, is applied, can be removed, or that a rule in it took
effect. The card still loads a stylesheet whose single rule matches nothing it
renders, so a successful load cannot change what the card observes.

Two properties of the fix are checked without a device: the recorder helper that
builds the two calls (`loadRealUrlCases` in `stylesheet-probe-report.ts`) is
covered by `test/stylesheet-probe-report.test.ts`, including the order — the
verifier judges the last call, so the two-argument load has to be it — and a
host-free test in `test/native-probe-verify.test.ts` drives the real verifier
with a capture built from that helper against an engine that behaves as the v2
capture measured, and asserts exit 0. Green there proves the card produces an
acceptable capture; it does not substitute for the device run that will produce
the capture the claim rests on.

#### Running it

One runner drives all four native cards,
`examples/lynx-for-native/scripts/run-native-probe.sh` in the repository, and
the card is its argument:

```bash
examples/lynx-for-native/scripts/run-native-probe.sh stylesheet --dry-run
```

| Card | Argument (aliases) | Bundle | Console prefix |
| --- | --- | --- | --- |
| parity smoke | `smoke` (`main`) | `main.lynx.bundle` | `[solid-lynx parity]` |
| this probe | `stylesheet` (`stylesheet-probe`) | `stylesheet-probe.lynx.bundle` | `[solid-lynx ss]` |
| the v2 probe | `stylesheet2` (`stylesheet-v2`, `stylesheet-probe-v2`) | `stylesheet-probe-v2.lynx.bundle` | `[solid-lynx ss2]` |
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
stages, so reading the capture is still a separate step — but it is no longer a
separate *checker*: `scripts/verify-native-probe.mjs` reads the stylesheet and
list captures, and `scripts/verify-native-parity.mjs` reads the smoke capture.
Each turns a capture into exit 0/1/2, and `scripts/require-native-evidence.mjs`
runs the right one for a stored manifest's `card`.

**No card has been run on a device through this script.** Only `--dry-run` has
been executed, for all four cards and for the wrapper (exit 0 each). A reviewed
command sequence is not a measurement, so everything the cards have measured was
measured by opening a bundle in Lynx Explorer directly, not by a runner result.

All four captures that exist were taken outside this runner, by opening the
bundle in Lynx Explorer on an API 33 `x86_64` emulator (`emulator-5554`) rather
than on the pinned A03, and three of them were then stored as records:

| Card | Stored capture | Manifest |
| --- | --- | --- |
| smoke | `docs/evidence/native/2026-10-25-emulator-api33-smoke/` | yes, verifier exit 0 |
| stylesheet (v1) | `docs/evidence/native/2026-10-25-emulator-api33-stylesheet/` | yes, verifier exit 0 |
| list | `docs/evidence/native/2026-10-25-emulator-api33-list/` | yes, verifier exit 0 |
| stylesheet (v2) | `docs/evidence/native/2026-10-25-emulator-api33-stylesheet-v2/` | **no** — supporting bytes, not a record |

They are treated as measurements of the engine's behaviour — the v2 card's
questions come from the v1 capture, and v1's `load-real-url` fix comes from the v2
one — but none of them went through this script, so none of them makes a line
above a runner result, and none of them is an A03 run. The runner's pinned serial
is still `R9WT911JVVH`.

## Remaining blockers

- The Native column of the summary table is `not measured` for every capability
  except the two the cards measure. The shared Element PAPI parity card has run
  on the A03 (reported) and on the API 33 emulator (captured), and the stylesheet
  and list cards have run on the emulator (captured); the *capability probe* in
  `examples/lynx-patterns` has still only run in a browser, so no per-capability
  native claim outside those two rows is verified.
- Native PAPI names: both the A03 hand run and the emulator captures recorded the
  global inventory (for example `__SetCSSId`, `__LoadStyleSheet`,
  `__AdoptStyleSheet`, `__ReplaceStyleSheets` all exist). On the emulator the
  stylesheet names' **call-time arity and return values** are now measured (see
  "The five measured stylesheet facts"), and their **semantics — ownership,
  application, removal — are not**, because no call returned a handle.
- Gestures are the only silent failure. Making them fail loudly would mean
  changing the property path in `src/lynx-host.ts`, which is renderer behaviour
  rather than a platform capability, so it is left for a deliberate change.
- List virtualization now has a renderer-side indexed row model
  (`root.createList()`), measured against web-core. The native card has since run
  on the emulator engine and recorded rows, element identity across a permuted
  model, and a release on shrink — with the host asking for no cells and
  recycling none. What is still missing is a host that recycles cells: native
  list *recycling* is unverified, not merely untested. An emulator that never
  scrolls the card cannot produce that observation.
- The native list PAPI on the measured engine is three bindings, not four:
  `__CreateList` and `__UpdateListCallbacks` exist and `__UpdateListComponents` and
  `__GetListComponents` do not. That is one engine's inventory and is not
  generalised; the card records the answer per run rather than assuming it.
- Native `__SetCSSId` exists — both device inventories list it — but
  `root.setCSSId()` has not been exercised on a device, so that path is still
  unmeasured even though the renderer already treats the PAPI as optional and
  fails loudly when a host lacks it.
- Stylesheet loading has no PAPI on web to verify, so on that host the capability
  is absent rather than blocked. On native, a load now reaches a stylesheet and
  returns `null`: arity and argument types are measured, ownership is not. There
  is still no handle, therefore still no adoption, replacement, removal, or
  applied rule to measure, and the lifecycle questions the card was built to ask
  are still open. This is also why stylesheet *cleanup* is not a pending item
  anywhere: the renderer never loads one, so the 1.0 roadmap box now claims
  cleanup only for the resources it does acquire (see
  [ROADMAP.md](../ROADMAP.md) and `docs/contract.md` §9).
- The A03 has no capture for any card. Every stored capture in this repository
  is from the API 33 `x86_64` emulator, so nothing here can be cited as
  tablet behaviour: the two runtimes share an Explorer build and an APK digest,
  not silicon, not a device image, and not an input path.
