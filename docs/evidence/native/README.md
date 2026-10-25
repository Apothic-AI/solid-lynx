# Stored native evidence

A native claim in this repository is only worth what can be re-checked. This
directory is where a native run is stored so the bytes, not the prose, are what
the next reader verifies. Two verifiers read a capture —
`scripts/verify-native-parity.mjs` for the smoke card's one `[solid-lynx parity]`
report, `scripts/verify-native-probe.mjs` for the stylesheet and list cards' one
line per stage — and `scripts/require-native-evidence.mjs` requires one when a
change touches native-facing code, running the verifier that matches the
manifest's `card` against what is stored here.

## The contract

One directory per run, named by date or any stable id:

```
docs/evidence/native/<date-or-id>/
  manifest.json                required: what the run was, and its verdict
  <capture>.log                required: the log the manifest names
```

or, when a native-facing change genuinely needs no device run:

```
docs/evidence/native/<date-or-id>/
  decision.json                an explicit decision, with a reason
```

A directory holds one or the other. It is never evidence to hold both: the
question "was this measured?" must have one answer.

`TEMPLATE/` is a template, not evidence. It carries a `manifest.json` and no
capture, and `require-native-evidence.mjs` rejects it by name — its only job is
to be copied and filled in.

## manifest.json

Every field below is required, and the checker rejects the manifest rather than
guessing at a missing one.

| Field | Type | What it records |
| --- | --- | --- |
| `kind` | `"capture"` | Distinguishes this from `decision.json`. |
| `card` | `"smoke"` \| `"stylesheet"` \| `"list"` | The card `run-native-probe.sh` ran. It also selects the verifier: `smoke` is read by `scripts/verify-native-parity.mjs`, `stylesheet` and `list` by `scripts/verify-native-probe.mjs`. The two capture formats are not interchangeable — a `smoke` manifest over stage lines fails to verify, and so does a probe manifest over a parity report. |
| `capture` | string | The capture filename, relative to this directory. Absolute paths and `..` are refused: the capture has to travel with the manifest. |
| `device.serial` | string | The serial the run was pinned to — `R9WT911JVVH` for the A03. |
| `device.getState` | `"device"` | What `adb -s <serial> get-state` printed. `device` is the only value that means the device was usable; `unauthorized`, `offline`, and `unknown` are not a run. |
| `timestamp` | ISO 8601 | When the run happened. |
| `commit` | git sha | The commit the capture was taken at. It must be inside the change's range: a capture taken before a change cannot back that change. |
| `verifier.exitCode` | `0` | The card's verifier's exit code. `0` is the only code that may be cited as a pass; `1` is findings and `2` is "nothing was verified". |
| `verifier.verdict` | string | The verifier's `verdict:` line, verbatim, for the verifier that card selects. |
| `note` | string | Optional, free text: what the run covered, what it did not. |

`require-native-evidence.mjs` does not take the manifest's word for any of the
verdict fields. It runs the verifier the `card` selects against the stored capture
and fails if:

- the verifier exits 2 — the stored bytes cannot be evaluated at all;
- the verifier exits 1 — the stored bytes report findings, not a pass;
- `verifier.exitCode` disagrees with the live exit code;
- `verifier.verdict` does not appear in the live output, which means the line
  was written from a different run than the capture beside it.

What each verifier checks, per card:

| `card` | Verifier | What a verified capture must carry |
| --- | --- | --- |
| `smoke` | `verify-native-parity.mjs` | Every operation in `parityOperationIds`, each `pass` or `unsupported` with a reason, and a `summary` that agrees with its own rows. |
| `stylesheet` | `verify-native-probe.mjs` | `inventory`, `no-arguments`, `load-missing-url`, `load-real-url`, `summary`, `done` — once each, in order, every line parseable. The mutating stage must have reached a real stylesheet (an absolute URL, a return, and not the failing stage's URL) while the missing-URL stage threw, and `summary.unmeasured` must be non-empty. |
| `list` | `verify-native-probe.mjs` | `inventory`, `create`, `materialize`, `reorder`, `shrunk`, `summary`, `done` — once each, in order. `materialize` must separate "the host asked" from "the probe materialized", and the capture must record whether `enqueueComponent` was ever called: a recorded `0` verifies, an omitted counter is a finding. |

Neither probe check infers a signature: an `arity` (which is `fn.length`) is only
ever checked for being a number, never compared with an expected parameter count.

That is the difference between this directory and a note in `/tmp`: the record
is re-derived from the stored bytes on every check, so editing either half makes
them disagree.

## decision.json

Use this only when the change is native-facing on paper and needs no device run
— a comment rewrite in `src/lynx-host.ts`, a typo in a card's label. It is a
deliberate, named act, not a default.

| Field | Type | What it records |
| --- | --- | --- |
| `kind` | `"decision"` | Distinguishes this from `manifest.json`. |
| `decision` | string | What was decided, in one line. |
| `reason` | string | Why no device run is needed, at least 40 characters. "trivial" is rejected; the point is a reason a reviewer can weigh. |
| `author` | string | Who decided. |
| `timestamp` | ISO 8601 | When. |
| `paths` | array | The native-facing paths this decision covers. It has to name **every** native-facing path the change touches: a record naming one file out of three is rejected, naming which ones it left out. |

## Recording a run

The commands that produce a capture are in `docs/parity-checklist.md`
("How to re-verify") and `docs/release.md` §3. Once the verifier exits 0 on the
capture:

```bash
# 1. Make the evidence directory and copy the verified bytes, not a re-export.
mkdir -p docs/evidence/native/$(date +%F)-smoke
cp /tmp/solid-lynx-logs/lynx_console-smoke-<stamp>.log \
   docs/evidence/native/$(date +%F)-smoke/capture.log

# 2. Re-verify the stored copy, so the bytes that ship are the bytes checked.
#    Use the verifier for the card: parity for smoke, probe for the other two.
node scripts/verify-native-parity.mjs \
  docs/evidence/native/$(date +%F)-smoke/capture.log
node scripts/verify-native-probe.mjs \
  docs/evidence/native/$(date +%F)-stylesheet/lynx_console-stylesheet-<stamp>.log

# 3. Write manifest.json from TEMPLATE/manifest.json.
#    fill in: card, capture, device.serial, device.getState, timestamp,
#    commit (`git rev-parse HEAD`), verifier.exitCode, verifier.verdict
#    (copy the `verdict:` line from step 2 verbatim).

# 4. Commit the capture and the manifest in the same commit as the change
#    they back, then check the requirement is actually satisfied:
node scripts/require-native-evidence.mjs --range <base>..HEAD
```

A capture that is committed without its manifest is a file nobody can verify; a
manifest without its capture is a claim. Both are rejected.

## What is machine-checked, and what is not

Checked on every pull request by the `native-evidence` job
(`.github/workflows/ci.yml`), and locally by
`node scripts/require-native-evidence.mjs`:

- that a native-facing change was detected at all — the path list is in
  `scripts/require-native-evidence.mjs` as `NATIVE_FACING_PATHS`. For
  `.github/workflows/ci.yml` the judgement is structural rather than positional:
  the change counts only if it touches a significant line (not a comment, blank,
  or whitespace) inside a native job's own body as it existed before the change.
  Appending a new job after `native-build`, adding a comment above it, or
  reformatting is not a native change, and the output says which of those it
  saw. A native job that is removed or renamed, a change to what it `needs:`, or
  an unreadable `jobs:` block is treated as native-facing, because those are the
  shapes where an edit could hide;
- that a record was committed with the change, in the range being evaluated;
- that the capture parses and carries what its card is supposed to emit, and
  passes, re-derived by running the matching verifier here: every operation in
  `parityOperationIds` for a `smoke` capture, every required stage in order for a
  `stylesheet` or `list` capture, including whether `enqueueComponent` was ever
  called;
- that the manifest's own recorded verdict matches that live run;
- that the manifest's `commit` is inside the range.

**Not checked, and cannot be:** that a device was attached. `device.getState`
is a string someone typed from their own terminal. CI has no Android device and
no emulator; the `native-build` job compiles the bundle and executes nothing.

The concrete forgery, stated plainly because a check that overstates itself is
worse than no check: take the fixture at
`test/fixtures/native-parity/good-capture.log`, copy it into a new evidence
directory, write a manifest naming the current commit and `"getState": "device"`,
and this check is satisfied — exit 0 — with no device anywhere. It was tried
against this exact script and it passed. The probe fixtures are just as
forgeable: `test/fixtures/native-probe/stylesheet-good.log` verifies clean as a
`stylesheet` capture for the same reason, and its README says so. What such a
record cannot survive is the next person asking which card run produced it,
because the capture is byte-identical to a fixture that ships in this repository
and its lines say nothing about when or where they were taken.

So the requirement is real and the evidence is re-verifiable, but **the claim
that a human ran a device is still a reviewer's question**, not this script's
answer. Two habits keep that honest, and both are cheap:

- A stored capture should look like a run: real `logcat` framing around the
  parity line, the card's own console output, the run's stamp, not a fixture's
  bare shape.
- `docs/parity-checklist.md` records the run against a date, a device serial, and
  an Explorer version. A capture with no such entry behind it is a file, not a
  measurement.

Nothing here is a substitute for the run. It is what makes an absent run fail a
CHECK instead of a convention.
