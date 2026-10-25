# Native and web parity checklist

The renderer only speaks the Element PAPI, so parity between hosts is a
statement about PAPI behaviour rather than about Solid features. This checklist
records, per operation, what the web host and a measured native host do.

`runElementPapiParity()` from `solid-lynx/parity` produces the rows below. The web
column is filled automatically by the "reports shared Element PAPI parity for the
web host" test in `test/browser/lynx-for-web.test.ts`, which runs the harness
inside a live `<lynx-view>` and asserts every row. The native card logs the same
report on the host.

**The native column is a measurement, taken on a running Android emulator and
kept as a capture**: AVD `lynx33`, Android 13 / API 33, ABI `x86_64`, serial
`emulator-5554`, running Lynx Explorer **4.1.0** — the same build, APK SHA-256
`6ae29787a2166974c29c2f23d87f3b20a137abcf9a8c17903ad19f3fb7f00cb6`, that the A03
install documents. The capture is
`docs/evidence/native/2026-10-25-emulator-api33-smoke/capture.log` with a
`manifest.json` beside it, and its verifier exits 0. That is a different runtime
from the tablet: see "Measured on the emulator, and what it does not say" below,
and "The 2026-10-09 A03 run, still not reproduced" for the hand run whose capture
was lost.

An emulator is not a phone. The Element PAPI and the engine are the same code as
the documented A03 install; the silicon, the device image, and the input path are
not. Nothing in the native column below is a claim about GPU behaviour, touch
latency, memory pressure, or a physical-device quirk.

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
   reason the 2026-10-09 A03 result cannot be re-checked — `/tmp` does not survive
   a reboot, and nothing copied it. The durable place is
   `docs/evidence/native/<date-or-id>/`: commit the capture there with a
   `manifest.json` beside it. The contract is
   [evidence/native/README.md](evidence/native/README.md) and the fields are in
   `docs/evidence/native/TEMPLATE/manifest.json`. Three such directories exist
   now, one per card, all from the 2026-10-25 emulator run, plus a fourth holding
   the v2 stylesheet capture with no manifest (see "Where the evidence lives"
   below). The A03 hand run's own capture still does not exist, and this page does
   not pretend it does.
2. **Record the verifier's exit code and its verdict line** next to the capture,
   in that manifest. `0` is the only code that may be cited as a pass.
3. **Keep them together.** A verdict without the capture it came from is a claim,
   not evidence, and a capture without a verdict asks the next reader to do the
   comparison by eye again.

Once the run is stored, the requirement is machine-checked rather than trusted:

```bash
node scripts/require-native-evidence.mjs --range <base>..HEAD
```

That script is wired into the `native-evidence` CI job (which has not itself run on
GitHub Actions yet). It fails a pull request that changes
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
"List virtualization" for the stage sets each capture must carry. The v2
stylesheet card is a fourth case: its capture is read by the same probe checker
under a `[solid-lynx ss2]` marker, but the stored copy has no manifest, so it is
not a record.

## Measured on the emulator, and what it does not say

The 2026-10-25 run is stored, verifier-checked evidence. It is **one runtime**, and
saying which one is part of the claim:

| Field | Value |
| --- | --- |
| Runtime | Android emulator, AVD `lynx33`, serial `emulator-5554` |
| Android | 13 / **API 33** |
| ABI | **`x86_64`** |
| App | Lynx Explorer **4.1.0** (`com.lynx.explorer`), engine 3.5 |
| APK | SHA-256 `6ae29787a2166974c29c2f23d87f3b20a137abcf9a8c17903ad19f3fb7f00cb6` |
| Capture | `docs/evidence/native/2026-10-25-emulator-api33-smoke/capture.log` |
| Verdict | `verify-native-parity.mjs` exit 0 — 20 operations pass across 1 report |
| Commit | `71c7cb4` (the manifest's own `commit` field) |

The APK digest is the same one recorded for the A03 in
[compatibility.md](compatibility.md) §4, so the Element PAPI and the engine are
the same code. **That is the whole of what transfers.** An emulator does not
prove:

- **GPU behaviour.** The render surface is a software/emulated GL path on the
  host CPU, so rendering cost, frame pacing, and any GPU-specific rendering path
  are unmeasured by this run.
- **Touch latency.** The capture contains **no tap at all** — the parity harness
  drives element operations and one reactive text update, and nothing in the run
  injects a touch. So the digitizer, the engine's touch pipeline, and the latency a
  user would feel are not exercised here in any form. The only tap evidence in
  this tree is the 2026-10-09 A03 prose.
- **Memory pressure.** An emulator on a development machine has host RAM behind
  it; low-memory behaviour, process death, and cold-start-under-pressure are
  unmeasured.
- **Physical-device quirks.** Vendor Android builds, thermals, `arm64-v8a`
  execution, and device-specific Explorer packaging are all outside this run. The
  A03 is `arm64-v8a`; this emulator is `x86_64`.

So the native column below is `pass` **as measured on that emulator**, and the A03
rows remain `reported`. A reader who needs physical-device parity has the same
gap as before this run; a reader who needs the Element PAPI and engine behaviour
no longer does.

## The 2026-10-09 A03 run, still not reproduced

Kept as its own historical note, because the emulator run does not contain it.
This is a **different runtime and a different result record**:

- **2026-10-09, Galaxy A03 (`R9WT911JVVH`, SM-A037U, Android 13, `arm64-v8a`).**
  Lynx Explorer 4.1.0 (`com.lynx.explorer`, engine 3.5) loaded
  `examples/lynx-for-native/dist/main.lynx.bundle`. The card rendered, a `bindtap`
  incremented the counter, and the `[solid-lynx parity]` line reported all twenty
  shared operations as `pass`.
- **The A03 capture is gone.** The log was written to `/tmp` and was never copied
  out; that directory did not survive. No file in this tree contains that run's
  report, `observed` values, or summary counters.
- **What survives from that run is prose**: the notes further down this page and
  [building.md](building.md) "What a native run confirmed" — written from the run
  by the person who watched it. Prose is a report of a measurement, not the
  measurement. **The emulator capture does not turn the A03 report into a
  reproduced result**: it is the same engine on different silicon, so it makes
  the engine's behaviour re-checkable and leaves the A03's own record exactly
  where it was.
- **Therefore the A03 rows stay `reported`.** Nothing in this tree can re-run the
  2026-10-09 A03 result, and no test or CI job can confirm it at this commit. A
  release may say the A03 smoke *reported* twenty passing operations on
  2026-10-09; it may not say that run is reproduced.

## Where the evidence lives

`docs/evidence/native/` holds its README, a capture-less `TEMPLATE/`, and four
run directories from 2026-10-25:

| Directory | Card | Record |
| --- | --- | --- |
| `2026-10-25-emulator-api33-smoke/` | `smoke` | capture + `manifest.json`, verifier exit 0 |
| `2026-10-25-emulator-api33-stylesheet/` | `stylesheet` (v1) | capture + `manifest.json`, verifier exit 0 |
| `2026-10-25-emulator-api33-list/` | `list` | capture + `manifest.json`, verifier exit 0 |
| `2026-10-25-emulator-api33-stylesheet-v2/` | `stylesheet2` (v2) | **capture only, no manifest** — supporting bytes, not a record |

The v2 directory has no manifest, so the gate does not count it as evidence and
neither does this page: it is quoted for what it measured (see
[capabilities.md](capabilities.md) "The second native stylesheet probe (v2)"),
and it is not a record that anything was verified. The earlier pending record set
that stood for these cards was deleted in `85ddd12` once the captures existed;
the A03 half of what it said is recorded above and in
[capabilities.md](capabilities.md).

There is still no A03 capture and no physical-device run for this range, so a
native-facing change that needs a *tablet* run still needs one. Nothing about
this page makes the gate green for a range the emulator captures do not cover.

## Status values

| Value | Meaning |
| --- | --- |
| `pass` | The operation ran and matched the expected result, **and the capture that shows it is recorded.** |
| `reported` | A hand run reported `pass`, but the capture is not available, so it cannot be re-checked. Used only for the 2026-10-09 A03 run, whose log is lost. |
| `fail` | The operation ran and did not match; it carries an `observed` value. |
| `unsupported` | The host does not implement the PAPI at all. It carries the reason; the verifier rejects an `unsupported` row with no reason. |
| not measured | Not run against that host in this repository. |

`reported` is a temporary value, not a target state, and it now applies to one
runtime rather than to "native" as a whole: the emulator's own twenty rows are
`pass` because a capture backs them. An A03 cell returns to `pass` only when a
capture of that run is recorded and `scripts/verify-native-parity.mjs` exits 0
against it.

## Shared Element PAPI operations

| Operation | Element PAPI | Expected | Web (`@lynx-js/web-core`) | Native (emulator API 33 `x86_64`, Explorer 4.1.0) |
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
renderer. That claim is checkable: `pnpm test` runs it on every commit.

## How to re-verify

The native column is re-established, not read. Run all six commands; the last
one is the one that turns a capture into evidence.

```bash
# 1. Build the package. The verifier imports parityOperationIds from dist/,
#    and exits 2 with "dist/parity.js is missing" if this is skipped.
pnpm build

# 2. Build the native card.
pnpm native:build

# 3. Run the smoke card. The runner pins a serial, serves the bundle on
#    loopback, opens it in Explorer, and writes the logcat capture, the
#    screenshot, and the [solid-lynx parity] lines into /tmp/solid-lynx-logs.
#    It exits 5 if no parity line was captured, and 3 if its pinned device is
#    not attached. As written it is pinned to the A03 (R9WT911JVVH); the stored
#    2026-10-25 captures were taken by opening the same bundle in Explorer on an
#    API 33 x86_64 emulator (emulator-5554) instead, which is why their
#    manifests name that serial and runtime.
examples/lynx-for-native/scripts/run-native-probe.sh smoke

# 4. Verify the capture. Do not do this by eye.
node scripts/verify-native-parity.mjs /tmp/solid-lynx-logs/lynx_console-smoke-<stamp>.log

# 5. Keep the evidence where the requirement looks for it: a directory per run
#    holding the capture and a manifest.json. See docs/evidence/native/README.md
#    and copy docs/evidence/native/TEMPLATE/manifest.json. The manifest is where
#    the runtime is named: `device.serial`, plus `runtime` for a non-A03 run.
#    Three such directories already exist for the 2026-10-25 emulator run; a new
#    run needs its own, it does not overwrite theirs.
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
  recorded reason. Change the cells for **that runtime** to `pass`, record the
  capture path, the date, the Android API level, the ABI, the Explorer version
  and the serial beside this document, and do not touch the rows for a runtime
  the capture does not cover. The 2026-10-25 emulator run is recorded this way;
  the A03 rows are not.
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
PAPI probes. The two columns are different runtimes and carry different evidence:
`emulator measured` means the 2026-10-25 capture named above contains the
operation, `reported` means only the 2026-10-09 A03 hand run did and its capture
is lost.

Read the first two rows carefully: what the capture measures is the parity
harness's own root, which mounts a view and updates a reactive text through
`renderer-mount` and `renderer-text-update`. It does **not** measure the card's
`#parity-count` element, and the capture contains **no tap at all** — so the tap
row stays `reported`, however much one would like the emulator run to carry it.

| Behaviour | Web (`@lynx-js/web-core`) | Native | How to check |
| --- | --- | --- | --- |
| Initial render and text mount | verified | emulator measured (`renderer-mount`, harness root) | Open the card; `#parity-count` reads `Native parity count: 0`. |
| Reactive text update | verified | emulator measured (`renderer-text-update`, harness root) | The harness sets its text to `updated` and reads it back; a tap raises the card's own count. |
| Tap dispatch through `bindtap` | verified | reported (A03, 2026-10-09; no tap in the emulator capture) | Tap `#parity-increment`; the count increases and no renderer error is logged. |
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
| Stylesheet loading and CSS ids | CSS ids verified; stylesheet loading has no PAPI | load measured, lifecycle not measured | `root.setCSSId()` and watch `__SetCSSId` calls; for the stylesheet half see [capabilities.md](capabilities.md) "Stylesheet loading and lifecycle". |

The single `reported` row is what the A03 smoke run described and the emulator
capture does not contain; `docs/release.md` §3 explains why it cannot be cited as
a present pass until an A03 capture is recorded. `renderer-dispose` passing on the
emulator is **not** native cleanup after a root `dispose()` in the A03 sense — its
`observed` value is `released`, which means the nodes the harness's own root
rendered were gone from its sandbox; `docs/contract.md` §9 "Native disposal"
remains the statement of what native cleanup has not been measured for.

## Notes recorded during the A03 run, and what the emulator added

The first block comes from the 2026-10-09 A03 hand run and describes that host,
not this commit; it is kept because it is the only record of how the card was
made to work on the tablet, and **the emulator capture does not replace it**. The
second block is what the 2026-10-25 emulator capture independently shows.

From the 2026-10-09 A03 run (prose only, capture lost):

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
affect loading, rendering, or tap dispatch. The 2026-10-25 emulator capture
carries the same banner and the same non-effect.

What the emulator capture shows on its own, checkable from the stored bytes:

- `typeof` `"unknown"` for a native handle is reproduced: the list card's
  `create` stage records `returnedHandle: true` with `handleTypeof: "unknown"`,
  and the parity rows using elements all pass, so `isLynxNode()` accepting those
  handles is measured on this engine rather than inferred from the A03 note.
- `inline-styles` passes with `observed: "style set"`, read back through
  `__GetInlineStyles` as the note above describes.
- Every one of the twenty rows carries an `observed` value in the capture
  (`page`, `attached`, `unique id >= 0`, `2 children`, `dataset`, `parity-id`, …),
  so the table above is a stored result and not a recollection.
