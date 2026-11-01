# Native stylesheet probe v3 — API 33 `x86_64` emulator, 2026-11-01

One record, two supporting files. `manifest.json` names `capture.log`, which is the
run that reached `done` and that `scripts/verify-native-probe.mjs` verifies (exit
0). The other two are the bytes behind the one call the committed card does not
make; they are **not** records and the evidence gate does not read them.

| File | What it is |
| --- | --- |
| `capture.log` | The stored capture. Real logcat framing, 13 `[solid-lynx ss3]` lines: the ten required stages plus three `offer-start` lines that name each binding before it is offered a value. Verified with exit 0. |
| `probe-getter-returned.log` | Supporting bytes. A probe build that included the `__GetComputedStyleByKey(value, "color")` offer, in the only run where that call returned instead of killing the process. |
| `crash-getter-offer.log` | Supporting bytes. A probe run that died with `SIGSEGV` inside `liblynx` immediately after `offer-start` named `__GetComputedStyleByKey`. Trimmed to the card's lines and the debugger header. |

## How the run was made

Built with `pnpm native:build`, served from `examples/lynx-for-native/dist` with
`python3 -m http.server 8099 --bind 127.0.0.1`, port reversed with
`adb -s emulator-5554 reverse tcp:8099 tcp:8099`, and opened through Explorer's
deep link:

```
adb -s emulator-5554 shell am start -a android.intent.action.VIEW \
  -d 'lynx://open?url=http://127.0.0.1:8099/stylesheet-probe-v3.lynx.bundle?v=emu-ss3-final-<stamp>'
adb -s emulator-5554 logcat -d > capture.log
```

AVD `lynx33`, Android 13 / API 33, `x86_64`, Lynx Explorer 4.1.0
(`sha256 6ae29787a2166974c29c2f23d87f3b20a137abcf9a8c17903ad19f3fb7f00cb6`). The
emulator's `versionName` reads `1.0`; that is the manifest label, not the release
identity.

## What this run measured

The card asks one question — does this host ever hand a JavaScript caller an
opaque handle? — and the answer is **yes, through `__CreateStyleObject`**, which
is not where a stylesheet lifecycle would start.

- `__CreateStyleObject`: five of eight argument shapes returned a value, three
  threw by type (`param size should >= 1` for no arguments; `param 0 should be
  Object` for a string and a number). Every returned value is the same kind of
  thing: `typeof` reports `"unknown"`, `Object.prototype.toString` calls it
  `[object Object]`, its prototype tag is `[object Null]`, it has no readable own
  property names, and it is not the argument it was given.
- `__AdoptStyleSheet(value)` **returned** (null). `[null]` and `[[value]]` threw
  `AdoptStyleSheet param 0 should be RefCounted`; `[]` threw
  `param size should >= 1`. So the value is a `RefCounted` object and an array is
  not — the type check is real, and it accepts this value.
- `__SetStyleObject(value, <parsed style map>)` **returned** (null); the
  one-argument call threw `param size should >= 2`.
- `__SetParsedStyles(value)` threw `FiberSetParsedStyles param size should >= 2`
  and `__UpdateStyleObject(value)` threw
  `UpdateStyleObject param size should >= 2`; neither was measured with two
  arguments.
- `__LoadStyleSheet`: `[url, "utf-8"]`, `[url, url2]` and
  `[url, "utf-8", value]` all returned `null`; `[url, value]` threw
  `param 1 should be String`. A load ignores a third argument and hands back no
  handle.
- `__ReplaceStyleSheets` returned `null` for all five shapes, including
  `[[value]]` and `[value]`.
- `__GetComputedStyleByKey(value, "color")` returned `""` in the supporting probe
  run, and killed Explorer in four other runs of the same build. That is why the
  committed card does not make that call: a stored capture has to come from a run
  that reached `done`.
- No style-named global carries a release, destroy, free, unload, remove,
  dispose, delete or cleanup verb, so there is no cleanup call this card could
  make.

What is **not** measured, and is named in the card's own `summary.unmeasured`:
whether a loaded stylesheet's rules are applied, and whether anything can be
cleaned up. A load returns `null`, so a *loaded* sheet still cannot be adopted,
replaced or removed; the handle that exists is the one `__CreateStyleObject`
makes.