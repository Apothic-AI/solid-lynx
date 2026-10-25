# Fresh Session Handoff

Read this file first when resuming development in a fresh agent session — it is
the orientation document, not a changelog. Nothing here is specific to one
harness; the commands are prose and shell.

## Repository State

- Repository: `/home/bitnom/Code/solid-lynx` (`master`), plus per-tranche git
  worktrees under `/home/bitnom/Code/solid-lynx-wt/`. Work in the worktree you
  were given: it sits on its own `wt/...` branch.
- Version is `1.0.0` in `package.json` and `src/index.ts`, and the contract is
  frozen in [contract.md](contract.md). Check `git status --short --branch` and
  recent commits before editing, because `master` moves under a worktree while
  other tranches land.
- Nothing is tagged or published: no git tag exists and no workflow publishes
  ([release.md](release.md) §5). The manifest's `name` is
  `@apothic-ai/solid-lynx` with `publishConfig.access: "public"`; the unscoped npm
  name is occupied by an unrelated package, which is why the scope exists — see
  "Remaining Work".
- No changes from this work have been pushed. `git rev-list --count
  origin/master..master` is the number of commits sitting on `master` that no
  remote has, which is also how far ahead of `origin/master` a worktree branch
  starts.
- Do not amend or rewrite the existing commits. Continue with new commits.

Recent milestone commits (newest first, all on `master`):

- `fee7833` gave a pending native run its own outcome (exit 3) and recorded this
  release's pending evidence; `1fe3814` the three pending records themselves.
- `c5cd5a1` the probe verifier, so a `[solid-lynx ss]`/`[solid-lynx lp]` capture
  can be checked by process; `f8d2c67` the same for the parity capture.
- `764e860` claimed the cleanup this renderer can prove and said what it cannot;
  `8b01d05` idempotent disposal and CSS-id survival across a remount;
  `380284f` released a listener through the PAPI pair that filed it.
- `12eeee6`, `737ecd5`, `88141f0`, `427aeb7`, `e383722`, `0044bcc`, `d87d486`
  the stored-evidence requirement: contract, template, CI job, decision records
  that must cover the whole change, and the structural workflow judgement.
- `e68eb0a` shipped the documentation the README links to (the tarball now
  carries `docs/` whole); `56b402c` and `dd907cd` the `solid-matrix` and
  `node-matrix` jobs; `9d3f22f` reconciled the five open roadmap boxes.
- `faca97c` one native probe runner for all three cards.
- `d8562dd` native list measurement card; `2bcac14` the indexed list row model
  and the stylesheet probe card with their recorder tests.
- `0d77793` contract frozen; `5ecace6` versions pinned; `002b786` migration and
  compatibility guidance; `a7d225c` CI workflow; `5c98160` release process;
  `e73168f` the PR template.
- `cb18960` native page creation and PrimJS handle compatibility. The device run
  it enabled happened on 2026-10-09, three days later.
- `bf0293d` 0.4 capability documentation and roadmap reconciliation.
- `0d1a715` owner-cleaned refs and root-scoped CSS ids.
- `62720ba` platform capability probe and forms/keyed-list/async example.
- `94d8239`, `882d0b5`, `036a442` reusable Rspeedy plugin, PAPI parity harness,
  build docs, and typed JSX consumer fixtures.
- `8a157ad`, `6a5e973`, `64ffd33`, `1d05efd` completed browser lifecycle, PAPI
  property, event, and keyed reconciliation coverage.

## Verified Checks

Every command below was run in the `wt/handoff` worktree at commit `c81824d` on
Node `v22.23.3` / pnpm `12.9.1`, with the results in the comments. Every one
exited 0. **Re-run them and read the counts out of your own output rather than
out of this file** — these numbers are a snapshot of one commit, and the suite
grows. If you are on a later commit and a count here disagrees with yours, yours
is correct; that is not a regression, it is the file being older than you.

```bash
pnpm typecheck                     # exit 0
pnpm typecheck:consumer            # exit 0; test/consumer/tsconfig.json + tsconfig.dev.json
pnpm test                          # exit 0; 228 tests in 11 files, after `pnpm build`
                                   #   and before `typecheck:consumer`:
                                   #   renderer 63, require-native-evidence 50,
                                   #   native-probe-verify 41, native-parity-verify 19,
                                   #   list-probe-report 14, parity 9,
                                   #   consumer-install 9, stylesheet-probe-report 7,
                                   #   rspeedy 6, packaging 6, documented-counts 4
pnpm build                         # exit 0
pnpm pack --dry-run                # exit 0; 46 tarball entries (30 under dist/, 11 under docs/,
                                   #   plus LICENSE, package.json, README.md, CHANGELOG.md,
                                   #   ROADMAP.md) as apothic-ai-solid-lynx-1.0.0.tgz
pnpm native:build                  # exit 0; dist/main.lynx.bundle,
                                   #   dist/stylesheet-probe.lynx.bundle,
                                   #   dist/list-probe.lynx.bundle (+ probe.css beside them)
PLAYWRIGHT_PORT=4321 pnpm web:test # exit 0; 17 browser tests
PLAYWRIGHT_PORT=4322 pnpm exec playwright test \
  --config test/browser/patterns.playwright.config.ts
                                   # exit 0; 9 tests
```

The per-file counts above were parsed from
`pnpm exec vitest run --reporter=json --outputFile=<file>`, not from counting
`it(` calls or reading the default reporter — so they are the assertion results
vitest actually recorded, including any parameterised cases.

**A stale count is now a test failure.** `test/documented-counts.test.ts` measures
the suite with vitest's own collection pass and fails, naming the file, the line,
the number written and the number measured, when any document that states this
suite's size disagrees with it — so the numbers above do not have to be hunted by
hand when a test file is added. If you are reading this file on a later commit,
that test's message is the authoritative correction; a number here that it has not
flagged is either current or explicitly framed as historical.

`pnpm typecheck` and `pnpm test` both run `pnpm build` first, and `pnpm test`
ends with `pnpm typecheck:consumer` (`package.json`), so a failure in those
steps can surface under the earlier command name. The `pnpm pack --dry-run`
entry count moves whenever a document is added to or removed from `docs/`, since
`files` ships the whole directory; treat 46 as this commit's number, not a
constant.

**The two browser suites take minutes, and running suites concurrently makes
the pattern suite flaky.** Cold Vite dependency optimization plus Lynx wasm
start-up dominates, each suite has its own `webServer` build and serve step, and
the same suite varied from **43s to 1.2m across back-to-back runs in one
session** with no code change between them. That spread is why the counts above
are stated without timings: the pass count is the claim, the wall clock is not.
Do not read a slow first test as a regression — both suites already retry once
after a reload for exactly this reason (`test/browser/patterns.test.ts`,
`test/browser/lynx-for-web.test.ts`).

Observed by an earlier session and carried forward because it recurs, worth
recognising rather than debugging: while a second agent ran the pattern suite in
another checkout at the same time, that run failed the
`indexed list model › re-installs the callbacks on a model change and releases
rows that left` test with `the pattern card never rendered` and
`page errors: none`, `console errors: none`, `failed requests: none` — i.e. the
30s render-poll timed out with a clean page, not a page error. That is a
concurrency/load artifact of running several suite+agent combinations at once,
not a product bug. Re-run the suite on its own and it passes 9/9; if you see
that message, check what else is running (`ps aux | grep -i playwright`, and
whether another checkout holds a port) before you change any code.

**The only device evidence in this tree is the 2026-10-09 A03 run**, and its
capture is gone. It *reported* all 20 shared Element PAPI parity operations
passing, the native card rendering, and a `bindtap` counter update;
[parity-checklist.md](parity-checklist.md) therefore marks the native column
`reported`, not reproduced. Nothing native has been re-run for `1.0.0`: at this
commit `adb -s R9WT911JVVH get-state` prints
`error: device 'R9WT911JVVH' not found` and exits 1, which is recorded in
`docs/evidence/native/2026-10-25-1.0.0-pending/pending.json` as work unit
`ub_y33g9p`. Do not restate that run as a present-tense pass.

## How to check the claims in this repository

This is the part that used to be scattered across three documents. Three
commands carry almost every claim worth checking, and they are all host-free —
no device, no adb, no network.

### 1. Verify a native capture

A stored native log is read by one of two verifiers, chosen by **which card
produced it**. They are not interchangeable: each exits 2 on the other's bytes,
so a mismatched pairing fails loudly instead of passing through whichever
verifier happened to understand the file.

| Card | Console prefix | Verifier |
| --- | --- | --- |
| `smoke` | `[solid-lynx parity]` | `scripts/verify-native-parity.mjs` |
| `stylesheet` | `[solid-lynx ss]` | `scripts/verify-native-probe.mjs` |
| `list` | `[solid-lynx lp]` | `scripts/verify-native-probe.mjs` |

```bash
node scripts/verify-native-parity.mjs <capture.log>   # smoke card only
node scripts/verify-native-probe.mjs <capture.log>    # stylesheet and list cards
```

The parity verifier requires every operation in `parityOperationIds` from the
built `dist/parity.js`, so **run `pnpm build` first** or it exits 2. The probe
verifier reads only the text file, so a missing build cannot make it misjudge a
probe capture.

### 2. Check the evidence requirement over a diff range

```bash
node scripts/require-native-evidence.mjs --range <base>..HEAD
```

This is the command the `native-evidence` CI job is wired to run over a pull
request (`pull_request.base.sha..HEAD`) — **the job itself has not run on GitHub
Actions yet**. It decides whether the diff touches
native-facing code, then looks for a committed record that satisfies the
requirement. It reads git and the filesystem only, so running it by hand gives
the same answer the job would.

### 3. Read the exit codes correctly

Both capture verifiers and the evidence gate use the same 0/1/2 discipline, and
the evidence gate adds a fourth code. **A 2 is never a pass and neither is a 3.**

| Code | Capture verifiers | `require-native-evidence.mjs` |
| --- | --- | --- |
| **0** | verified — every required stage/operation present and passing | satisfied — nothing native-facing changed, or a capture verified, or a decision record covers it |
| **1** | findings — the capture was read and contradicts itself or the card | missing evidence — a native-facing change with nothing satisfying it |
| **2** | could not evaluate — nothing trustworthy to read | could not evaluate — git or the range failed, or a stored capture verifier exited 2 |
| **3** | *not used* | pending, not a pass — every native-facing path is covered by a committed `pending.json`, so the record set is complete and honest, but no run has happened |

**3 is the code people misread.** It means the requirement is unmet *and the
change says so*: not a green tick, and not a dodge either (that is 1). It exists
so a release blocked on hardware cannot be reported as though somebody skipped
the paper work. The `native-evidence` job turns 3 into a workflow warning
annotation and a job-summary block rather than a failure, so a red
`native-evidence` job always means missing or unreadable evidence — but a green
one with a `pending.json` in the range means **nothing was measured**. Read the
annotation before trusting the tick.

This repository is in exactly that state right now:

```console
$ node scripts/require-native-evidence.mjs --range origin/master..HEAD
... verdict: pending — every one of this change's 22 native-facing path(s) is
    covered by a recorded pending run, and nothing was verified as a pass ...
$ echo $?
3
```

### The rest of the surface

- Platform capability status, per host: [capabilities.md](capabilities.md). Its
  summary table is the authority; a `not measured` there is not a soft "TODO".
- What a stored record must contain: [evidence/native/README.md](evidence/native/README.md).
  It also states the forgery this check *cannot* catch, which is worth reading
  before quoting any capture.
- The frozen public contract and what has no test: [contract.md](contract.md)
  §15 (outside the contract) and §16 (coverage gaps).
- Which versions were actually run, and on which axis: [compatibility.md](compatibility.md).
  §8 is the list of things the pins do **not** claim.

## Native Device

The only permitted device for this project's current native smoke is the Galaxy
A03, serial `R9WT911JVVH` (SM-A037U, Android 13/API 33). The tablet serial
`19779010` is in use by another agent: never target it, enumerate devices as an
automation shortcut, or use an ADB command without `-s R9WT911JVVH`.

Official Lynx Explorer 4.1.0 (`com.lynx.explorer`, engine 3.5) is installed on
the A03. It was downloaded from the official Lynx release and verified against
SHA-256 `6ae29787a2166974c29c2f23d87f3b20a137abcf9a8c17903ad19f3fb7f00cb6`.
The install details and safe rerun commands are in [building.md](building.md).
Do not install ArtemisAccessibilityHelper for Lynx bundle loading; it is not a
Lynx host.

Native root behavior established by the device run:

- `__GetPageElement()` is null until a page is created.
- `__CreatePage("0", 0)` creates the page used by the native example and parity
  harness.
- Native PrimJS element handles report `typeof === "unknown"`; the host now
  validates handles without requiring JavaScript `typeof "object"`.
- Native inline styles read back through `__GetInlineStyles`.
- Explorer shows a `processData is not a function` banner for the main-thread-only
  empty `/app-service.js`; it does not prevent render or tap behavior.

Always clean up only the test resources created on the A03: stop the temporary
HTTP server and remove its reverse port. Do not switch users, alter settings,
reboot, or install other packages unless the user explicitly requests it.

## Remaining Work

The authoritative checklist is [ROADMAP.md](../ROADMAP.md) — it has exactly two
unticked boxes — and detailed platform evidence is in
[capabilities.md](capabilities.md). Two blockers sit behind those boxes, and
neither is resolvable from a fresh session's shell.

### The two open roadmap boxes

**1. `ROADMAP.md:102` — "Integrate stylesheet loading, CSS ids, and stylesheet
lifecycle where the Lynx PAPI requires it."** Open on the runtime half only. The
CSS-id half is done (`root.setCSSId()` drives `__SetCSSId`, covered by
`test/renderer.test.ts` and `docs/contract.md` §8). Runtime stylesheet
loading/lifecycle is open for two different reasons, and they are not the same
size:

- *Absent on web.* `@lynx-js/web-core` 0.26.2 exposes no PAPI that adds,
  replaces, or removes a stylesheet. Integrating there would mean inventing an
  API the host does not have.
- *Unmeasured on native.* The A03 exposes `__LoadStyleSheet`,
  `__AdoptStyleSheet`, and `__ReplaceStyleSheets` — the inventory was observed —
  but their signatures and lifecycle were never exercised. **Do not infer
  support from names alone.** The probe card that would measure them is built and
  unit-tested and has never run.

**2. `ROADMAP.md:33` — "Verify native-only behavior such as dual-thread
execution, worklets, and first-screen synchronization."** Open *by decision*, and
it will not close. It is scope-excluded, not pending work: it asks this renderer
to verify behaviour the renderer does not own. Worklets are compiled and
scheduled by Lynx's build pipeline and nothing in `src/` names a worklet API;
dual-thread execution is a build configuration, and every card here declares
`background: false`. A tick would claim a verification that cannot happen in
this repository. `ROADMAP.md` records the exclusion and `docs/contract.md` §15
carries the same position — do not "finish" this box.

### The A03 blocker

Both native probe cards and the smoke card are waiting on hardware. The state,
as recorded in this tree and not re-run here (this worker had no device and ran
no adb):

```console
$ adb -s R9WT911JVVH get-state
error: device 'R9WT911JVVH' not found
$ echo $?
1
```

That dependency is recorded as work unit **`ub_y33g9p`** in
`docs/evidence/native/2026-10-25-1.0.0-pending/pending.json`. `docs/evidence/native/`
holds three pending records there — one each for `smoke`, `stylesheet`, and
`list` — covering all 22 native-facing paths of this release's range.
**The gate's verdict on that range is exit 3, "pending, not a pass", not 0.**
That is the correct answer, not a failure of the paperwork: nothing was measured.

- **The stylesheet and list probes are built, unit-tested, and unmeasured.**
  `examples/lynx-for-native/src/stylesheet-probe.ts` and
  `examples/lynx-for-native/src/list-probe.ts` both build through
  `pnpm native:build` (`dist/stylesheet-probe.lynx.bundle`,
  `dist/list-probe.lynx.bundle`) and their recorders are covered by host-free
  tests (`test/stylesheet-probe-report.test.ts` 7 tests,
  `test/list-probe-report.test.ts` 14 tests). **No device run of either card
  exists.** Until those runs exist, the three stylesheet operations are known to
  exist and nothing else about them is known, and native list behavior is
  unverified — no host has been seen to recycle a cell.
- **One runner drives all three cards:**
  `examples/lynx-for-native/scripts/run-native-probe.sh`, taking the card as its
  argument (`smoke`, `stylesheet`, `list`; the bundle stems `main`,
  `stylesheet-probe`, `list-probe` are accepted too). It is pinned to
  `R9WT911JVVH`, never enumerates devices, and refuses to run if
  `DEVICE_SERIAL`, `ADB_SERIAL`, or `ANDROID_SERIAL` names another device. The
  old `run-stylesheet-probe.sh` remains as a thin wrapper that execs it with
  `stylesheet`. `--dry-run` prints the sequence and touches nothing; all three
  dry runs exited 0 here. A real run that captures no line for the card's prefix
  exits 5 and points at the log and screenshot instead of reporting a result, so
  an empty capture cannot be read as a measurement. A dry run is still not a
  device result.

### The package-name blocker: resolved by scoping

The unscoped npm name `solid-lynx` is occupied by an unrelated package. Measured
with `npm view solid-lynx version license maintainers`: version `1.0.0`, license
**MIT**, maintainer `pranshuchittora`. This project ships Apache-2.0 and is not
that package, so publishing under that name was never available.

The operator resolved it by publishing under the npm organisation `@apothic-ai`,
so `package.json` `name` is **`@apothic-ai/solid-lynx`** with
`publishConfig.access: "public"` (a scoped package defaults to `restricted`). The
rename is confined to module specifiers and registry identity: the
`jsxImportSource`s, the `moduleName` default in `src/rspeedy.ts`, the example
imports, the consumer fixture augmentations, and the contract's entry-point table.
The repository, the docs prose, and the worktree and branch names still say
solid-lynx when they name the product. `test/packaging.test.ts` and
`test/consumer-install.test.ts` assert the scoped name, the public access, the
tarball filename, and that the bare unscoped specifier no longer resolves — so a
revert fails a test instead of silently changing the published identity.

There are still no git tags and no release workflow, and nothing here has ever
been published ([release.md](release.md) §5). Do not treat a version bump as a
release.

### Native parity evidence is reported, not reproduced

The twenty shared Element PAPI operations were recorded from the A03 on
2026-10-09 and that capture is gone, so the column stays `reported`. Two
verifiers now make the *next* run checkable — `scripts/verify-native-parity.mjs`
for a `[solid-lynx parity]` capture, `scripts/verify-native-probe.mjs` for the
stage-line cards — and `scripts/require-native-evidence.mjs` re-runs the right
one against a stored capture over every pull request. What that buys is a
re-checkable next run, not a recovered 2026-10-09 result: **do not describe the
recorded column as verified by a script.** See "How to check the claims" above
for which verifier reads which card and what each exit code means.

### Still unmeasured or unimplemented

- Native `global-bind` delivery, event propagation/capture parity, CSS-id
  execution, and runtime stylesheet PAPI semantics remain unmeasured.
- The web host does not implement runtime stylesheet loading/lifecycle. It has no
  corresponding stylesheet PAPI.
- Web-core global-bind callbacks are registered but its global dispatch pass does
  not invoke function callbacks; this host limitation is documented.
- The renderer has a list adapter and an indexed row model (`root.createList()`),
  measured against web-core only. A 2026-10-09 A03 smoke rendered the existing
  native card and verified its counter tap from 0 to 1; that card did not create
  a list or exercise either list callback, so native list behavior remains
  unverified. No host has been seen to recycle a cell.
- Gesture PAPI functions are web-core no-op stubs; animation PAPI exists but is
  not exposed by the renderer; overlays/portals are not implemented.
- `@lynx-js/types` is not installed/resolvable in this package; current JSX types
  are a bounded local surface, not an exhaustive official native schema.

## Current Tranche

The tranche that produced `1.0.0` is closed on documentation and automation. What
landed, and where to read it:

- **Contract frozen.** [contract.md](contract.md) records every public signature
  with a status (stable, provisional, unsupported) and the test that covers it;
  §16 lists the exported surface with no automated test. Line 3 now names
  `@apothic-ai/solid-lynx@1.0.0`; it said `solid-lynx@0.1.0` for a release, which
  was documentation drift. The `version` paragraph is correct — it cites `"1.0.0"`
  at `src/index.ts:72`, which is what the constant says — as are `package.json`
  and README's status line. The constant is authoritative and no test asserts it
  (contract §16), so a version bump still has to be checked by hand.
- **Compatibility pinned.** [compatibility.md](compatibility.md) fixes the exact
  `solid-js`, `@lynx-js/web-core`, `@lynx-js/rspeedy`, `@lynx-js/lynx-core`, and
  Rsbuild plugin versions the contract was verified against, and §8 states what
  the pins do not claim (the Node and Solid ranges in CI, no native runtime in
  CI).
- **Migration guide.** [migration.md](migration.md) is the `0.x` → frozen
  contract upgrade path: refs, CSS ids, event props, JSX types, the
  `<list>` → `root.createList()` move, root lifecycle.
- **CI and PR template.** `.github/workflows/ci.yml` defines six jobs (`unit`;
  `node-matrix`, standing alone; then `solid-matrix`, `browser`, `native-build`,
  and `native-evidence`, all `needs: unit`); `.github/pull_request_template.md`
  repeats the same checks and states the native evidence requirement.
  **No workflow has executed on GitHub Actions for any commit in this
  repository** — `gh run list` returns no runs and `ci.yml` is not on
  `origin/master` — so the workflow is defined, statically parsed, and locally
  replayed, not exercised. That is why the 1.0 box about CI verification is
  unticked. `native-build` compiles the native bundle and **executes nothing
  native**; `native-evidence` is written to enforce that a native-facing change
  carries a stored, verifier-passing
  capture, an explicit recorded decision, or a recorded *pending* run
  (`docs/evidence/native/README.md`). The verifier is chosen by the manifest's
  `card`: parity for `smoke`, probe for `stylesheet` and `list`. A pending record
  exits 3 rather than 0, and the job is written to surface that as a warning
  annotation — see "How to check the claims" above for the full code table.
- **Release process and 1.0.0.** [release.md](release.md) is the cut order with
  the command behind each step; [CHANGELOG.md](../CHANGELOG.md) carries the
  `1.0.0` entry, and `package.json` and `src/index.ts` both say `1.0.0`. Nothing
  is tagged or published ([release.md](release.md) §5).

[ROADMAP.md](../ROADMAP.md) records the milestone honestly: **four of the five
`1.0` items are ticked and one is not.** The unticked one is "Define supported
Lynx and Solid version ranges and verify them in CI" — the ranges are defined
and their commands pass locally, but no workflow has ever run on GitHub Actions,
so the "in CI" half is unearned and the tick was withdrawn. Nothing else is
needed for it but a push. The cleanup box that used to stay open was retitled
rather than ticked as written: its third noun was stylesheet cleanup, which this
renderer cannot claim because it never loads a stylesheet; the box now claims
cleanup only for the resources it acquires (root, listener, ref, list callback)
and says where the stylesheet half went. Both the capability and the native
measurement remain open elsewhere and are recorded as such: native list and
stylesheet behavior still need a device run.

The two blockers behind the open boxes — the A03 (`ub_y33g9p`) and the package
name (`ub_frxxn5`) — are detailed under "Remaining Work" above. Neither is
resolvable from a fresh session's shell.

## Resume Procedure

1. Check `git status --short --branch` and recent commits before editing.
2. Read [ROADMAP.md](../ROADMAP.md), [building.md](building.md), and the relevant
   capability/parity sections before claiming a milestone complete.
3. For Android work, load the `artemis-android-multi-user` skill and use only
   `R9WT911JVVH` with explicit `adb -s` targeting.
4. Preserve existing user work, add focused tests, run the relevant checks, and
   commit only when requested or explicitly delegated. Never push unless asked.
5. Before you finish a tranche, run the gate over your own diff:
   `node scripts/require-native-evidence.mjs --range <base>..HEAD`. A docs-only
   change reports `nothing to require` and exits 0. Exit 1 means you changed a
   native-facing path with no record; exit 3 means the range contains a
   `pending.json` that covers it. Either way, report the code you got rather
   than working around it — do not write a `decision.json` for a change that
   really needs a run.
