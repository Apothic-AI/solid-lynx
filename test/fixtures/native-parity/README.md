# Native parity capture fixtures

Captures for the host-free tests of
[`scripts/verify-native-parity.mjs`](../../../scripts/verify-native-parity.mjs).
Two shapes live here, and the difference between them is the point of the
directory.

**`real-format-smoke.log` carries the shape a device actually writes.** It is
`smoke.log` trimmed to its one report line plus three surrounding logcat lines,
copied byte for byte — no reformatting, no re-wrapping. Nothing else here has
that shape.

## What a real capture looks like

Lynx Explorer writes `console.log` through the native console bridge, which
emits one logcat line per message, wraps the message in double quotes, and names
the thread that logged it in front of the message:

```
10-25 08:41:39.887  5650  5685 I lynx    : [715D09544CF0:INFO:lynx_console.cc(230)] "[main-thread.js] [solid-lynx parity] {"label":"native",...}"
|____________ logcat columns _____________________|   |__ thread tag __| |_____ marker ____|  |____ JSON ____| |
                                                      ^                                                  ^      ^
                                                      bridge's opening quote                             payload bridge's closing quote
```

So a real line is **logcat columns, an opening `"`, a `[main-thread.js] ` or
`[background.js] ` prefix, the card's message, the marker, the JSON, and a
closing `"`**. There are no backslash-escaped quotes inside that JSON: the bridge
does not re-encode the payload, which is why the closing quote is the last
character on the line.

The verifier reads the payload as the span from the first `{` after the marker to
the last `}` on the line; everything outside is framing. Truncation is decided by
scanning that span for an unbalanced brace or an unterminated string, not by
whether the line ends with `}` — every real capture ends with the bridge's closing
quote, so the naive test called complete captures truncated, which is how this
blind spot survived until real captures were first tried.

## The synthetic fixtures

The rest of the files here were written by hand with a **bare** marker and JSON,
no wrapping quotes and no thread tag. That is a fixture shape, not a capture
shape, and they are kept as they are: they document the older shape and they
still verify, because the extraction rule treats the wrapper as optional framing.
A file shaped like them is not something to store in `docs/evidence/native/`.

**None of these are device evidence.** No device produced any of the synthetic
files, and no row derived from them may be recorded in `docs/parity-checklist.md`
as a native result. `real-format-smoke.log` reproduces a real device's framing,
but a fixture that reproduces framing is not a measurement either — the
`label` every one of these carries (`native`) is a string in a file.

| Fixture | Shape | Verifier exit | What it proves |
| --- | --- | --- | --- |
| `real-format-smoke.log` | real framing, `main-thread.js` | 0 | The bridge's wrapping quotes, logcat columns and thread tag are framing: the same report verifies through them as without them. |
| `good-capture.log` | bare | 0 | All twenty operations pass, and unrelated console lines around the report do not disturb extraction. |
| `unsupported-with-reason.log` | bare | 0 | An `unsupported` row that carries an `observed` reason is acceptable evidence, not a failure. |
| `missing-operation.log` | bare | 1 | A report missing `renderer-dispose` is a finding even though every row it does contain passes. |
| `not-passing.log` | bare | 1 | A `fail` row and an `unsupported` row with no reason are both findings. |
| `unparseable.log` | bare, cut mid-JSON | 2 | A truncated report line (the native console bridge dropped the tail) cannot be evaluated, which is not a pass. Its braces are unbalanced, so it is reported as truncation rather than as a parse failure. |
| `empty-capture.log` | bare | 2 | A capture that has console output but no parity line cannot be evaluated, which is not a pass. |
| `no-lines.log` | empty | 2 | A zero-byte log (the run wrote nothing) is also unevaluable, and must not be read as an empty pass. |

## What was trimmed

`real-format-smoke.log` holds four lines of `smoke.log`: the parity line (line
182), the two lines before it (one `closure_event_listener.cc` line and one
`event_target.cc` line), and the one line after it (an `element_manager.cc`
line). The rest of the capture — Android system chatter, `LynxTemplateRender`
trace, unrelated app logs — is not in the fixture. The kept lines are unmodified,
including the logcat timestamp, the pid and tid, and the bridge's quotes.

The rule, for anyone re-checking it: keep two lines before each marker line, the
marker line, and one line after it. Every kept line is byte-identical to its line
in `smoke.log`.
