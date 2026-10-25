# Changelog

`solid-lynx` is a Solid renderer for Lynx Element PAPI.

This file records what each version actually contains. Dates are the commit
dates of the change that produced them in this repository's history, not release
or publish dates. The documented promises live in
[contract.md](docs/contract.md) — where a statement here and the contract
differ, the contract wins.

Release status: `package.json` and the exported `version` constant in
`src/index.ts` say `1.0.0`, and the name the manifest declares is
`@apothic-ai/solid-lynx`, scoped and marked `publishConfig.access: "public"` —
see "Package name" under 1.0.0 for why. This repository has no git tags and no
publish workflow (`.github/workflows/` contains only `ci.yml`), so nothing here
was published by these commits. **`1.0.0` is nonetheless on the public registry:**
npm reports it published 2026-10-25 with `gitHead aded55b`, an ancestor of this
tree, which means this repository is now ahead of the artifact that consumers
have. Everything under "Unreleased" below is work that happened after that
publish and is in no published tarball. The unscoped npm name `solid-lynx`
resolves to an unrelated package (MIT licence, a different maintainer, published
2025-03-10); this project ships Apache-2.0 and is not that package.

## Unreleased

No version number is assigned to this section, and the reason is recorded rather
than left implicit: **every commit since the publish changes no shipped code.**
The published tarball's `dist/` is byte-identical to a build of this tree, so a
republish under a new number would ship the same renderer, the same types, and
the same exports — a version that moved without a byte changing, which is the
kind of number this file exists to stop. The one caveat is documentation: `docs/`
and `CHANGELOG.md` **are** in `files[]`, so the next tarball would carry different
prose. That makes a republish *worth doing* for a consumer who reads documentation
from the installed package instead of the repository; it does not make it a
version. If one is cut for that reason, `1.0.1` is the number, and it is a
release decision rather than a fix — nothing a consumer imports changes. See
[release.md](docs/release.md) §2 for the check that keeps this honest at the next
publish.

### The web-core boot race is patched for the test harness, and disclosed to consumers

`@lynx-js/web-core` 0.26.2 can boot a card into `lynx-view` and never render it,
with no error on any channel: the decode worker's `done` message overtakes the
`LynxViewInstance` dynamic import that every section handler awaits, the bundle is
moved out of `#loadingBundles` while a handler is still waiting to write into it,
and `lepusCode` is silently lost. `patches/@lynx-js__web-core@0.26.2.patch` is
applied through `patchedDependencies` in `pnpm-workspace.yaml` and defers settling
the bundle until the last section handler has finished; `scripts/repro-boot-stall.mjs`
reproduces the stall on demand without it. 0.26.5 was inspected afterwards and its
`done` handler is unchanged, so a dependency bump does not address it.

This is a **change to this repository's development tree, not to the package**. It
touches no file under `src/`, changes no export, and adds no dependency: the
renderer has no `dependencies` block, `@lynx-js/web-core` is not a peer, and
nothing in `dist/` imports it. A consumer is therefore not fixed by anything in
this entry — which is exactly why it is written down. Capabilities that only the
browser suites have measured are now stated with the caveat attached: the defect,
what it looks like, which versions carry it, and what a consumer can do about it
are in [capabilities.md](docs/capabilities.md#the-lynx-for-web-boot-race-in-web-core-0262),
and [compatibility.md](docs/compatibility.md) §3 records that the supported 0.26.2
carries it and that this repository's web results depend on the local patch, so a
consumer's results may differ. One sentence in the README's Lynx-for-Web section
carries the same caveat to the npm page, because that is where a consumer reads it
first.

The 1.0.0 entry below is left as it was: it describes a shipped artifact, and
editing it to mention a patch that artifact does not contain would make the record
of what shipped wrong.

### The browser suite reports both realms, and names the stage a view stopped in

Two runs of the same commit failed different tests — `keeps a second root
isolated and remounts a disposed root` and `unmounts the Solid app when #dispose
is clicked` — with byte-identical reports: `Page errors: (none)`, `Console
errors: (none)`, `Failed requests: (none)`, `renderedCount: null`, `shadowChildren:
["iframe", "link"]`, `probeInstalled: false`. That report read as "nothing
failed", and it could not have said otherwise. `@lynx-js/web-core` runs the card
in an iframe inside `lynx-view`'s shadow root, and `page.on("pageerror")` /
`page.on("console")` listen to the top-level page only, so an exception in the
realm was unobservable by construction.

The fixture is healthy and the tests are not at fault: the same stall is
reproducible in the fixture with no test involved, at 7 of 250 boots (three
runs of 40, 60 and 150, each in exactly the CI state) against the dev server,
and it then appeared in the browser suite itself, failing `replaces and removes
bindings and detaches them with their subtree` with the same report CI produced.
One attempt then stalls for the whole 30s wait. Instrumenting web-core's
handshake located it: the decode worker replies `ready, section×5, done` — the
bundle decoded — and the card's main-thread script is never inserted into the
realm, which is web-core's in-flight lazy import of `LynxViewInstance` (the one
that appends the stylesheet `link`) and inserts nothing afterwards. Nothing
raises, so no channel can report it.

`loadFixture` now records what a stalled view looks like instead of only what
the page saw:

- an init script installs an `error` / `unhandledrejection` / `console` sink in
  every realm, so `exceptions` and `console` are reported per frame with the
  realm's own `location`, and a frame with no sink says so rather than being
  folded into "(none)";
- `viewState()` names the boot phase (`no shadow root` → `no realm iframe` →
  `realm iframe created` → `LynxViewInstance constructed` → card script in the
  realm → rendered), the realm's reachability, `lynx-view`'s computed box and
  visibility, the shadow stylesheet `link`'s loaded rule count, and every script
  in the realm's `head`;
- `viewBoxOverWait` keeps the sequence of `lynx-view` box sizes observed while
  the wait ran, so a zero box that never changed is distinguishable from one
  still being laid out;
- worker construction and message sequence are recorded, which is what separates
  a worker that never answered from a main-thread step that never ran.

No timeout, retry, or assertion was relaxed, and the wait still fails on a view
that does not render. README's browser-suite section and the loader's own notes
say what "(none)" now covers.

### Two probe-card defects the first real captures found, fixed in the cards

Both were found by running the now real-format-capable verifier against captures
taken on an API 33 `x86_64` emulator, not against fixtures. Neither is a checker
change: `scripts/verify-native-probe.mjs` and `scripts/verify-native-parity.mjs`
are untouched, the old captures still produce the same findings byte for byte,
and the fix is that the rebuilt cards produce a capture the frozen rules accept.

- **The list card could not name the bindings it probed.** Its `inventory` stage
  built each row as `{ name, ...describeFunction(scope[name]) }`, and
  `describeFunction` carries the runtime's own `fn.name` — which for a native
  binding is `""`. The empty string overwrote the probed name, so
  `__CreateList` and `__UpdateListCallbacks` arrived in the capture with
  `"name":""` and a reader could no longer tell which binding a row described.
  `describeListInventory()` now writes the probed name last so it always wins,
  keeps the runtime's name separately as `fnName`, and records where the name
  came from (`enumeratedAs`: `own`, `absent`, or `unreadable`). A binding that
  exists but cannot be read is still named.
- **The v1 stylesheet card's `load-real-url` stage never reached a stylesheet.**
  It called `__LoadStyleSheet(url)` with one argument, and the engine throws
  `LoadStyleSheet param size should >= 2` for that. The v2 card has since
  measured the second parameter: `[url, "utf-8"]` returns `null` while
  `[url, null]`, `[url, 0]`, `[url, {}]`, `[url, function(){}]` and `[url, []]`
  throw `LoadStyleSheet param 1 should be String`, so it is an encoding label,
  not a handle. The stage now records the one-argument call **first**, as the
  measured negative result, then the two-argument call — which is the last call
  in the stage and therefore the one the verifier reads — so v1 records a load of
  `probe.css` that did not throw. No handle is returned either way, and all three
  operations remain unmeasured for lifecycle.

The `summary` stage no longer re-echoes calls the earlier stages already logged.
Echoing them repeated the engine's error text and would have put that line at
2,156 bytes, past the 2,040 bytes the native console bridge is measured to
deliver intact; a truncated stage is worse than a short one.

Tests: `test/list-probe-report.test.ts` asserts every `inventory.operations` entry
has a non-empty string `name`, including the globals the host lacks, and that a
binding reporting its own (different) `fn.name` still cannot displace the probed
one. `test/stylesheet-probe-report.test.ts` pins the two-call order and outcomes.
Two tests in `test/native-probe-verify.test.ts` build a capture from those real
recorders, against an engine that behaves as the captures measured, and hand it
to the unmodified verifier, which exits 0.

Measured on this engine, and not generalised: `__UpdateListComponents` and
`__GetListComponents` are **absent** — the list PAPI on the measured engine is
`__CreateList`, `__UpdateListCallbacks`, `__AddEventListener` and
`__RemoveEventListener`, and no more. They are still inventoried, now by name.

### The emulator runs are stored, and the pending record they superseded is gone

The three cards were run on an Android emulator — AVD `lynx33`, Android 13 /
**API 33**, ABI **`x86_64`**, Lynx Explorer **4.1.0**, APK SHA-256
`6ae29787a2166974c29c2f23d87f3b20a137abcf9a8c17903ad19f3fb7f00cb6` (the same
digest the A03 install documents) — and the captures are committed:

| Directory | Card | Verifier |
| --- | --- | --- |
| `docs/evidence/native/2026-10-25-emulator-api33-smoke/` | smoke | exit 0, 20 operations pass across 1 report |
| `docs/evidence/native/2026-10-25-emulator-api33-stylesheet/` | stylesheet (v1) | exit 0, 6 required stages present |
| `docs/evidence/native/2026-10-25-emulator-api33-list/` | list | exit 0, 7 required stages present |
| `docs/evidence/native/2026-10-25-emulator-api33-stylesheet-v2/` | stylesheet v2 | **no manifest** — supporting bytes, not a record |

`85ddd12` deleted `docs/evidence/native/2026-10-25-1.0.0-pending/pending.json`
because the gate says of a verified capture that it *supersedes* a pending
record: leaving it would have kept telling a reader that nothing had run when
three cards had. **That deletion did not close anything.** What it removed was a
statement about honesty — "the run is scheduled and has not happened" — which is
now false. What it did not and could not remove is the gap it was written about:

- The A03 half of that record is still true. `adb -s R9WT911JVVH get-state`
  still exits 1 from this worktree, **no A03 capture exists for any card**, and
  the 2026-10-09 run's own capture is still lost. That is recorded in
  `docs/capabilities.md`, `docs/parity-checklist.md` and the roadmap, where a
  reader looks for device status.
- The stylesheet **lifecycle** is still unmeasured, and now for a measured
  reason: no call in any card returned a stylesheet handle.
- List cell **recycling** is still unobserved: `enqueueComponent` was never
  called, and the card never scrolls, so the card's own `summary.unmeasured`
  refuses to read a zero as an inability.

An emulator is also not the tablet it shares an APK with. It proves nothing about
GPU behaviour, touch latency, memory pressure, or a physical-device quirk, and it
carries no tap at all — the only tap evidence in this tree remains the
2026-10-09 A03 prose.

### A probe capture can be verified by process, on both cards

`ROADMAP.md` box 4 recorded the last mechanical gap in the stylesheet half: the
stylesheet probe card logged its `[solid-lynx ss]` stages and nothing could
check them. `scripts/verify-native-parity.mjs` reads only the smoke card's
`[solid-lynx parity]` marker, so a capture carrying only stage lines exited 2,
and the measurement could only be *recorded* by naming the capture and reading
it against `docs/capabilities.md` by eye.

`scripts/verify-native-probe.mjs` is the sibling that closes it, and it is a
sibling rather than a `--probe` mode on purpose: the parity verifier's
behaviour is unchanged, byte for byte, and its contract is asserted by its own
suite (it still exits 2 on a capture with no parity line — there are now three
tests that hold it to that while the probe checker exists). The new script reads
a text file and nothing else — no device, no adb, no network, and no `dist/`,
so a missing build can never turn a probe capture into "could not evaluate".

It checks, per card, with the same exit codes the parity verifier uses (0
verified, 1 findings, 2 could not evaluate):

- **Stylesheet** (`[solid-lynx ss]`): `inventory`, `no-arguments`,
  `load-missing-url`, `load-real-url`, `summary`, `done` — each present once, in
  that order, every line parseable as JSON. `inventory` describes all three
  bindings. `load-missing-url` recorded an absolute URL and a throw;
  `load-real-url` recorded a *different* absolute URL and a return, which is how
  "the mutating stage reached the real stylesheet while the missing-URL stage
  failed" is checked rather than asserted. `summary.unmeasured` must be present
  and non-empty; the wording is not checked, because it belongs to the card.
- **List** (`[solid-lynx lp]`): `inventory`, `create`, `materialize`,
  `reorder`, `shrunk`, `summary`, `done`. `materialize` must keep "the host asked
  for this row" apart from "the probe materialized this row", and its derived
  `hostAskedOnItsOwn` must agree with the two fields it is derived from. The
  recycling question must be *answered*: `summary.hostCallCounts.enqueueComponent`
  is required, and a recorded `0` verifies — "the host never called it" is a
  measurement. A capture that omits the counter is a finding, because it then
  leaves open the question the card was run to close.

**No check infers a signature.** `fn.length` is the parameter count a binding
reports, and a native binding can report any number regardless of what it
requires, so an `arity` in a capture is evidence about the binding and never a
parameter list. The only assertion made about one is that a recorded arity is a
number; the source says so at `checkArityFields`, and
`test/native-probe-verify.test.ts` includes a structural test that the code has
no expected-arity comparison to grow into one.

`scripts/require-native-evidence.mjs` now picks the verifier from the manifest's
`card` — parity for `smoke`, probe for `stylesheet` and `list` — so the evidence
contract accepts a verified probe capture. The pairing is enforced in both
directions: a probe capture offered as `smoke` evidence gets the parity
verifier's exit 2, and a smoke capture offered as probe evidence gets the probe
verifier's exit 2. Neither is reported as missing evidence, because "exists but
cannot be read" is a different result. It also quotes the verifier's own finding
lines in its report now, so a rejection names the stage rather than only the
count.

No card changed. No field a card emits was altered, so this is not a
native-facing change by `NATIVE_FACING_PATHS`; no device was attached and no
device run happened, so `ROADMAP.md` box 4 stayed unticked and
`docs/capabilities.md` recorded both probes as "has not been run" **at that
commit** — the emulator runs described above are what later moved it. The new
fixtures under `test/fixtures/native-probe/` are synthetic and their README says
so, beside the same warning the parity fixtures carry.

### Native evidence is a requirement, not a convention

`ROADMAP.md` box 4 said the native half of the compatibility requirement was
enforced by nothing: the PR template was prose, `scripts/verify-native-parity.mjs`
was a command someone had to remember to run, and no workflow invoked it, so a
pull request that changed native-facing behaviour and ticked nothing merged
green.

`scripts/require-native-evidence.mjs` reads a git diff and answers that question
mechanically. It takes a revision range (`--range A..B`, or the merge base
against `origin/master` by default), computes the changed paths, and decides
whether the change is native-facing from one exported constant,
`NATIVE_FACING_PATHS`: the `src/` files the native bundle reaches, the type
surface its cards compile against, `src/rspeedy.ts` because it configures the
native build, `examples/lynx-for-native/`, and `.github/workflows/ci.yml` only
when the changed lines land inside the `native-build` or `native-evidence` job.

A native-facing change is satisfied by one of two things, both committed by the
change itself: a capture under `docs/evidence/native/<date-or-id>/` with a
`manifest.json`, which the script re-verifies by running the existing verifier
against the stored bytes and requires to exit 0; or a `decision.json` recording
explicitly that this change needs no device run. Exit 0 is satisfied, 1 is
missing or mismatched evidence, 2 is could not evaluate. That was the whole
contract when this landed. A third form, `pending.json`, was added afterwards
and is the entry below.

It is wired in as the `native-evidence` CI job over
`pull_request.base.sha..HEAD` (commit `427aeb7`), and on `push` /
`workflow_dispatch` it prints that there is no PR base and passes rather than
evaluating a range that would mean nothing. `docs/evidence/native/README.md`
documents the record contract and `docs/evidence/native/TEMPLATE/manifest.json`
is a capture-less template the script rejects as evidence by name.

The suite is host-free: it builds its own git repositories in `mkdtemp`, so it
needs no device, no network, and not this repository's git state. It had 29
cases when it landed (`88141f0`), 33 after the workflow-structure judgement
(`0044bcc`) and a decision that has to account for the whole change
(`e383722`), 41 after the probe-capture entry above added eight for the
per-card verifier (`c5cd5a1`), and 50 after the pending entry below added nine.
The count is quoted at each commit it changed because it is the kind of number
that goes stale silently.

What this does not do: run a device. `device.getState` in a manifest is a string
a human typed; no runner can confirm hardware existed. The requirement that a
run be recorded and re-verifiable is enforced; performing the run is still manual
work. No capture is stored at this commit, and `docs/parity-checklist.md` still
records the native column as reported, not reproduced.

`ROADMAP.md` box 4 is ticked for that reason and that reason only, in as many
words: the check that was missing now exists and is red when evidence is absent.

### A pending native run is its own outcome, and it is not a pass

Measured before the change: `node scripts/require-native-evidence.mjs --range
origin/master..HEAD` on this release branch — 48 commits, 22 native-facing paths
— exited 1 with `verdict: missing evidence`. That verdict was wrong in kind. The
release is not shipping a native change that dodges measurement; it ships a
stylesheet probe and a list probe that are built, unit-tested, and waiting on an
A03 that is not attached. The contract could express two outcomes, "a capture
verifies" and "an explicit decision that no run is needed", and neither
describes "the run is specified, reviewed, and pending on hardware, and the
release says so in the changelog, the roadmap, and `docs/capabilities.md`". So
the release had to either write a `decision.json` asserting that no run was
needed — false, and the exact falsehood `docs/evidence/native/` exists to
prevent — or fail its own gate as though it had dodged the requirement.

`pending.json` is the third form. It records `kind: "pending"`, the `card` that
will measure the change, a `reason` of at least 40 characters, `blocked_by`
naming the physical or external dependency (a shrug like `n/a`, `tbd`, or `no
device` is rejected), every native-facing `path` it stands in for, an `author`, a
`timestamp`, and a `commit` reachable from the range.

**It exits 3, not 0, and the difference is the point of the whole entry.** "This
release's native behaviour is unverified" must not look like a pass to a script
or a CI green tick, so 3 is documented as **pending, not a pass** and is never
folded into 0. It is not 1 either: 1 means the requirement is unmet and nothing
says so, and a scheduled requirement is not a dodge. The script prints an
unmissable warning block — every covered path, the card, the blocker, and a
`verdict: pending` line stating that nothing was verified as a pass — and the
`native-evidence` job turns 3 into a `::warning title=Native evidence PENDING —
not a pass::` annotation plus a job-summary block, while exit 1 and exit 2 still
fail the job. A red `native-evidence` job therefore always means the evidence is
missing or unreadable, never merely scheduled.

The pending form is accepted only as the complete truth for a range. Pending and
decision records together have to cover *every* native-facing path; one path left
out is exit 1, and the report names the path nobody accounted for. A verifying
capture for the same range still wins with exit 0 and the pending record is
reported as superseded, so a release does not have to delete its pending record
at the moment the measurement finally arrives. A directory holding two records,
a `pending.json` whose commit is outside the range, and a failed capture beside a
pending record all stay exit 1: a real defect must not be buried under a
scheduled one.

This release used it for real. `docs/evidence/native/2026-10-25-1.0.0-pending/`
held three records — one each for the smoke, stylesheet, and list cards — that
between them named all 22 native-facing paths of the release range and the A03 the
runs were waiting on. On that range the gate reported `verdict: pending` and
exited 3 instead of reporting a dodge that did not happen. Nine host-free tests
cover the new form through throwaway `git init` repositories: full coverage exits
3 with the warning text, one path missing exits 1, a capture wins with exit 0, a
decision and the template behave exactly as before, a shrug `blocked_by` is
rejected, two records in one directory are rejected, a broken record beside a
pending one stays exit 1, a split record set is judged as a union, and a record
from outside the range covers nothing.

**That directory no longer exists.** `85ddd12` deleted it once the emulator
captures in "The emulator runs are stored" above existed, because a verified
capture supersedes a pending record and this one had become a false statement
that nothing had run. The pending *form* is unchanged and still tested: the tests
above build their own throwaway repositories, and none of them reads this tree's
evidence directory.

What did not change when that record was written: what any document claims was
measured. At the time, the stylesheet and list cards had not run and the native
column of `docs/parity-checklist.md` was `reported`, not reproduced. What changed
later, and only because captures exist, is recorded above: the two probe cards
have run on an API 33 emulator and the A03 column is still `reported`.

## 1.0.0 — 2026-10-24

The first stable release. It freezes the public contract, pins the dependency set
the contract was verified against, and adds the automation and the native
measurement instrumentation that the contract requires.

### Package name: `@apothic-ai/solid-lynx`, while the repository keeps saying solid-lynx

The name this package is published under is **`@apothic-ai/solid-lynx`**. The
`name` in `package.json` is that scoped name, and `publishConfig.access` is
`"public"` — a scoped package defaults to `restricted`, so without it an install
outside the npm organisation gets a 404 even though the tarball is correct.

The scope is not a preference. `solid-lynx` on npm is an **unrelated MIT package**
published on 2025-03-10 by a different maintainer, which `npm view solid-lynx`
reports and which this repository has recorded as the release blocker since 0.x.
This project is Apache-2.0 and is not that package, so publishing under the
unscoped name was never available. Nothing about the renderer changed with the
name: version `1.0.0`, the exported `version` constant, and every subpath are
what they were.

The rename is confined to the places where the name is a module specifier or a
registry identity — `package.json` `name`, the `jsxImportSource` in
`tsconfig.json` and in the consumer fixtures, the `moduleName` default in
`src/rspeedy.ts` and the `babel-preset-solid` settings the README teaches, the
imports in `examples/`, the `declare module` augmentations in
`test/consumer/custom-elements.d.ts`, and the entry-point table in
[contract.md](docs/contract.md) §1. Those are marked with the `@apothic-ai/`
prefix, and `@apothic-ai/solid-lynx/rspeedy`, `.../parity`, `.../jsx-runtime` and
`.../jsx-dev-runtime` resolve exactly as the unscoped subpaths did.

Everything else keeps the old name deliberately. The repository, this changelog,
the roadmap, the worktree and branch names, and the prose in the docs still call
the renderer **solid-lynx** when they mean the product rather than a specifier;
the README is titled solid-lynx and says so where it first tells a reader how to
install it. The 0.x entries below keep the name they were written with — they
describe commits that predate the scope, and rewriting them would make the
history agree with a decision that had not been made yet.

The regression is now asserted rather than remembered. `test/packaging.test.ts`
reads the tarball's own manifest and fails if `name` is not
`@apothic-ai/solid-lynx` or `publishConfig.access` is not `"public"`, and reads
the tarball filename (`apothic-ai-solid-lynx-1.0.0.tgz`) rather than assuming it.
`test/consumer-install.test.ts` installs the tarball under
`node_modules/@apothic-ai/solid-lynx`, imports every documented entry through the
scoped specifiers, and proves the bare `solid-lynx` specifier no longer resolves —
so a revert of the manifest's `name` fails a test instead of silently changing
which package on npm this repository would publish.

### The published package carries the documentation it links to

`package.json` `files` was `["dist", "README.md", "LICENSE"]`, so the tarball's
README carried thirteen links to seven files that were not in the package
(`docs/contract.md`, `docs/compatibility.md`, `docs/migration.md`,
`docs/capabilities.md` three times, `docs/session-handoff.md`, `CHANGELOG.md`,
and `ROADMAP.md`). Every one resolved from a repository checkout and was dead
for anyone who installed from npm. Commit `e68eb0a`.

`files` is now
`["dist", "docs", "CHANGELOG.md", "README.md", "ROADMAP.md", "LICENSE"]`.
Measured from the real tarballs at that commit: 33 entries / 37,168 B packed /
128,510 B unpacked before, 43 entries / 113,098 B packed / 356,074 B unpacked
after — about 74 KiB more over the wire, for a README whose links all work.
The package has grown since: at the tip of this release it is 46 entries, the
extra three being the evidence contract in `docs/evidence/native/`, which
landed afterwards. Those bytes are this repository's documentation, not this
change's. `docs/` ships whole rather than as the four
consumer-facing documents, because the shipped docs cross-link `building.md` and
`parity-checklist.md`; an explicit four-file list leaves fifteen second-hop links
dangling. Three links in `docs/` pointed at repository-only probe scripts under
`examples/`; they are plain code spans now, and the `version` constant cited in
`docs/contract.md` was corrected from `0.1.0` to `1.0.0`.

`test/packaging.test.ts` keeps it honest without a network or a device: it asks
`pnpm pack --dry-run --json` for the real file list and fails when a relative
link in a shipped markdown file resolves to a file that is not shipped, escapes
the package root, or names a heading that does not exist. Run against the old
`files[]`, it reports all thirteen dead README links by file and line.

One consequence worth stating, because it is a real cost and not a detail: the
package now ships `docs/evidence/native/`, including the pending records, so
`docs/release.md` and the release process itself are inside the tarball. That is
deliberate — a reader who installs the package can see what was and was not
measured — but it does mean the packaged docs discuss this repository's device
state rather than only the library.

### The public contract is frozen

`docs/contract.md` (commit `0d77793`) records every public signature — host,
root, renderer, element, event, ref, CSS id, list, JSX, Rspeedy plugin, and the
`parity` diagnostic — and labels each item **stable**, **provisional**, or
**unsupported**. Each item cites the test that covers it. Section 16 of that
document lists the exported surface that has **no** automated test, so a frozen
promise can be told apart from a documented intention.

### Dependency versions are pinned and recorded

`docs/compatibility.md` with `package.json` (commit `5ecace6`) pins the packages
that decide what an emitted bundle means: `@lynx-js/rspeedy` 0.18.0,
`@lynx-js/rsbuild-plugin` 0.1.3, `@lynx-js/vanilla-rsbuild-plugin` 0.1.2,
`@lynx-js/lynx-core` 0.1.4, `@lynx-js/web-core` 0.26.2, `@rsbuild/core` 2.2.11,
`@rsbuild/plugin-babel` 2.1.0, `babel-preset-solid` 1.9.15, and `solid-js`
1.9.15. `typescript`, `vite`, `vitest`, `@playwright/test`, and `@babel/core`
keep caret ranges; their lockfile-resolved versions are what was actually run.
`docs/compatibility.md` §8 states what the ranges do **not** claim: the workflow
would repeat the local gate on one toolchain set rather than widening the
supported set — and it has not run yet. No workflow has executed on GitHub
Actions for any commit in this release, so the pinned set is verified locally
and declared for CI, not verified by CI.

### Migration and compatibility guidance

`docs/migration.md` (commit `002b786`) is the upgrade guide from a `0.x` build:
refs, CSS ids, event props, JSX types, the list API, root lifecycle, and an
explicit table of what deterministic cleanup proves and what it does not.

### Continuous integration

`.github/workflows/ci.yml` (started by commit `a7d225c`) runs on
`pull_request`, on `push` to `master`, and on `workflow_dispatch`, with six
jobs. Jobs were added as the release matured rather than all at once; the commit
that added each is named in its row.

| Job | Added by | Steps |
| --- | --- | --- |
| `unit` | `a7d225c` | `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm typecheck:consumer`, `pnpm test`, `pnpm build`, `pnpm pack --dry-run` |
| `node-matrix` | `dd907cd` | Install, type check, and unit tests on `20.x`, `22.x`, `24.x` — the top of each Node line `engines.node` admits |
| `solid-matrix` | `56b402c` | Install, overlay `solid-js` 1.9.16 / 1.9.17 with the matching `babel-preset-solid`, `pnpm typecheck`, `pnpm test`, `pnpm web:build`, then assert the gate really ran on the overlay. `needs: unit` |
| `browser` | `a7d225c` | Chromium install, then the Lynx-for-Web suite (`PLAYWRIGHT_PORT=4186 pnpm web:test`) and the pattern suite (`PLAYWRIGHT_PORT=4200`, `test/browser/patterns.playwright.config.ts`) |
| `native-build` | `a7d225c` | `pnpm native:build`, uploading `examples/lynx-for-native/dist` |
| `native-evidence` | `427aeb7` | `pnpm build`, then `node scripts/require-native-evidence.mjs --range <pr base sha>..HEAD` |

`browser`, `native-build`, `native-evidence`, and `solid-matrix` all have
`needs: unit`, so the unit gate runs first and a red one stops the rest.
`node-matrix` deliberately has no `needs:`, so a failing leg there reads as the
matrix rather than as the unit gate.

`native-build` compiles the bundle and attaches no device or emulator, and the
workflow's own header comment says so: native runtime behaviour is still verified
by hand. `native-evidence` reads files rather than executing anything, so it can
prove a record exists and re-verifies, never that hardware existed.

Both version matrices are what put a run behind a declared range rather than
trusting it: `node-matrix` behind `engines.node`, `solid-matrix` behind the
`^1.9.15` peer range. Neither has run on GitHub Actions yet — this worktree
cannot dispatch a workflow — so the recorded evidence for both is a local replay
of the same commands, which [compatibility.md](docs/compatibility.md) §1–§2 and
§8 record in full, including the two `pnpm add` routes that were tried and
failed.

### Indexed list row model

`root.createList()` (commit `2bcac14`, `src/list.ts`) creates a list through
`__CreateList` and re-installs `componentAtIndex`/`enqueueComponent` through
`__UpdateListCallbacks`. Rows are keyed: a key keeps its node when it moves
index, a surviving key whose item was replaced is rebuilt, rows stay in ascending
index order across sparse and out-of-order host requests, and disposal releases
every row and leaves an inert callback pair. `<list>` in JSX throws instead of
rendering every row as a real child.

Verified against `@lynx-js/web-core@0.26.2` only, including the host's own
`update-list-info` request path in the browser suite. No host in this repository
has been seen to recycle a cell. See "Known limitations" below.

### Refs

`ref` and `use(fn, element, arg)` (commit `0d1a715`) register whatever the
binding returns as the owning Solid scope's teardown, so removing a conditional
subtree clears its ref and disposing a root clears every ref it owns.
`createLynxRef()` returns a ref that is both callable and readable through
`.current`. A plain `{ current }` object is rejected by the types rather than
silently failing, because the JSX transform assigns a non-function ref instead of
calling it.

### CSS ids

`root.setCSSId(cssId, entryName?)` (commit `0d1a715`) drives `__SetCSSId` in one
batched call over the elements a root owns directly in its page; elements the
root adds later get the same id. An invalid id throws before anything is
recorded, and a host without `__SetCSSId` throws rather than rendering unstyled.
Assigning a CSS id selects a stylesheet the Lynx toolchain already compiled into
the bundle; it does not load one.

### Native probe cards

Two measurement cards ship with host-free recorder tests, so the recording logic
is covered without a device:

- `examples/lynx-for-native/src/stylesheet-probe.ts` (commit `2bcac14`) logs one
  `[solid-lynx ss]` line per stage and calls only operations that cannot mutate
  the card: `__LoadStyleSheet`, `__AdoptStyleSheet`, `__ReplaceStyleSheets`.
- `examples/lynx-for-native/src/list-probe.ts` (commit `d8562dd`, built as
  `dist/list-probe.lynx.bundle` by `pnpm native:build`) logs one
  `[solid-lynx lp]` stage line per step and reports the list-named globals, the
  created handle, materialized children, keyed identity across a permuted model,
  and whether the host ever called `enqueueComponent`.

Both are built by `pnpm native:build`; neither has been run on a device, so they
**measure nothing yet**. That statement is not softened by anything else in this
release: the cards are instrumentation, and instrumentation that has never run
produces no result.

Running either one by hand means one command, not a per-card script.
`examples/lynx-for-native/scripts/run-native-probe.sh` (commit `faca97c`) takes
the card as its argument — `smoke`, `stylesheet`, or `list`, or the bundle stem
`main`, `stylesheet-probe`, `list-probe` — and does the whole sequence: pin the
A03 serial, `pnpm native:build`, serve the bundle on loopback, `adb reverse`, the
`lynx://open` deep link, `logcat -d -s lynx_console`, `screencap`, a grep for
that card's console prefix, and cleanup. An unknown card is a usage error
(exit 2) and never touches a device; `--dry-run` prints the whole sequence and
changes nothing. `run-stylesheet-probe.sh` remains as a thin wrapper that execs
the general script with `stylesheet`.

That runner is a reviewable command sequence, not a result. Its `--dry-run`
exits 0 for all three cards and proves the sequence is coherent without
hardware; it does not produce a stage line, and no stage line has ever been
produced on a device.

### A listener is released through the PAPI pair that filed it

`src/lynx-host.ts` attach and release used to pick their PAPI pair
independently, with different preference orders: attach preferred
`__AddEventListener` and fell back to `__AddEvent`, while detach checked
`__RemoveEventListener` first. A host exposing `__AddEventListener` but not
`__RemoveEventListener` therefore bound every listener through the listener API
and then released it through `__AddEvent`, leaving the original registration in
place. Every `removeEventListener` on such a host was a no-op, which reads as a
leak rather than as an error.

The registration now records which pair filed it and release uses that pair. When
no complete pair exists on the host, attach throws instead of filing a listener
that nothing could ever release — a host that cannot release a listener is now a
loud failure at registration time rather than a silent leak at teardown. Fixed
in `380284f`, with failing-first coverage for both halves in
`test/renderer.test.ts`; `docs/contract.md` §9 quotes the lines.

This is the renderer's own bookkeeping, verified against the fake PAPI. What a
native host does with the same two pairs is **unmeasured**, and stays listed
under "Known limitations".

### The cleanup claim is limited to what a test can prove

`ROADMAP.md`'s 1.0 box was titled "Confirm deterministic root, listener, and
stylesheet cleanup", and the third noun named a resource this renderer never
acquires. Commit `764e860` retitled it and said so: the box now confirms cleanup
of the root, listeners, refs, and list callbacks — the resources the renderer
does acquire — and moves stylesheet cleanup to an explicit statement that it is
out of the claim because nothing here loads a stylesheet.

That is a claim a reader can check, unlike a permanently open box. Two new tests
back it. `8b01d05` added "disposes the same root twice without touching the page
again" (idempotent disposal) and "keeps the recorded id across disposal so a
remounted element is styled too"; `764e860` added a `root disposal leaves nothing
behind` block whose test reads the fake PAPI's post-dispose tree rather than a
call log, so it asserts the host is left holding no page children, no live
registration, no ref, and no list row. That block is deliberately last in the
file because `docs/contract.md` and `docs/migration.md` cite the others by line
number.

`docs/contract.md` §9 is the contract and lists the mechanism and test for each
row; it also states what is **not** proven, including that a disposal issues two
flushes rather than one and that native disposal is unmeasured. `ROADMAP.md`'
retitle and `docs/capabilities.md` "Remaining blockers" carry the same position.

### A captured parity run can be verified instead of read by eye

The native smoke card's one `[solid-lynx parity] {...}` line used to be evidence
only by convention: `docs/parity-checklist.md` asked a reader to compare the
capture against the expected rows themselves, so a partial or edited report was
indistinguishable from a clean one to anyone who did not do that comparison.

`scripts/verify-native-parity.mjs` (commit `f8d2c67`) turns it into a process. It
extracts every `[solid-lynx parity]` line from a file, parses the JSON, compares
the operations against `parityOperationIds` from the built `dist/parity.js`, and
rejects any row that is not `pass` or `unsupported` with a recorded reason. It
also checks each report's own `summary` counters against its rows, so a capture
whose summary was edited or truncated is a finding rather than a pass.

Exit codes follow the discipline the rest of this repository uses: **0**
verified, **1** findings, **2** could not evaluate — where 2 covers an
unreadable file, a capture with no parity line, JSON that does not parse, and a
missing `dist/` (the message says to run `pnpm build`). A 2 is never a pass.

`test/native-parity-verify.test.ts` (19 tests, `af237ca`) drives every exit code
through a real process against `test/fixtures/native-parity/`, whose README
states that the fixtures are synthetic and are not device evidence. That
distinction matters: the verifier makes the next run recordable, it does not
manufacture a run, and nothing derived from a fixture may be written into
`docs/parity-checklist.md` as a native result.

The verifier's sibling for the stylesheet and list cards, and the resulting
change to the evidence contract, are in the Unreleased entry
"A probe capture can be verified by process, on both cards" at the top of this
file — those landed after the 1.0.0 version bump.

### The release process and the pull request checklist

Two documents that a contributor follows rather than a consumer:

- `docs/release.md` (commit `5c98160`) writes the release down as a procedure:
  the pre-flight command list that mirrors CI step for step, the version bump in
  both `package.json` and `src/index.ts`, what CI cannot check (native, §3), the
  build-and-pack step, publishing, rollback, and an explicit section on what that
  document could not itself run. Its §1 exists so a release does not re-derive
  which commands the workflow is written to run — and §7 records that no job of
  it has yet executed on GitHub Actions.
- `.github/pull_request_template.md` (commit `e73168f`) puts the same checks in
  front of every pull request as boxes to tick, including the native-evidence
  question with its three honest answers and the hand-work steps on the A03. The
  template says in as many words that a green `native-evidence` job means the
  evidence is complete and re-verifiable, **not** that native behaviour was
  measured on that PR.

Neither document is a gate by itself — the workflow is. They exist so the gate's
answer is predictable before it is run, rather than after it is red.

### Verified at this commit

Measured in this worktree at `fee7833` on Node 22.23.3 with pnpm 12.9.1. These
are snapshots of one commit, not promises about later ones: re-run the commands
and read the counts out of your own output.

- `pnpm typecheck`, `pnpm typecheck:consumer`, `pnpm test`, `pnpm build`, and
  `pnpm pack --dry-run` all exit 0.
- `pnpm test` reports **213 unit tests in 9 files**, after `pnpm build` and
  before `pnpm typecheck:consumer`: `test/renderer.test.ts` 63,
  `test/require-native-evidence.test.ts` 50,
  `test/native-probe-verify.test.ts` 41, `test/native-parity-verify.test.ts` 19,
  `test/list-probe-report.test.ts` 14, `test/parity.test.ts` 9,
  `test/stylesheet-probe-report.test.ts` 7, `test/rspeedy.test.ts` 6, and
  `test/packaging.test.ts` 4. Every one of those files is non-trivial about
  something: the renderer against the in-memory fake Element PAPI, the two
  capture verifiers, the stored-evidence requirement, the probe recorders, the
  Rspeedy plugin, and the tarball's own link graph. (That is nine files because
  `test/consumer-install.test.ts` and `test/documented-counts.test.ts` landed
  after this measurement; the suite is 228 tests in 11 files at the tip, and
  `test/packaging.test.ts` is 6 and `test/consumer-install.test.ts` 9 once the
  scoped-name assertions are counted.)
- Not unit tests, but run here on the same commit: the Lynx-for-Web suite
  (`PLAYWRIGHT_PORT=4291 pnpm web:test`) passes 17, and the pattern suite
  (`test/browser/patterns.playwright.config.ts`, port 4292) passes 9. They are
  the Chromium half of the gate, and the only part of it that needs a browser.
- `pnpm pack` produces 46 entries, 136,867 B packed and 427,422 B unpacked
  (`solid-lynx-1.0.0.tgz`). Those bytes are the ones `fee7833` packs; this
  changelog entry is itself inside the package, so the figure moves with any
  documentation edit after it.

The native runtime evidence is unchanged from 0.x: one hand run on Lynx
Explorer 4.1.0 / engine 3.5 on an SM-A037U on 2026-10-09, which **reported** the
card loading, rendering, incrementing through `bindtap`, and all twenty shared
Element PAPI operations passing. That capture was never copied out of `/tmp`, so
[docs/parity-checklist.md](docs/parity-checklist.md) records the native column as
**reported, not reproduced**. No native runtime executes in CI, and no native
card has been run since. A future run becomes citable only once its capture is
stored under `docs/evidence/native/` and the verifier for its card exits 0 on
the stored bytes.

### Known limitations

None of the following is implemented, or implemented and **not measured**. Each
statement matches [docs/capabilities.md](docs/capabilities.md),
[docs/contract.md](docs/contract.md) §15, and
[docs/session-handoff.md](docs/session-handoff.md).

This section is 1.0.0's own statement, written when nothing native had run for
that release; it is kept in that tense rather than rewritten. Two things have
moved since, and neither is an upgrade of what is said below:

1. The pending record that stood for these cards
   (`docs/evidence/native/2026-10-25-1.0.0-pending/pending.json`) was deleted in
   `85ddd12` once emulator captures existed. A pending record is not a
   measurement — the gate exits 3 for it — so deleting it changed no claim.
2. The stylesheet and list cards **have since run**, on an API 33 `x86_64`
   emulator, with captures stored and re-verified (see "The emulator runs are
   stored" above). That measures what the bindings accept and return, and that a
   list can be created, materialized, reordered by key and shrunk. It does **not**
   measure a stylesheet lifecycle (no call returned a handle), list **recycling**
   (`enqueueComponent` was never called and the card never scrolls), or anything
   on the A03.

What follows is therefore written against those limits:

- **Native stylesheet lifecycle** — not implemented. Both device inventories
  expose `__LoadStyleSheet`, `__AdoptStyleSheet`, and `__ReplaceStyleSheets`.
  Their call shape is measured on the emulator; their **lifecycle is unmeasured**,
  because no call in any card returned a stylesheet handle, so nothing in this
  release calls them. What a handle is, how one is created, adopted, or replaced
  remains unknown.
- **Native list semantics** — measured in part, and **recycling is not measured**.
  The adapter is verified against web-core, and on the emulator the card created a
  list, materialized three rows, moved them by key across a permuted model, and
  released two on a shrink. No host here has been observed to recycle a cell,
  `enqueueComponent` was never called in any stage, and
  `operationId`/`enableReuseNotification` are accepted and given no meaning. Treat
  native list **recycling** as **unverified**.
- **Native `global-bind` delivery** — unmeasured. The binding is registered and
  removed correctly, and the fake-PAPI tests cover the global dispatch pass, but
  `@lynx-js/web-core` files the handler in its own slot without running the
  global pass for function callbacks, and a native host has not been observed
  invoking it.
- **Event capture/propagation parity on native** — unmeasured. Capture, bubble,
  and catch are tested against the fake PAPI and the web host; the device run
  proved one `bindtap`, not propagation.
- **Dual-thread execution, worklets, first-screen synchronization** — not
  implemented by this renderer. Both examples build with `background: false`;
  worklets belong to Lynx's compiler and are out of scope.
- **Gesture PAPI** — not implemented. `gesture-*` props are written as plain
  attributes and never fire. This is the one documented silent failure.
- **Animation PAPI exposure** — not implemented. `__ElementAnimate` exists on
  web-core; nothing in this renderer calls it and the package exposes no
  animation API. Use inline styles and CSS transitions.
- **Portals and overlays** — not implemented. There is no `Portal`, no
  `Dynamic`, and no overlay contract; importing `Portal` fails at build time and
  `<overlay>` is an ordinary child.
- **`@lynx-js/types`** — not a dependency, so the JSX types are a bounded local
  surface and official native typings are unverified.

Also outside the covered surface at this version, per
[contract.md](docs/contract.md) §16: the page-creating branch of `createLynxRoot`,
`renderLynxPage`/`createLynxPage`/`getLynxPageId`/`createLynxHost` by name, the
exported `version` constant, `renderer.parseEventProp`, the `[handler, data]`
tuple and the `background:` namespace at dispatch time, the runtime functions of
`solid-lynx/jsx-runtime` and `solid-lynx/jsx-dev-runtime` (only their types are
exercised), and `Suspense`, `SuspenseList`, `Switch`, `Match`, `Index`, and
`ErrorBoundary`, which are re-exported but used by no test or example and are
**provisional**, not stable.

## 0.x history

`package.json` said `0.1.0` from the first commit until this release, so there
were no separately versioned `0.2`, `0.3`, or `0.4` packages. The subsections
below reproduce the [ROADMAP](ROADMAP.md) milestones those numbers name, as
built across the commits listed for each. No `0.x` version of *this* package was
released — the `0.x` milestones were development milestones that share the one
package version. (The registry's `0.0.0-stage` on 2026-10-25 is a separate puzzle:
no commit in this repository's history ever set that version, so it came from a
checkout or a temporary manifest edit that was never committed. It is a staging
entry, not a release, and the 1.0.0 entry is the artifact to read.)

### 0.1.0 — 2026-09-27, first commit

`039f355` added the Solid renderer against Lynx Element PAPI: create/replace/
insert/remove element operations, text nodes, properties, and a fake-PAPI test
seam so renderer behaviour is testable without a mobile toolchain.
`export const version = "0.1.0"` in `src/index.ts` and `package.json` were set
here and did not change again until 1.0.0. `a858cf7` (2026-09-28) added the
roadmap.

### 0.2 — Lynx-for-Web integration (2026-10-01 to 2026-10-03)

A browser path so renderer development does not need a device, preserving Lynx
semantics rather than substituting the DOM.

- `f44570b` (2026-10-01) added the `<lynx-view>` / `@lynx-js/web-core/client`
  host smoke fixture.
- `e40d1c5` (2026-10-02) built and loaded a real Solid TSX `.web.bundle` through
  `pluginLynx`, `pluginVanillaLynx`, and the web encoder.
- `1d05efd` added keyed web reconciliation coverage.
- `64ffd33` fixed event binding: colon forms such as `capture-bind:tap` and
  `global-bind:tap` had fallen through to `__SetAttribute`, and namespaced
  bindings shared a slot with their plain form. Registrations now carry the
  namespace and receive matching `__AddEventListener`/`__RemoveEventListener`
  options, and listeners are bound to tree membership.
- `6a5e973` completed 0.2 coverage; `8a157ad` added capture/bubble/catch,
  handler replacement and removal, and isolated roots. Disposal now releases only
  the nodes a root rendered instead of clearing its page, so roots sharing a page
  no longer tear each other down, and a disposed root can be rendered into again
  with fresh listeners.

### 0.3 — Native parity, tooling, and types (2026-10-03 to 2026-10-08)

- `036a442` added `pluginSolidLynx` (`solid-lynx/rspeedy`) and
  `runElementPapiParity` (`solid-lynx/parity`), a probe reporting pass, fail, or
  unsupported per Element PAPI operation.
- `882d0b5` replaced broad intrinsic JSX types with the bounded Lynx surface and
  added consumer fixtures that compile `jsx-runtime` and `jsx-dev-runtime`
  against the built `dist/`.
- `94d8239` wired the reusable tooling and parity checks into the examples and
  build documentation.
- `cb18960` (2026-10-06) made the native card render on Lynx Explorer 4.1.0 by
  fixing two defects: native PrimJS element handles report `typeof "unknown"`, so
  creators are now validated with `isLynxNode()`, and `__GetPageElement()`
  returns `null` until `__CreatePage()` is called, so the example now creates the
  page. The run those fixes produced was on 2026-10-09, three days after this
  commit: on an SM-A037U it **reported** all twenty shared Element PAPI
  operations passing (`docs/parity-checklist.md`). That capture was not kept, so
  the native column is `reported`, not `pass` — see "Known limitations".
- `e797873` (2026-10-08) added `docs/session-handoff.md`.

The native-only 0.3 item — dual-thread execution, worklets, and first-screen
synchronization — was never verified and stays open in `ROADMAP.md`; the device
run still shows a `processData is not a function` banner from the
main-thread-only build's empty `/app-service.js`.

### 0.4 — Platform capabilities (2026-10-03, extended 2026-10-24)

- `62720ba` added the capability probe and the `examples/lynx-patterns` card
  (forms, keyed lists, asynchronous content), measuring capabilities instead of
  assuming them, plus `docs/capabilities.md`.
- `0d1a715` added owner-scoped refs and root-scoped CSS ids (see 1.0.0 above).
- `bf0293d` reconciled the capability status in the docs and roadmap.
- `2bcac14` (2026-10-24) added the indexed list row model and the stylesheet
  probe card with its host-free recorder test; `544e36e` and `faca97c` added
  the runner for it, and `d8562dd` added the list probe card and
  `test/list-probe-report.test.ts`.

Two 0.4 items remain open: integrating stylesheet loading/lifecycle, and native
validation of the list adapter. Their position is unchanged by this release.
