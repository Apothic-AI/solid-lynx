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

One directory per run, named by date or any stable id. A directory holds exactly
one of three records, and never two: the question "was this measured?" must have
one answer.

### What a real capture looks like

This is the shape the verifiers originally got wrong, and the reason they once
rejected every real capture while passing their own fixtures: the fixtures were
written with a bare marker and JSON, and the device never writes that. Lynx
Explorer logs through the native console bridge, which emits one logcat line per
`console.log` and wraps the message in double quotes, with the logging thread
named in front of it:

```
10-25 08:41:39.887  5650  5685 I lynx    : [715D09544CF0:INFO:lynx_console.cc(230)] "[main-thread.js] [solid-lynx parity] {"label":"native",...}"
|____________ logcat columns _____________________|   |__ thread tag __| |_____ marker ____|  |____ JSON ____| |
                                                      ^                                                   ^       ^
                                                      bridge's opening quote                              payload bridge's closing quote
```

So a stored capture line is: **logcat columns, an opening `"`, a
`[main-thread.js] ` or `[background.js] ` prefix, the card's message, the marker,
the JSON, and a closing `"`**. There are no backslash-escaped quotes inside that
JSON: the bridge does not re-encode it, which is why the closing quote is the
line's last character.

The verifiers read the payload as the span from the first `{` after the marker to
the last `}` on the line. Everything outside that span is framing and is ignored:
the logcat columns, the bridge's quotes, the thread prefix, and trailing
whitespace. The JSON check itself is not relaxed — that span goes to
`JSON.parse` unchanged.

**Truncation is not "the line does not end with `}`".** Every real capture ends
with the bridge's closing quote, so that test would call complete captures
truncated. Instead the verifiers scan the payload span for an unbalanced brace or
an unterminated string *before* parsing. A capture cut mid-write leaves its
braces unbalanced and is reported as truncated; a span whose braces balance but
which JSON rejects is reported as malformed, not truncated. The distinction
matters because the two failures have different causes and different remedies.

**One marker line is one report, and two lines are two reports.** A card can log
from the main thread and from the background thread, so the same marker may
legitimately appear twice. Each line is parsed and evaluated on its own, and both
are labelled with the thread that logged them; neither is dropped in favour of the
other. For the smoke card that means two captured reports, both checked. For a
probe card it means the repeated stage is reported as a `duplicate-stage` finding,
because a stage is expected exactly once.

A stored capture should therefore carry real logcat framing. A file holding only
a bare `[solid-lynx parity] {...}` line is a fixture shape, and while the
verifiers still read it, nothing in this directory should be shaped like one.

```
docs/evidence/native/<date-or-id>/
  manifest.json                a run happened, and here is the log it produced
  <capture>.log
```

```
docs/evidence/native/<date-or-id>/
  decision.json                a deliberate decision that no run is needed
```

```
docs/evidence/native/<date-or-id>/
  pending.json                 a run is specified and scheduled, and has not happened
```

The third form exists because the first two do not describe a real state. A
change can be native-facing, need a device run, have its card built and
unit-tested and its capture format checkable, and still be waiting on a tablet
that is not attached. Writing a `decision.json` for it would assert that no run
is needed — false, and exactly the kind of falsehood this directory exists to
prevent. Having no record at all makes a scheduled requirement indistinguishable
from a dodge. `pending.json` is the record of the third state, and it is **not a
pass**: `require-native-evidence.mjs` exits **3** for it, never 0.

`TEMPLATE/` is a template, not evidence. It carries a `manifest.json` and no
capture, and `require-native-evidence.mjs` rejects it by name — its only job is
to be copied and filled in.

## manifest.json

Every field below is required, and the checker rejects the manifest rather than
guessing at a missing one.

| Field | Type | What it records |
| --- | --- | --- |
| `kind` | `"capture"` | Distinguishes this from `decision.json`. |
| `card` | `"smoke"` \| `"stylesheet"` \| `"stylesheet2"` \| `"list"` | The card that produced the capture. It also selects the verifier: `smoke` is read by `scripts/verify-native-parity.mjs`, `stylesheet`, `stylesheet2` and `list` by `scripts/verify-native-probe.mjs`. The two capture formats are not interchangeable — a `smoke` manifest over stage lines fails to verify, and so does a probe manifest over a parity report. |
| `capture` | string | The capture filename, relative to this directory. Absolute paths and `..` are refused: the capture has to travel with the manifest. |
| `device.serial` | string | The serial the run was pinned to — `R9WT911JVVH` for the A03, `emulator-5554` for the stored 2026-10-25 runs. |
| `device.getState` | `"device"` | What `adb -s <serial> get-state` printed. `device` is the only value that means the device was usable; `unauthorized`, `offline`, and `unknown` are not a run. |
| `runtime` | object | **Optional, and required in practice for any run that is not the A03.** The stored emulator manifests carry `{ kind: "android-emulator", avd, androidApi, abi, lynxExplorer, apkSha256 }`. It is not checked by shape — the checker reads `device` — but it is the only thing that tells a later reader which runtime a capture came from, and *an A03 capture and an emulator capture are different claims*. |
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

What neither verifier can do is see the device. Both read the framing above and
the JSON inside it; a capture whose framing is real but whose payload was written
by hand verifies exactly like one that came off a tablet. That is why a stored
capture carries its `manifest.json`, and why the reviewer's question — which card
run produced this? — is still the reviewer's.

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

## pending.json

Use this when the change needs a device run, the run is specified and reviewed,
and it has not happened. It is not an alternative to measuring; it is the record
that the measurement is missing and why, so that a release can be explicit about
what it has not verified instead of either lying about it or failing its own gate
as though it had dodged something.

A pending record covers a **scheduled** requirement. It is a statement about a
gap. `require-native-evidence.mjs` treats it as an answer about honesty, not an
answer about behaviour: the range exits **3**, which is not a pass.

| Field | Type | What it records |
| --- | --- | --- |
| `kind` | `"pending"` | Distinguishes this from `manifest.json` and `decision.json`. |
| `card` | `"smoke"` \| `"stylesheet"` \| `"stylesheet2"` \| `"list"` | Which card will measure it. The card that has *not* run, named so the next person knows what to attach the device for. |
| `reason` | string | Why no run has happened yet, at least 40 characters. Same bar as a decision's reason: "blocked" is not a reason, and "no device" alone is not either — say what was going to be measured and what stopped it. |
| `blocked_by` | string | The physical or external dependency, named. At least 12 characters, and the shrugs (`n/a`, `tbd`, `no device`, `hardware`, `later`, …) are rejected. The honest shape names the thing: `"A03 R9WT911JVVH not attached over adb; work unit ub_y33g9p"`. |
| `paths` | array | Every native-facing path this record stands in for. Same completeness rule as `decision.json`, and it is checked across the whole record set rather than per directory: a record naming one file out of three — or a set of records between them leaving one out — is rejected, naming the path nobody covered. |
| `author` | string | Who recorded the pending state. |
| `timestamp` | ISO 8601 | When. |
| `commit` | git sha | The commit this record speaks for. It must be reachable from the range's tip; unlike a capture's, it may be the change's own head, because it states a fact about the tip rather than describing a run taken before it. |

A file may hold one record or an array of them. An array is for a release that
ships several cards and can say something different about each — the records
still have to cover the change between them. A directory holds `pending.json`
*or* a capture *or* a `decision.json`; carrying two is rejected, including a
pending record beside a capture in the same directory, because "was this
measured?" would then have two answers.

What a pending record cannot do, and this is the load-bearing rule:

- **It cannot produce exit 0.** A release whose native behaviour is unverified
does not look like a pass to a script or to a CI green tick. Exit 3 is its own
result, documented as "pending, not a pass", and the output prints a warning
block naming every uncovered path, the card that will measure it, and the
blocker, plus a `verdict: pending` line stating that nothing was verified.
- **It cannot cover part of a change.** Every native-facing path in the range has
to be accounted for by a pending or decision record, or the result is exit 1,
and the report names the paths nobody covered.
- **It cannot sit beside a broken record.** A failed capture, a malformed
manifest, or a directory carrying two records means the record set is not the
complete truth, so the range is exit 1 rather than 3: a real defect must not be
buried under a scheduled one.
- **It cannot outrank a capture.** If a capture for the same range verifies, that
is exit 0 and the pending record is reported as superseded. The measurement is
the better answer, and a release does not have to delete its pending record to
record the run that finally happened.

Exit codes, all of them, in one place: **0** satisfied (a capture verified, a
decision covers the change, or nothing native-facing changed); **1** missing
evidence (unmet and nothing says so, or the record set is not complete); **2**
could not evaluate (git, the range, or a stored byte stream could not be read);
**3** pending, not a pass (unmet, and every path is covered by a record that says
so).

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

## Recording that a run is pending

When the run cannot happen — the tablet is somewhere else, the runner has no
adb, the work is queued behind someone attaching hardware — the honest record is
a `pending.json`, not a decision and not silence. The shape is in
`pending.json` above; the mechanical version:

```bash
mkdir -p docs/evidence/native/$(date +%F)-pending
cat > docs/evidence/native/$(date +%F)-pending/pending.json <<'JSON'
[
  {
    "kind": "pending",
    "card": "stylesheet",
    "reason": "The card is built and its captures are verifiable, but no stage line has
               been emitted on a device, so no stylesheet behaviour is measured.",
    "blocked_by": "A03 R9WT911JVVH not attached over adb; work unit ub_y33g9p",
    "paths": [ "examples/lynx-for-native/src/stylesheet-probe.ts" ],
    "author": "<you>",
    "timestamp": "2026-10-25T03:26:00-04:00",
    "commit": "<git rev-parse HEAD>"
  }
]
JSON
node scripts/require-native-evidence.mjs --range <base>..HEAD
# exit 3 — pending, not a pass. The output names every path and the blocker.
```

When the run finally happens, store the capture in its **own** directory with its
`manifest.json`. The capture verifies, the range exits 0, and the report says the
pending record is superseded — so the pending record can be deleted afterwards,
which is exactly what `85ddd12` did for the 1.0.0 records in this tree. Do not add
the capture beside the pending record: a directory holding two records is
rejected.

If the run happens on something other than the A03 — an emulator, another tablet —
say so in the manifest's `runtime` block and in its `note`. A capture of the same
Explorer build on different silicon is a measurement of the engine, not of the
device the pending record was waiting for, and the two must not be conflated.

## What is stored here now

Four run directories from 2026-10-25, all of them **Android emulator** runs rather
than A03 runs:

| Directory | Card | Contents |
| --- | --- | --- |
| `2026-10-25-emulator-api33-smoke/` | `smoke` | `capture.log` + `manifest.json`, verifier exit 0 |
| `2026-10-25-emulator-api33-stylesheet/` | `stylesheet` | `capture.log` + `manifest.json`, verifier exit 0 |
| `2026-10-25-emulator-api33-list/` | `list` | `capture.log` + `manifest.json`, verifier exit 0 |
| `2026-10-25-emulator-api33-stylesheet-v2/` | `stylesheet2` | `capture.log` only — **no manifest**, so it is supporting bytes and **not** a record |

Every one of those manifests names its `runtime` (AVD `lynx33`, API 33, `x86_64`,
Explorer 4.1.0, APK SHA-256
`6ae29787a2166974c29c2f23d87f3b20a137abcf9a8c17903ad19f3fb7f00cb6`) and its
`device.serial` `emulator-5554`, and every one carries a note saying in its own
words that an emulator run backs nothing about GPU behaviour, touch latency,
memory pressure, or physical-device quirks, and does not supersede A03 evidence.
**No A03 capture exists in this directory.** The emulator shares an Explorer
build and an APK digest with the tablet; that is the whole of what transfers.

Each of the three records re-verifies on demand:

```bash
node scripts/verify-native-parity.mjs \
  docs/evidence/native/2026-10-25-emulator-api33-smoke/capture.log      # exit 0
node scripts/verify-native-probe.mjs \
  docs/evidence/native/2026-10-25-emulator-api33-stylesheet/capture.log # exit 0
node scripts/verify-native-probe.mjs \
  docs/evidence/native/2026-10-25-emulator-api33-list/capture.log       # exit 0
```

**The one worked `pending.json` in this tree's history is gone.**
`2026-10-25-1.0.0-pending/pending.json` held three records, one per card, that
between them named all 22 native-facing paths of the 1.0.0 range and the A03 they
were waiting on; commit `85ddd12` deleted it once the emulator captures existed,
because a verifying capture supersedes a pending record and leaving it would have
kept asserting that nothing had run. The `pending.json` form itself is unchanged
and still exercised by the tests in `test/require-native-evidence.test.ts`, which
build their own throwaway repositories. Nothing in this directory currently
records a scheduled-but-unrun measurement, so a native-facing change with no
record of its own is exit 1, not exit 3.

## What is machine-checked, and what is not

Wired into the `native-evidence` job (`.github/workflows/ci.yml`) to run on
every pull request, and runnable locally as
`node scripts/require-native-evidence.mjs`. The job has not yet executed on
GitHub Actions — no workflow in this repository has — so what is established
below is the script's measured behaviour and the job's declared wiring:

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
- that the manifest's `commit` is inside the range;
- that a `pending.json` names a real card, a reason a reviewer can weigh, a
  blocker that is a named dependency rather than a shrug, and an author, a
  timestamp and a commit reachable from the range — and that the pending and
  decision records together cover **every** native-facing path in the range. If
  they do not, the result is exit 1 and the report names the uncovered paths;
  if they do, the result is exit 3 and the output says plainly that nothing was
  verified as a pass.

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

The framing does not change that. The `real-format-*.log` fixtures reproduce what
the bridge actually writes, so a verifier now reads a real capture the same way
it reads a fixture — but reproducing the framing is not evidence that a device
produced any given line, and nothing here claims otherwise.

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

<!-- temporary: exercising the native-evidence gate on a real pull request; reverted before merge -->
