# Changelog

`solid-lynx` is a Solid renderer for Lynx Element PAPI.

This file records what each version actually contains. Dates are the commit
dates of the change that produced them in this repository's history, not release
or publish dates. The documented promises live in
[contract.md](docs/contract.md) — where a statement here and the contract
differ, the contract wins.

Release status: `package.json` and the exported `version` constant in
`src/index.ts` say `1.0.0`. This repository has no git tags and no publish
workflow (`package.json` has no `publishConfig`, `.github/workflows/` contains
only `ci.yml`), so nothing here was published by these commits. The npm name
`solid-lynx` currently resolves to an unrelated package (MIT licence, a different
maintainer, published 2025-03-10); this project ships Apache-2.0.

## Unreleased

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
device run happened, so `ROADMAP.md` box 4 stays unticked and
`docs/capabilities.md` still records both probes as "has not been run". The new
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
missing or mismatched evidence, 2 is could not evaluate. (A third form,
`pending.json`, arrives in the entry below — at this commit the contract is still
two.)

It is wired in as the `native-evidence` CI job over
`pull_request.base.sha..HEAD`, and on `push` / `workflow_dispatch` it prints that
there is no PR base and passes rather than evaluating a range that would mean
nothing. `docs/evidence/native/README.md` documents the record contract and
`docs/evidence/native/TEMPLATE/manifest.json` is a capture-less template the
script rejects as evidence by name. 33 host-free tests build their own git
repositories in `mkdtemp`, so the suite needs no device, no network, and not this
repository's git state. (It is 50 at this commit, after the probe-capture entry
above added eight cases for the per-card verifier and the pending-record entry
below added nine.)

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

This release uses it for real. `docs/evidence/native/2026-10-25-1.0.0-pending/`
holds three records — one each for the smoke, stylesheet, and list cards — that
between them name all 22 native-facing paths of the release range and the A03 the
runs are waiting on. On that range the gate now reports `verdict: pending` and
exits 3 instead of reporting a dodge that did not happen. Nine host-free tests
cover the new form through throwaway `git init` repositories: full coverage exits
3 with the warning text, one path missing exits 1, a capture wins with exit 0, a
decision and the template behave exactly as before, a shrug `blocked_by` is
rejected, two records in one directory are rejected, a broken record beside a
pending one stays exit 1, a split record set is judged as a union, and a record
from outside the range covers nothing.

What did not change: what any document claims was measured. The stylesheet and
list cards still have not run, `docs/capabilities.md` still says so, and the
native column of `docs/parity-checklist.md` is still `reported`, not reproduced.
The new record says that more loudly, not less.

## 1.0.0 — 2026-10-24

The first stable release. It freezes the public contract, pins the dependency set
the contract was verified against, and adds the automation and the native
measurement instrumentation that the contract requires.

### The published package carries the documentation it links to

`package.json` `files` was `["dist", "README.md", "LICENSE"]`, so the tarball's
README linked to the contract, the compatibility ranges, the migration guide,
the capability matrix, the changelog and the roadmap nine times across thirteen
links, and every one of those targets was absent from the package. The links
resolved from a repository checkout and were dead for anyone who installed from
npm.

`files` is now
`["dist", "docs", "CHANGELOG.md", "README.md", "ROADMAP.md", "LICENSE"]`, which
grows the tarball from 33 entries / 37,168 B packed / 128,510 B unpacked to 43
entries / 112,941 B packed / 355,712 B unpacked — 75 KiB more over the wire, for
a README whose links all work. `docs/` ships whole rather than as the four consumer-facing
documents, because the shipped docs cross-link `building.md` and
`parity-checklist.md`; an explicit four-file list left fifteen second-hop links
dangling. Three links in `docs/` pointed at repository-only probe scripts under
`examples/`; they are plain code spans now, and the `version` constant cited in
`docs/contract.md` was corrected from `0.1.0` to `1.0.0`.

`test/packaging.test.ts` keeps it honest without a network or a device: it asks
`pnpm pack --dry-run --json` for the real file list and fails when a relative
link in a shipped markdown file resolves to a file that is not shipped, escapes
the package root, or names a heading that does not exist. Run against the old
`files[]`, it reports all nine dead README targets by file and line.

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
`docs/compatibility.md` §8 states what the ranges do **not** claim: CI runs one
Node version on one toolchain set, so it repeats the local gate rather than
widening the supported set.

### Migration and compatibility guidance

`docs/migration.md` (commit `002b786`) is the upgrade guide from a `0.x` build:
refs, CSS ids, event props, JSX types, the list API, root lifecycle, and an
explicit table of what deterministic cleanup proves and what it does not.

### Continuous integration

`.github/workflows/ci.yml` (commit `a7d225c`) runs on `pull_request`, on `push`
to `master`, and on `workflow_dispatch`, with five jobs:

| Job | Steps |
| --- | --- |
| `unit` | `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm typecheck:consumer`, `pnpm test`, `pnpm build`, `pnpm pack --dry-run` |
| `node-matrix` | The unit gate on `20.x`, `22.x`, `24.x` |
| `solid-matrix` | The unit gate plus `pnpm web:build` with `solid-js` 1.9.16 and 1.9.17 overlaid on the pins, on `needs: unit` |
| `browser` | Chromium install, then the Lynx-for-Web suite (`PLAYWRIGHT_PORT=4186 pnpm web:test`) and the pattern suite (`PLAYWRIGHT_PORT=4200`, `test/browser/patterns.playwright.config.ts`) |
| `native-build` | `pnpm native:build`, uploading `examples/lynx-for-native/dist` |

`native-build` compiles the bundle and attaches no device or emulator, and the
workflow's own header comment says so: native runtime behaviour is still verified
by hand. `solid-matrix` is what puts a run behind the `^1.9.15` peer range — it
was green locally on both legs before it was added, but has not yet run on GitHub
Actions. How the overlay works, and the two `pnpm add` routes that were tried and
failed, are in [compatibility.md](docs/compatibility.md) §2.

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

- `examples/lynx-for-native/src/stylesheet-probe.ts` (commit `544e36e`) logs one
  `[solid-lynx ss]` line per stage and calls only operations that cannot mutate
  the card: `__LoadStyleSheet`, `__AdoptStyleSheet`, `__ReplaceStyleSheets`.
- `examples/lynx-for-native/src/list-probe.ts` (commit `d8562dd`, built as
  `dist/list-probe.lynx.bundle` by `pnpm native:build`) logs one
  `[solid-lynx lp]` stage line per step and reports the list-named globals, the
  created handle, materialized children, keyed identity across a permuted model,
  and whether the host ever called `enqueueComponent`.

Both are built by `pnpm native:build`; neither has been run on a device, so they
**measure nothing yet**.

### Verified at this commit

Observed in this repository on Node 22.23.3 with pnpm 12.9.1:

- `pnpm typecheck`, `pnpm typecheck:consumer`, `pnpm test`, `pnpm build`, and
  `pnpm pack --dry-run` all exit 0.
- `pnpm test` reports **154 unit tests in 8 files** (`test/renderer.test.ts` 62,
  `test/require-native-evidence.test.ts` 33,
  `test/native-parity-verify.test.ts` 19, `test/list-probe-report.test.ts` 14,
  `test/parity.test.ts` 9, `test/stylesheet-probe-report.test.ts` 7,
  `test/rspeedy.test.ts` 6, `test/packaging.test.ts` 4), after
  `pnpm build` and before `pnpm typecheck:consumer`.
- The native runtime evidence is unchanged from 0.x: one hand run on Lynx
  Explorer 4.1.0 / engine 3.5 on an SM-A037U, where the card loads, renders,
  increments through `bindtap`, and passes all twenty shared Element PAPI
  operations (`docs/parity-checklist.md`). No native runtime executes in CI.

### Known limitations

None of the following is implemented, or implemented and **not measured**. Each
statement matches [docs/capabilities.md](docs/capabilities.md),
[docs/contract.md](docs/contract.md) §15, and
[docs/session-handoff.md](docs/session-handoff.md).

The two device-run items below say "has not been run on a device" and "no device
run", and that is still exactly true: this release ships the cards, the checker,
and `docs/evidence/native/2026-10-25-1.0.0-pending/pending.json`, which records
that the runs are blocked on an unattached A03. A pending record is not a
measurement — the gate exits 3 for it — so nothing in this section improves.

- **Native stylesheet lifecycle** — not implemented. The A03 device exposes
  `__LoadStyleSheet`, `__AdoptStyleSheet`, and `__ReplaceStyleSheets`; their
  signatures and lifecycle are **unmeasured**, so nothing in this release calls
  them. The stylesheet probe card that would measure them has not been run on a
  device.
- **Native list semantics** — not measured. The adapter is verified against
  web-core only. No device run has created a list or called either list
  callback, no host here has been observed to recycle a cell, and
  `operationId`/`enableReuseNotification` are accepted and given no meaning.
  Treat native list support as **unverified**.
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
built across the commits listed for each. No `0.x` build was published.

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
  page. With those fixed, all twenty shared Element PAPI operations passed on an
  SM-A037U (`docs/parity-checklist.md`).
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
- `2bcac14` (2026-10-24) added the indexed list row model and the stylesheet and
  list probe cards with their host-free recorder tests.

Two 0.4 items remain open: integrating stylesheet loading/lifecycle, and native
validation of the list adapter. Their position is unchanged by this release.
