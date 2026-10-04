# Native and web parity checklist

The renderer only speaks the Element PAPI, so parity between hosts is a
statement about PAPI behaviour rather than about Solid features. This checklist
records, per operation, what the web host does today and what a native host has
to be measured against.

`runElementPapiParity()` from `solid-lynx/parity` produces the rows below. The web
column is filled automatically by the "reports shared Element PAPI parity for the
web host" test in `test/browser/lynx-for-web.test.ts`, which runs the harness
inside a live `<lynx-view>`. The native column is filled by hand from the report
`examples/lynx-for-native` prints, which needs Lynx Explorer or a device. See
[building.md](building.md) for how to run it.

Status values: `pass` matches the expected result, `fail` does not and carries an
`observed` value, `unsupported` means the host does not implement the PAPI at
all.

## Shared Element PAPI operations

| Operation | Element PAPI | Expected | Web (`@lynx-js/web-core`) | Native (device) |
| --- | --- | --- | --- | --- |
| `page` | __CreatePage | page | pass | not measured |
| `sandbox` | __CreateView, __AppendElement | attached | pass | not measured |
| `element-unique-id` | __GetElementUniqueID | unique id >= 0 | pass | not measured |
| `create-element` | __CreateView, __CreateElement | view | pass | not measured |
| `create-raw-text` | __CreateRawText, __GetAttributeByName | parity | pass | not measured |
| `append` | __CreateElement, __AppendElement, __GetChildren | 2 children | pass | not measured |
| `insert-before` | __CreateElement, __InsertElementBefore, __GetChildren | inserted | pass | not measured |
| `remove` | __RemoveElement, __GetChildren | removed | pass | not measured |
| `traverse` | __FirstElement, __NextElement, __GetParent | first, next, parent | pass | not measured |
| `set-attribute` | __SetAttribute, __GetAttributeByName | attribute | pass | not measured |
| `attribute-names` | __SetAttribute, __GetAttributeNames | listed | pass | not measured |
| `classes` | __SetClasses, __GetClasses | alpha,beta | pass | not measured |
| `inline-styles` | __SetInlineStyles | style set | pass | not measured |
| `dataset` | __GetDataset | dataset | pass | not measured |
| `id` | __SetID, __GetID | parity-id | pass | not measured |
| `event-listener` | - | listener API present | pass | not measured |
| `flush` | __FlushElementTree | flushed | pass | not measured |
| `renderer-mount` | __CreateView, __CreateRawText | mounted | pass | not measured |
| `renderer-text-update` | __SetAttribute, __GetAttributeByName | updated | pass | not measured |
| `renderer-dispose` | __RemoveElement, __GetChildren | released | pass | not measured |

The fake PAPI in `test/parity.test.ts` passes all twenty operations too, which
is what makes a native `fail` attributable to the host rather than to the
renderer.

Notes to record during a native run:

- `page`: a native host may not expose `__CreatePage`. The harness then needs the
  card's root element passed as `page`; `examples/lynx-for-native` documents how
  it resolves one.
- `inline-styles`: the harness only checks that a style can be written and read
  back. Style *computation* on a device, including `__GetComputedStyleByKey`, is
  a separate question this row does not answer.
- `dataset`: hosts spell dataset writes `__AddDataset` or `__SetDataset`; both are
  accepted, and the row records which one the host has.
- `event-listener`: presence only. Whether a handler is delivered at all is the
  runtime table below.

## Runtime behaviour

These need a running card on each host, so they are checked separately from the
PAPI probes.

| Behaviour | Web (`@lynx-js/web-core`) | Native (device) | How to check |
| --- | --- | --- | --- |
| Initial render and text mount | verified | not measured | Open the card; `#parity-count` must read `Native parity count: 0`. |
| Reactive text update | verified | not measured | Tap `#parity-increment`; the count must increase. |
| Tap dispatch through `bindtap` | verified | not measured | Tap `#parity-increment`; no error may be logged. |
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

## How to fill the native column

1. Build the card: `pnpm native:build`.
2. Load `examples/lynx-for-native/dist/main.lynx.bundle` in Lynx Explorer or on a
   device, as described in [building.md](building.md).
3. Copy the `[solid-lynx parity]` report from the console.
4. For each operation, write the `status` and, when it is not `pass`, the
   `observed` value and the harness `note`.
5. Replace every `not measured` above with the result, and turn a `fail` into a
   defect report rather than a note.

An `unsupported` operation is only a difference to record if the renderer needs
it. Everything in the first table is something `src/lynx-host.ts` calls, so an
`unsupported` row there is a real gap; `Portal` and `Dynamic` are the known
exception, since this package does not export them yet.