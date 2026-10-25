# Native and web parity checklist

The renderer only speaks the Element PAPI, so parity between hosts is a
statement about PAPI behaviour rather than about Solid features. This checklist
records, per operation, what the web host and a measured native host do.

`runElementPapiParity()` from `solid-lynx/parity` produces the rows below. The web
column is filled automatically by the "reports shared Element PAPI parity for the
web host" test in `test/browser/lynx-for-web.test.ts`, which runs the harness
inside a live `<lynx-view>` and asserts every row. The native card logs the same
report on the device. **The native column is `reported`, not reproduced**: a hand
run reported it, but the capture that carried it is gone, so nothing here can be
re-checked from an artifact. See "How a run is recorded now" and
"Native column: reported, not reproduced" below.

## How a run is recorded now

A native result is a **capture plus a verdict**, not a paragraph. The card logs
one line, `[solid-lynx parity] {...}`, and `scripts/verify-native-parity.mjs`
turns that line into an exit code:

```bash
pnpm build                     # the verifier reads dist/parity.js
examples/lynx-for-native/scripts/run-native-probe.sh smoke
node scripts/verify-native-parity.mjs /tmp/solid-lynx-logs/lynx_console-smoke-<stamp>.log
```

Then, before citing the run anywhere:

1. **Move the capture out of `/tmp`.** A log left in a temporary directory is the
   reason the 2026-10-09 result cannot be re-checked — `/tmp` does not survive a
   reboot, and nothing copied it. The durable place is
   `docs/evidence/native/<date-or-id>/`: commit the capture there with a
   `manifest.json` beside it. The contract is
   [evidence/native/README.md](evidence/native/README.md) and the fields are in
   `docs/evidence/native/TEMPLATE/manifest.json`. Nothing is stored there yet,
   because no capture has survived.
2. **Record the verifier's exit code and its verdict line** next to the capture,
   in that manifest. `0` is the only code that may be cited as a pass.
3. **Keep them together.** A verdict without the capture it came from is a claim,
   not evidence, and a capture without a verdict asks the next reader to do the
   comparison by eye again.

Once the run is stored, the requirement is machine-checked rather than trusted:

```bash
node scripts/require-native-evidence.mjs --range <base>..HEAD
```

That script is the `native-evidence` CI job. It fails a pull request that changes
native-facing code and carries no capture the verifier accepts and no recorded
`decision.json` or `pending.json`; it re-runs the verifier against the stored
bytes, so the manifest's verdict is checked against the capture beside it rather
than taken on faith. Exit 0 satisfied, 1 missing evidence, 2 could not evaluate,
and 3 **pending, not a pass** — the code a `pending.json` returns, because a run
that has not happened is not a result.

The verifier is the same three checks a reviewer made by eye, in a process:

| Check | Failure it catches |
| --- | --- |
| Extract every `[solid-lynx parity]` line and parse the JSON | A capture that never logged, or a line the console bridge truncated |
| Compare operations against `parityOperationIds` from `dist/parity.js` | A partial report, or a capture from a different revision of the package |
| Reject anything not `pass`, or `unsupported` with a reason | A failing host capability, or an "unsupported" with nothing recorded as the reason |

Exit codes follow the same discipline as dagr: **0** verified, **1** findings,
**2** could not evaluate. `2` covers an unreadable file, a capture with no parity
line, JSON that does not parse, and a missing `dist/` (the message then says to
run `pnpm build`). A `2` is never a pass and must not be cited as one — "the log
was empty" and "the run passed" are different results, and an empty capture
cannot be read as a measurement. `--help` documents all of this, and
`test/native-parity-verify.test.ts` asserts each code against a capture fixture.

This page is about the smoke card. The stylesheet and list cards log one line
per stage instead of one report, and they are read by a sibling checker,
`scripts/verify-native-probe.mjs`, with the same three exit codes; a stored
manifest's `card` decides which verifier runs. See
[capabilities.md](capabilities.md) "The native stylesheet probe" and
"List virtualization" for the stage sets each capture must carry.

## Native column: reported, not reproduced

The history, in full, because the distinction is the point:

- **2026-10-09, Galaxy A03 (`R9WT911JVVH`, SM-A037U, Android 13).** Lynx Explorer
  4.1.0 (`com.lynx.explorer`, engine 3.5) loaded
  `examples/lynx-for-native/dist/main.lynx.bundle`. The card rendered, a `bindtap`
  incremented the counter, and the `[solid-lynx parity]` line reported all twenty
  shared operations as `pass`.
- **The capture is gone.** The log was written to `/tmp` and was never copied
  out; that directory did not survive. No file in this tree contains the report,
  the `observed` values, or the summary counters that run produced.
- **What survives is prose**: the per-operation rows below, the notes further
  down, and [building.md](building.md) "What a native run confirmed" — all
  written from that run by the person who watched it. Prose is a report of a
  measurement, not the measurement.
- **Therefore: reported, not reproduced.** The rows below are what the run
  reported. They are not a re-runnable result, and no test or CI job can confirm
  them at this commit. A release may say the A03 smoke *reported* twenty passing
  operations on 2026-10-09; it may not say the twenty operations *pass* on native
  as a present-tense property of this commit, because nothing in this tree can
  show that.

**No verifier-verified native capture exists in this repository at this commit.**
The verifier makes the next run recordable, and `scripts/require-native-evidence.mjs`
now makes a missing record fail a pull request that touches native-facing code;
neither manufactures the run that is missing, and this document does not pretend
otherwise. The honest status of every native cell below is `reported`.

`docs/evidence/native/` therefore holds its README, a capture-less `TEMPLATE/`,
and one directory of pending records
(`2026-10-25-1.0.0-pending/pending.json`), which state that the runs are
blocked on an unattached A03 rather than that they happened. The gate exits 3
for that range — pending, not a pass. A native-facing change that carries no
record at all is still red (exit 1) until someone attaches the A03 and runs the
card, or records why they cannot — which is the mechanism working, not a bug.

## Status values

| Value | Meaning |
| --- | --- |
| `pass` | The operation ran and matched the expected result, **and the capture that shows it is recorded.** |
| `reported` | A hand run reported `pass`, but the capture is not available, so it cannot be re-checked. Used only in the native column, where the 2026-10-09 log is lost. |
| `fail` | The operation ran and did not match; it carries an `observed` value. |
| `unsupported` | The host does not implement the PAPI at all. It carries the reason; the verifier rejects an `unsupported` row with no reason. |
| not measured | Not run against that host in this repository. |

`reported` is a temporary value, not a target state. A native cell returns to
`pass` only when a capture of that run is recorded and
`scripts/verify-native-parity.mjs` exits 0 against it.

## Shared Element PAPI operations

| Operation | Element PAPI | Expected | Web (`@lynx-js/web-core`) | Native (device) |
| --- | --- | --- | --- | --- |
| `page` | __CreatePage | page | pass | reported |
| `sandbox` | __CreateView, __AppendElement | attached | pass | reported |
| `element-unique-id` | __GetElementUniqueID | unique id >= 0 | pass | reported |
| `create-element` | __CreateView, __CreateElement | view | pass | reported |
| `create-raw-text` | __CreateRawText, __GetAttributeByName | parity | pass | reported |
| `append` | __CreateElement, __AppendElement, __GetChildren | 2 children | pass | reported |
| `insert-before` | __CreateElement, __InsertElementBefore, __GetChildren | inserted | pass | reported |
| `remove` | __RemoveElement, __GetChildren | removed | pass | reported |
| `traverse` | __FirstElement, __NextElement, __GetParent | first, next, parent | pass | reported |
| `set-attribute` | __SetAttribute, __GetAttributeByName | attribute | pass | reported |
| `attribute-names` | __SetAttribute, __GetAttributeNames | listed | pass | reported |
| `classes` | __SetClasses, __GetClasses | alpha,beta | pass | reported |
| `inline-styles` | __SetInlineStyles | style set | pass | reported |
| `dataset` | __GetDataset | dataset | pass | reported |
| `id` | __SetID, __GetID | parity-id | pass | reported |
| `event-listener` | - | listener API present | pass | reported |
| `flush` | __FlushElementTree | flushed | pass | reported |
| `renderer-mount` | __CreateView, __CreateRawText | mounted | pass | reported |
| `renderer-text-update` | __SetAttribute, __GetAttributeByName | updated | pass | reported |
| `renderer-dispose` | __RemoveElement, __GetChildren | released | pass | reported |

The fake PAPI in `test/parity.test.ts` passes all twenty operations too, which
is what makes a native `fail` attributable to the host rather than to the
renderer. That claim is checkable: `pnpm test` runs it on every commit.

## How to re-verify

The native column is re-established, not read. Run all five commands; the last
one is the one that turns a capture into evidence.

```bash
# 1. Build the package. The verifier imports parityOperationIds from dist/,
#    and exits 2 with "dist/parity.js is missing" if this is skipped.
pnpm build

# 2. Build the native card.
pnpm native:build

# 3. Run the smoke card on the A03. This pins the serial, serves the bundle on
#    loopback, opens it in Explorer, and writes the logcat capture, the
#    screenshot, and the [solid-lynx parity] lines into /tmp/solid-lynx-logs.
#    It exits 5 if no parity line was captured, and 3 if the A03 is not attached.
examples/lynx-for-native/scripts/run-native-probe.sh smoke

# 4. Verify the capture. Do not do this by eye.
node scripts/verify-native-parity.mjs /tmp/solid-lynx-logs/lynx_console-smoke-<stamp>.log

# 5. Keep the evidence where the requirement looks for it: a directory per run
#    holding the capture and a manifest.json. See docs/evidence/native/README.md
#    and copy docs/evidence/native/TEMPLATE/manifest.json.
#    Nothing is stored there yet; the template directory holds no capture.
mkdir -p docs/evidence/native/$(date +%F)-smoke
cp /tmp/solid-lynx-logs/lynx_console-smoke-<stamp>.log \
   docs/evidence/native/$(date +%F)-smoke/capture.log
node scripts/verify-native-parity.mjs \
  docs/evidence/native/$(date +%F)-smoke/capture.log

# 6. Commit the capture with the manifest, then check the requirement itself.
node scripts/require-native-evidence.mjs --range <base>..HEAD
```

How to read the result:

- **Exit 0** — every operation in the capture passes, or is unsupported with a
  recorded reason. Change the native cells above from `reported` to `pass`,
  record the capture path and the date beside this document, and state the
  Explorer version and device serial the run used.
- **Exit 1** — the capture was read and has findings (a `fail`, a missing or
  unrecognised operation, an `unsupported` with no reason, or a summary that
  disagrees with its own rows). Record the findings and turn a `fail` into a
  defect report rather than a note.
- **Exit 2** — nothing was evaluated. The run is not a result: fix the capture
  (or run `pnpm build`) and verify again. Do not record anything from it.

An `unsupported` operation is only a difference to record if the renderer needs
it. Everything in the first table is something `src/lynx-host.ts` calls, so an
`unsupported` row there is a real gap; `Portal` and `Dynamic` are the known
exception, since this package does not export them yet.

## Runtime behaviour

These need a running card on each host, so they are checked separately from the
PAPI probes. The native cells below carry the same evidence problem as the table
above: `reported` means the 2026-10-09 run reported it and no capture survives.

| Behaviour | Web (`@lynx-js/web-core`) | Native (device) | How to check |
| --- | --- | --- | --- |
| Initial render and text mount | verified | reported | Open the card; `#parity-count` reads `Native parity count: 0`. |
| Reactive text update | verified | reported | Tap `#parity-increment`; the count increases to 1. |
| Tap dispatch through `bindtap` | verified | reported | Tap `#parity-increment`; the count increases and no renderer error is logged. |
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

The three `reported` rows are what the smoke run described; `docs/release.md` §3
explains why they cannot be cited as a present pass until a capture is recorded.

## Notes recorded during the native run

These come from the 2026-10-09 hand run and describe the host, not this commit.
They are useful context for the next run, and none of them is a substitute for a
capture:

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
  all is the "Runtime behaviour" table above.

The native device run also shows a `processData is not a function` banner from
Explorer's LogBox: with `background: false` the bundle's `/app-service.js` is
intentionally empty, and the shell still invokes `processData` on it. It does not
affect loading, rendering, or tap dispatch.
