# Native list-recycling probe — API 33 `x86_64` emulator, 2026-11-01

One record: `manifest.json` names `capture.log`, which is the run that reached
`done` and that `scripts/verify-native-probe.mjs` verifies (exit 0). It is the
list card's answer to the question its earlier capture left open.

## How the run was made

Built with `pnpm native:build`, served from `examples/lynx-for-native/dist` with
`python3 -m http.server 8099 --bind 127.0.0.1`, port reversed with
`adb -s emulator-5554 reverse tcp:8099 tcp:8099`, and opened through Explorer's
deep link:

```
adb -s emulator-5554 shell am start -a android.intent.action.VIEW \
  -d 'lynx://open?url=http://127.0.0.1:8099/list-recycle-probe.lynx.bundle?v=emu-lr-<stamp>'
adb -s emulator-5554 logcat -d > capture.log
```

AVD `lynx33`, Android 13 / API 33, `x86_64`, Lynx Explorer 4.1.0
(`sha256 6ae29787a2166974c29c2f23d87f3b20a137abcf9a8c17903ad19f3fb7f00cb6`). The
emulator's `versionName` reads `1.0`; that is the manifest label, not the release
identity.

## What it measured

The card renders forty rows of 100 px inside a 200 px viewport behind a sized
wrapper (4000 px of content in a 200 px viewport), materializes **all forty rows**
through the model, and makes four bounded `__InvokeUIMethod` attempts, each
recorded with the coordinate it names and whether that coordinate is inside the
content. The host's own `componentAtIndex` and `enqueueComponent` counters are
read around that scroll window.

- `__InvokeUIMethod` is exposed (`arity 0`). Every attempt returned, and the
  callback the card passed fired all four times, reporting codes `3`, `3`, `3`
  and `4`. The card records those codes and gives them no meaning. All four
  attempts are in range for the 4000 px content (`offset` 0 and 900 of a 3800 px
  maximum, `index`/`position` 20 of 40 rows).
- The host asked for **no cells at all**: `componentAtIndex: 0` through create,
  viewport and the scroll window, even with the viewport wrapper.
- It released **no cells**: `enqueueComponent: 0`, `hostRecycled: false`,
  `measuredZero: true`.
- Element identity survived a permuted model update: four rows moved, ids
  preserved, so the list is live while making no cell request.

**The answer is a measured zero, not an inability.** The capture's `reason` says
so in its own words, and the verifier requires that reason whenever the release
count is zero. A host that recycles has never been observed in this repository;
nothing here says this engine cannot.

## What is still unmeasured

Cell reuse timing, `operationId` and `enableReuseNotification` semantics, scroll
offsets (nothing reads one back, so a returned call is acceptance, not movement),
and \(__UpdateListComponents\)/\(__GetListComponents\) — both absent on this engine.
There is still no A03 list run of any kind.