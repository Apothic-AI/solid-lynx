# Native probe capture fixtures

Captures for the host-free tests of
[`scripts/verify-native-probe.mjs`](../../../scripts/verify-native-probe.mjs).
Two shapes live here, and the difference between them is the point of the
directory.

**`real-format-stylesheet.log` and `real-format-list.log` carry the shape a
device actually writes.** They are `stylesheet.log` and `list.log` trimmed to
their stage lines plus a couple of surrounding logcat lines each, copied byte for
byte — no reformatting, no re-wrapping. Nothing else here has that shape.

## What a real capture looks like

Lynx Explorer writes `console.log` through the native console bridge, which
emits one logcat line per message, wraps the message in double quotes, and names
the thread that logged it in front of the message:

```
10-25 08:41:42.002  5650  5685 I lynx    : [715D09544CF0:INFO:lynx_console.cc(230)] "[main-thread.js] [solid-lynx ss] {"probe":"native-stylesheet-papi",...}"
|____________ logcat columns _____________________|   |__ thread tag __| |_____ marker ___|  |________ JSON _______| |
                                                      ^                                                  ^            ^
                                                      bridge's opening quote                             payload      bridge's closing quote
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

Two rules follow for a capture that logs the same stage twice:

- A card can log from the main thread and from the background thread. Each line is
  one report, and the verifier labels it with its thread.
- A stage still has to appear exactly once. Two lines carrying the same stage is a
  `duplicate-stage` finding naming both threads and both line numbers — never one
  line silently accepted in place of the other.

## The synthetic fixtures

The rest of the files here were written by hand with a **bare** marker and JSON,
no wrapping quotes and no thread tag. That is a fixture shape, not a capture
shape, and they are kept as they are: they document the older shape and they
still verify, because the extraction rule treats the wrapper as optional framing.
A file shaped like them is not something to store in `docs/evidence/native/`.

**None of these are device evidence.** No device produced any of the synthetic
files, and no stage line derived from them may be recorded in
`docs/capabilities.md` as a native measurement. They exist so the verifier's
verdicts can be asserted without hardware. The `[solid-lynx ss]` / `[solid-lynx
lp]` prefixes and the JSON field names match what the cards emit — that is what
makes the assertions meaningful — but every synthetic value in them was written
by hand. The `real-format-*` files reproduce real framing and real values; that
makes them a faithful copy of a capture, not a measurement taken for this
repository.

| Fixture | Shape | Verifier exit | What it proves |
| --- | --- | --- | --- |
| `real-format-stylesheet.log` | real framing, `main-thread.js` | 1 | The bridge's framing is not the finding: six stages parse and are found, and the real device's own payload still reports what it reports. |
| `real-format-list.log` | real framing, `main-thread.js` | 1 | Same for the list card: seven stages parse and are found through the framing. |
| `stylesheet-good.log` | bare | 0 | All six stylesheet stages present, in order, with the missing-URL stage failing and the real-URL stage returning against a different stylesheet. |
| `stylesheet-missing-stage.log` | bare | 1 | A capture that stops before `load-real-url` is a finding even though every stage it holds is well formed. |
| `stylesheet-unparseable.log` | bare, cut mid-JSON | 2 | A `summary` line the console bridge cut short cannot be evaluated, which is not a pass. Its braces are unbalanced, so it is reported as truncation. |
| `list-recycles.log` | bare | 0 | Host asked for rows and called `enqueueComponent` twice: a complete recycling answer. |
| `list-never-recycled.log` | bare | 0 | Host never called `enqueueComponent`, recorded as `0`: a recorded zero is an answer, not a gap. |
| `list-no-answer.log` | bare | 1 | A capture whose `shrunk` and `summary` stages never say whether `enqueueComponent` ran: the question the card exists to answer is left open. |

The `real-format-*` fixtures exit **1**, not 0, and that is worth reading rather
than working around. The framing extraction was the only thing they were added to
reproduce; once the capture parses, the verifier reports what the real payload
says, and the real payloads disagree with two of the checker's checks. Those are
findings about the card and the device, not about framing — the same findings
appear when the identical JSON is re-run with no wrapper at all. Making the
fixtures pass by relaxing the checker would have deleted the evidence, so they
are recorded as they are and the findings stand.

Two things the fixtures deliberately do **not** carry:

- any `[solid-lynx parity]` line, so a probe capture is never mistaken for smoke
  evidence and `verify-native-parity.mjs` still exits 2 on these files;
- an arity that means anything. The `fn.length` values are placeholders, and the
  verifier only ever checks that a recorded arity is a number — a capture is not
  a signature, which is why there is no fixture that "proves" one.

## What was trimmed

The rule for both files: keep two lines before each stage line, the stage line, and
one line after it; drop everything else. Every kept line is byte-identical to its
line in the source capture.

**`real-format-stylesheet.log`** holds 21 lines of `stylesheet.log` (source lines
171–174, 188–191, 193–200, 201–205): the six stage lines — `inventory`,
`no-arguments`, `load-missing-url`, `load-real-url`, `summary`, `done` — with
their surrounding logcat lines.

**`real-format-list.log`** holds 28 lines of `list.log` (source lines 179–182,
184–187, 205–208, 220–223, 233–236, 241–248): the seven stage lines —
`inventory`, `create`, `materialize`, `reorder`, `shrunk`, `summary`, `done` —
with their surrounding logcat lines.

Dropped from both: Android system chatter, `LynxTemplateRender` and
`ActivityTaskManager` trace, and `LynxEventReporter` noise. The kept lines are
unmodified, including timestamps, pid and tid, field order, and the bridge's
quotes.
