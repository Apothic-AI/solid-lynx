# Native probe capture fixtures

Synthetic console captures for the host-free tests of
[`scripts/verify-native-probe.mjs`](../../../scripts/verify-native-probe.mjs).
They are shaped like the output of
`examples/lynx-for-native/scripts/run-native-probe.sh stylesheet`,
`... stylesheet2`, and `... list`: a few `lynx_console` lines, then one line per
card stage carrying `[solid-lynx ss] {...}`, `[solid-lynx ss2] {...}`, or
`[solid-lynx lp] {...}`, then the card's own output.

**These are not device evidence.** No device produced them, and no stage line
derived from them may be recorded in `docs/capabilities.md` as a native
measurement. They exist so the verifier's verdicts can be asserted without
hardware. The `[solid-lynx ss]` / `[solid-lynx ss2]` / `[solid-lynx lp]` prefixes and the JSON field
names match what the cards emit — that is what makes the assertions meaningful —
but every value in them was written by hand, including the `observed` handle
shapes and the host-call counts.

| Fixture | Verifier exit | What it proves |
| --- | --- | --- |
| `stylesheet-good.log` | 0 | All six stylesheet stages present, in order, with the missing-URL stage failing and the real-URL stage returning against a different stylesheet. |
| `stylesheet-missing-stage.log` | 1 | A capture that stops before `load-real-url` is a finding even though every stage it holds is well formed. |
| `stylesheet-unparseable.log` | 2 | A `summary` line the console bridge cut short cannot be evaluated, which is not a pass. |
| `stylesheet-v2-all-threw.log` | 0 | Every one of the eight bounded `__LoadStyleSheet` cases threw the same `param size should >= 2` error, which is a complete answer for the v2 card rather than a failure: the card exists to record exactly that finding. |
| `list-recycles.log` | 0 | Host asked for rows and called `enqueueComponent` twice: a complete recycling answer. |
| `list-never-recycled.log` | 0 | Host never called `enqueueComponent`, recorded as `0`: a recorded zero is an answer, not a gap. |
| `list-no-answer.log` | 1 | A capture whose `shrunk` and `summary` stages never say whether `enqueueComponent` ran: the question the card exists to answer is left open. |

Two things the fixtures deliberately do **not** carry:

- any `[solid-lynx parity]` line, so a probe capture is never mistaken for smoke
  evidence and `verify-native-parity.mjs` still exits 2 on these files;
- an arity that means anything. The `fn.length` values are placeholders, and the
  verifier only ever checks that a recorded arity is a number — a capture is not
  a signature, which is why there is no fixture that "proves" one.
