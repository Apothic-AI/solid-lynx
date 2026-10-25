# Native parity capture fixtures

Synthetic `logcat` captures for the host-free tests of
[`scripts/verify-native-parity.mjs`](../../../scripts/verify-native-parity.mjs).
They are shaped like the output of
`examples/lynx-for-native/scripts/run-native-probe.sh smoke`: a few
`lynx_console` lines, then one line carrying
`[solid-lynx parity] {"label":"native",...}`.

**These are not device evidence.** No device produced them, and no row derived
from them may be recorded in `docs/parity-checklist.md` as a native result. They
exist so the verifier's verdicts can be asserted without hardware, and the
`label` they carry (`native`) is a string in a file, not a measurement.

| Fixture | Verifier exit | What it proves |
| --- | --- | --- |
| `good-capture.log` | 0 | All twenty operations pass, and unrelated console lines around the report do not disturb extraction. |
| `unsupported-with-reason.log` | 0 | An `unsupported` row that carries an `observed` reason is acceptable evidence, not a failure. |
| `missing-operation.log` | 1 | A report missing `renderer-dispose` is a finding even though every row it does contain passes. |
| `not-passing.log` | 1 | A `fail` row and an `unsupported` row with no reason are both findings. |
| `unparseable.log` | 2 | A truncated report line (the native console bridge dropped the tail) cannot be evaluated, which is not a pass. |
| `empty-capture.log` | 2 | A capture that has console output but no parity line cannot be evaluated, which is not a pass. |
| `no-lines.log` | 2 | A zero-byte log (the run wrote nothing) is also unevaluable, and must not be read as an empty pass. |
