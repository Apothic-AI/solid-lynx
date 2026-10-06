# Native and web parity checklist

The renderer only speaks the Element PAPI, so parity between hosts is a
statement about PAPI behaviour rather than about Solid features. This checklist
records, per operation, what the web host and a measured native host do.

`runElementPapiParity()` from `solid-lynx/parity` produces the rows below. The web
column is filled automatically by the "reports shared Element PAPI parity for the
web host" test in `test/browser/lynx-for-web.test.ts`, which runs the harness
inside a live `<lynx-view>`. The native column comes from the hand run on Lynx
Explorer 4.1.0 (`com.lynx.explorer`) on an SM-A037U; see
[building.md](building.md) for how to reproduce it. Both hosts pass all twenty
shared operations.

Status values: `pass` matches the expected result, `fail` does not and carries an
`observed` value, `unsupported` means the host does not implement the PAPI at
all.

## Shared Element PAPI operations

| Operation | Element PAPI | Expected | Web (`@lynx-js/web-core`) | Native (device) |
| --- | --- | --- | --- | --- |
| `page` | __CreatePage | page | pass | pass |
| `sandbox` | __CreateView, __AppendElement | attached | pass | pass |
| `element-unique-id` | __GetElementUniqueID | unique id >= 0 | pass | pass |
| `create-element` | __CreateView, __CreateElement | view | pass | pass |
| `create-raw-text` | __CreateRawText, __GetAttributeByName | parity | pass | pass |
| `append` | __CreateElement, __AppendElement, __GetChildren | 2 children | pass | pass |
| `insert-before` | __CreateElement, __InsertElementBefore, __GetChildren | inserted | pass | pass |
| `remove` | __RemoveElement, __GetChildren | removed | pass | pass |
| `traverse` | __FirstElement, __NextElement, __GetParent | first, next, parent | pass | pass |
| `set-attribute` | __SetAttribute, __GetAttributeByName | attribute | pass | pass |
| `attribute-names` | __SetAttribute, __GetAttributeNames | listed | pass | pass |
| `classes` | __SetClasses, __GetClasses | alpha,beta | pass | pass |
| `inline-styles` | __SetInlineStyles | style set | pass | pass |
| `dataset` | __GetDataset | dataset | pass | pass |
| `id` | __SetID, __GetID | parity-id | pass | pass |
| `event-listener` | - | listener API present | pass | pass |
| `flush` | __FlushElementTree | flushed | pass | pass |
| `renderer-mount` | __CreateView, __CreateRawText | mounted | pass | pass |
| `renderer-text-update` | __SetAttribute, __GetAttributeByName | updated | pass | pass |
| `renderer-dispose` | __RemoveElement, __GetChildren | released | pass | pass |

The fake PAPI in `test/parity.test.ts` passes all twenty operations too, which
is what makes a native `fail` attributable to the host rather than to the
renderer.

Notes recorded during the native run:

- `page`: the native host **does** expose `__CreatePage`, and `__GetPageElement()`
  returns `null` until it has been called. `examples/lynx-for-native` therefore
  creates the page with `__CreatePage("0", 0)` and passes the same element to
  the harness and to `createLynxRoot`; see [building.md](building.md).
- Element handles: native PrimJS reports them with `typeof` `"unknown"` rather
  than `"object"`. The host validates creators with `isLynxNode()` instead of a
  DOM `typeof` check, or every element a device creates is rejected.
- `inline-styles`: native keeps the style out of the `style` attribute and
  exposes it through `__GetInlineStyles`, so the harness reads it back that way.
  Style *computation* on a device, including `__GetComputedStyleByKey`, is a
  separate question this row does not answer.
- `dataset`: hosts spell dataset writes `__AddDataset` or `__SetDataset`; both are
  accepted, and the row records which one the host has. Native exposes both and
  the harness uses `__AddDataset`.
- `event-listener`: presence only. Native exposes `__AddEventListener` and
  `__RemoveEventListener` (and `__AddEvent`); whether a handler is delivered at
  all is the runtime table below.

## Runtime behaviour

These need a running card on each host, so they are checked separately from the
PAPI probes.

| Behaviour | Web (`@lynx-js/web-core`) | Native (device) | How to check |
| --- | --- | --- | --- |
| Initial render and text mount | verified | verified | Open the card; `#parity-count` reads `Native parity count: 0`. |
| Reactive text update | verified | verified | Tap `#parity-increment`; the count increases to 1. |
| Tap dispatch through `bindtap` | verified | verified | Tap `#parity-increment`; the count increases and no renderer error is logged. |
| Event propagation, capture, and catch | verified | not measured | Extend the card with the event cases from `examples/lynx-for-web`. |
| `global-bind` delivery | known host gap | not measured | Register `global-bind:tap` and tap elsewhere; web-core never invokes it. |
| Namespaced `main-thread:` bindings | verified | not measured | Bind `main-thread:bindtap` and confirm the handler runs. |
| Listener replacement and removal | verified | not measured | Swap a handler, then drop it, and confirm one registration is added and removed. |
| Listener cleanup on root disposal | verified | not measured | Dispose the root and confirm the page has no nodes left. |
| Multiple isolated roots | verified | not measured | Host a second root in a component and dispose one root. |
| Disposed root can be mounted again | verified | not measured | Dispose, then render into the same root again. |
| Ref release with its Solid scope | verified | not measured | Toggle or dispose the owner of a `ref` and confirm the ref no longer holds the node. |
| Dual-thread execution | not applicable | not measured | Both examples set `background: false`. A card with a background thread is out of scope for this package. |
| Worklets | not applicable | not measured | Owned by Lynx's worklet compiler, not by this renderer. |
| First-screen synchronization | verified for web | not measured | Whether the first screen renders from the first flush on a device. |
| Stylesheet loading and CSS ids | CSS ids verified; stylesheet loading has no PAPI | not measured | `root.setCSSId()` and watch `__SetCSSId` calls. Loading a stylesheet at runtime cannot be checked because no host exposes it. |

The native device run also shows a `processData is not a function` banner from
Explorer's LogBox: with `background: false` the bundle's `/app-service.js` is
intentionally empty, and the shell still invokes `processData` on it. It does not
affect loading, rendering, or tap dispatch.

## How to re-measure the native column

The column above is filled from a hand run; repeat it after a native-affecting
change:

1. Build the card: `pnpm native:build`.
2. Load `examples/lynx-for-native/dist/main.lynx.bundle` in Lynx Explorer or on a
   device, as described in [building.md](building.md).
3. Copy the `[solid-lynx parity]` report from the console or from
   `adb logcat` (it is logged on one line).
4. For each operation, write the `status` and, when it is not `pass`, the
   `observed` value and the harness `note`.
5. Replace any result that changed, and turn a `fail` into a defect report
   rather than a note.

An `unsupported` operation is only a difference to record if the renderer needs
it. Everything in the first table is something `src/lynx-host.ts` calls, so an
`unsupported` row there is a real gap; `Portal` and `Dynamic` are the known
exception, since this package does not export them yet.