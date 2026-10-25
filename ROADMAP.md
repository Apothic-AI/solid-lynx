# Roadmap

This roadmap describes the intended direction for `solid-lynx`. Milestones are ordered by dependency and confidence, not by release date. Version labels are planning targets, not release promises.

## 0.2: Lynx-for-Web integration

Establish a browser-based Lynx runtime path so renderer development does not depend on access to a physical device. The browser target must preserve Lynx semantics instead of replacing the host with ordinary DOM rendering.

- [x] Add a browser fixture using `@lynx-js/web-core/client` and `<lynx-view>`.
- [x] Build and load a real Solid TSX `main.web.bundle` through `pluginLynx`, `pluginVanillaLynx`, and the web encoder.
- [x] Verify initial Solid rendering, both event props, reactive class/style updates, dataset reads, and disposal in the full automated browser suite.
- [x] Exercise page creation, mounting, text updates, insertion, removal, and reordering in the browser runtime.
- [x] Verify attribute, style, dataset, boolean-property, and flush behavior against the web PAPI implementation.
- [x] Test event dispatch, propagation, capture, global bindings, namespaced handlers, replacement, and removal in a browser.
- [x] Add Playwright coverage for bundle loading, Solid rendering, reactive properties, event handlers, and disposal.
- [x] Make root disposal detach event listeners and release all rendered nodes deterministically.
- [x] Test multiple isolated roots and document whether disposed roots can be mounted again.
- [x] Keep the in-memory fake PAPI tests as fast unit-level regression coverage.

**Milestone complete when:** a browser can run a Solid Lynx bundle through `@lynx-js/web-core` and `<lynx-view>`, with core rendering, event, flush, and disposal behavior covered by automated tests.

Verified notes for this milestone:

- Disposal releases the listeners a root filed in the same slots it registered them and removes the nodes that root rendered. Roots sharing a page dispose independently, and a disposed root can be rendered into again.
- `global-bind:tap` is registered in its own dispatch slot and verified there, but `@lynx-js/web-core` does not run the global pass for function callbacks, so that pass stays covered by the fake PAPI tests until a host delivers it.

## 0.3: Native parity, tooling, and types

Validate native-specific behavior after the web path is working, while making Solid-on-Lynx projects straightforward to configure and author.

- [x] Run a native Lynx smoke test in Lynx Explorer or on an Android/iOS device.
- [x] Compare native and web behavior for shared Element PAPI operations.
- [ ] Verify native-only behavior such as dual-thread execution, worklets, and first-screen synchronization.
      **Scope-excluded. A recorded decision, not pending work.**
      This box will not close, and it is unticked on purpose: it asks this
      renderer to verify behaviour the renderer does not own, so a tick would
      claim a verification that cannot happen here. It is listed under
      ["Out of scope for the renderer"](#out-of-scope-for-the-renderer) with a
      cross-reference back to this note, and `docs/contract.md` §15 already
      records the same position. One reason per case:
  - **Worklets** are compiled and scheduled by Lynx's own build pipeline.
    Nothing in `src/` names a worklet API, and `README.md:363` lists "dual-thread
    worklet compilation and scheduling" as the toolchain's responsibility.
  - **Dual-thread execution** is a build configuration, not renderer behaviour.
    Every card in this repository declares `background: false`
    (`examples/lynx-for-native/lynx.config.ts:63`, `:67`, `:71`;
    `examples/lynx-patterns/lynx.config.ts:46`;
    `examples/lynx-for-web/lynx.config.ts:41`), so no bundle here emits a
    background thread to observe. `docs/building.md:204-206` says a
    background-thread card is unverified and worklets are out of scope for this
    package.
  - **First-screen synchronization** is host paint scheduling — which flush a
    device renders first — not renderer output. The renderer's half is the flush
    model, which is frozen and covered (`docs/contract.md` §7.5:
    `test/renderer.test.ts:505`, `:733`, `test/browser/lynx-for-web.test.ts:569`).
    `docs/parity-checklist.md:196-198` already records the three: dual-thread and
    worklets `not applicable` on web, first-screen `verified for web`, and all
    three `not measured` on native.

  What a future reader might still want from this box is a background-thread
  card. That is a new capability request for the examples, not a verification of
  this renderer, so it is not tracked by this milestone.
- [x] Provide a reproducible Rspeedy integration, preferably as a small plugin or maintained configuration package.
- [x] Document native and Lynx-for-Web build configurations and development workflows.
- [x] Replace broad intrinsic JSX types with Lynx element and attribute types, using `@lynx-js/types` where compatible.
- [x] Add typed event props and payloads, refs, styles, datasets, and custom elements.
- [x] Add JSX compile and package-consumer fixtures to verify `jsx-runtime` and `jsx-dev-runtime` behavior.
- [x] Expand tests for Solid control flow, keyed reconciliation, dynamic properties, event updates, and root isolation.

**Milestone complete when:** a fresh example app can be built from documented instructions and common Lynx JSX usage receives useful TypeScript checking.

**Status of this milestone:** met. Every box is either ticked or scope-excluded,
and the completion criterion above does not depend on the excluded native-only
box — it is about the example build and TypeScript checking, both of which are
verified in CI. The device findings below are what the smoke run established, and
none of them is restated as a present pass.

Verified notes for this milestone:

- Native smoke: the card loads through `lynx://open?url=http://127.0.0.1:8099/main.lynx.bundle`
  in Lynx Explorer 4.1.0 (`com.lynx.explorer`) on an SM-A037U, renders an
  `Increment` control and `Native parity count: 0`, and tapping increments the
  count through `bindtap` with no renderer error.
- Native parity: the 2026-10-09 device run reported all twenty shared Element
  PAPI operations passing, matching the web host and the fake PAPI. Its capture
  is gone, so `docs/parity-checklist.md` marks the native column **reported, not
  reproduced**; re-running the card and verifying the capture is what closes it.
- Two defects were found and fixed by the device run: the native host returns
  element handles whose `typeof` is `"unknown"` (the host no longer validates
  creators with a DOM `typeof` check), and `__GetPageElement()` returns `null`
  until `__CreatePage()` has been called (the example now creates the page).
- Explorer still shows a `processData is not a function` banner because the
  documented main-thread-only build emits an empty `/app-service.js`; it does not
  affect load, render, or tap. Dual-thread cards remain unverified, and the
  native-only box above is scope-excluded rather than pending: see "Out of scope
  for the renderer".

## 0.4: Lynx platform capabilities

Add platform features through explicit, testable adapters while keeping the core host contract small.

- [ ] Integrate stylesheet loading, CSS ids, and stylesheet lifecycle where the Lynx PAPI requires it.
  - **Done: CSS ids.** `root.setCSSId()` drives `__SetCSSId` over a root's own
    page children. Covered by `test/renderer.test.ts:1439` (one batched call for
    every page-level element), `:1466` (elements added later), `:1486` (nested
    elements excluded), `:1512` (a later call replaces), `:1525` (`null`
    forwarded), `:1539` (invalid id throws before recording), `:1557` (a host
    without the PAPI throws instead of styling nothing), `:1608` (a second root
    sharing the page is not restyled), and `:1578` (the recorded id survives a
    remount); on the web host by `test/browser/lynx-for-web.test.ts:694`, `:719`,
    `:747`, `:766`. The contract is `docs/contract.md` §8.
  - **Open: runtime stylesheet loading and lifecycle.** Two separate gaps, and
    they are not the same size:
    - *Absent on web.* `@lynx-js/web-core` 0.26.2 exposes no PAPI that adds,
      replaces, or removes a stylesheet — its set is `__AddClass`,
      `__AddInlineStyle`, `__SetClasses`, `__SetCSSId`, `__SetInlineStyles`
      (`docs/capabilities.md` "Stylesheet loading and lifecycle"). Integration
      there would mean inventing an API the host does not have, so it is
      documented as unsupported rather than approximated.
    - *Unmeasured on native.* The A03 run did observe the
      `__LoadStyleSheet`/`__AdoptStyleSheet`/`__ReplaceStyleSheets` globals in
      the host inventory, but their signatures and lifecycle were never
      exercised, so nothing about them is claimed and no renderer stylesheet API
      exists to call (`docs/contract.md` §8 "Important limit", §9 "Not proven /
      not applicable").
  - **How the native half would be measured, and recorded.** The card is
    `examples/lynx-for-native/src/stylesheet-probe.ts`, logging one
    `[solid-lynx ss]` line per stage, calling only what cannot mutate the card
    (`pnpm native:build` emits `dist/stylesheet-probe.lynx.bundle`). It is run
    through the single native runner,
    `examples/lynx-for-native/scripts/run-native-probe.sh stylesheet`, which
    pins the A03 serial, serves the bundle on loopback, opens it in Explorer and
    captures logcat; `run-native-probe.sh stylesheet --dry-run` reviews the
    sequence without hardware. **`scripts/verify-native-parity.mjs` does not
    verify these lines yet** — it reads only the `[solid-lynx parity]` marker
    (`scripts/verify-native-parity.mjs:28`) and exits 2 on a capture carrying
    only `[solid-lynx ss]` lines, which was re-checked for this revision. So the
    measurement would be *recorded* by naming the capture path and reading its
    `[solid-lynx ss]` stages against `docs/capabilities.md` "The native
    stylesheet probe"; it would not be *verified by a process* until the
    verifier grows a stylesheet mode or a sibling checker exists.
  - **No run has happened.** `--dry-run` for all three cards (and the
    `run-stylesheet-probe.sh` wrapper) exits 0, and `docs/capabilities.md`
    records the probe as "This has not been run yet". A reviewed command
    sequence is not a measurement. That is why the stylesheet half stays open
    and the box stays unticked, even though its CSS-id half is done and tested.
- [x] Add refs and imperative element access with deterministic cleanup.
- [x] Evaluate native list virtualization and expose list callbacks if the Solid model can support them cleanly.
  - The renderer side is done: `root.createList()` creates the list through
    `__CreateList` and re-installs the callbacks through `__UpdateListCallbacks`,
    with a keyed indexed row model (`src/list.ts`), covered by fake-PAPI unit
    tests and by the browser suite driving the host's own `update-list-info`
    request path. `<list>` in JSX now fails rather than rendering a
    non-virtualized container. What is still open is recycling and native
    validation: no host in this repository has been seen to recycle a cell, and
    nothing has run on a device, so native list support is unverified.
  - A native measurement card now exists:
    `examples/lynx-for-native/src/list-probe.ts`, built as
    `dist/list-probe.lynx.bundle` by `pnpm native:build`, with one
    `[solid-lynx lp]` stage line per step and host-free recorder tests in
    `test/list-probe-report.test.ts`. Its **device run is pending**, so it
    measures nothing yet; when run it reports the list-named globals, the created
    handle, materialized children, keyed identity across a permuted model, and
    whether the host ever called `enqueueComponent`. Viewport-driven recycling,
    scroll behavior, and cell reuse timing stay outside it because it never
    scrolls.
- [x] Evaluate gesture, animation, and portal/overlay APIs as separate capabilities.
- [x] Publish examples for forms, keyed lists, asynchronous content, and platform-specific capabilities.

**Milestone complete when:** supported platform features have documented contracts and tests, and unsupported capabilities fail clearly rather than silently degrading.

## 1.0: Stability

Set a stable public contract after web validation, native validation, and tooling have matured.

- [x] Finalize and document the public host, root, event, and JSX contracts.
  - Done in `docs/contract.md` (commit `0d77793`): §2 `createLynxRoot`, §3
    `createLynxRenderer`, §4 `createGlobalLynxHost`, §7 events and properties,
    and §12 JSX types each list the signature, its status (stable, provisional,
    or unsupported), and the test that fails if it changes. §15 collects
    everything outside the contract and §16 the exported surface with no test.
  - Evidence the document is enforced rather than aspirational: the CI `unit`
    job runs `pnpm typecheck` (build, then `tsc --noEmit`, then the consumer
    fixtures), `pnpm typecheck:consumer` (`test/consumer/tsconfig.json` and
    `tsconfig.dev.json`, which assert the type-level rejections with
    `@ts-expect-error`), and `pnpm test` (117 unit tests in 6 files: 62 in
    `test/renderer.test.ts`, 19 in `test/native-parity-verify.test.ts`, 14 in
    `test/list-probe-report.test.ts`, 9 in `test/parity.test.ts`, 7 in
    `test/stylesheet-probe-report.test.ts`, 6 in `test/rspeedy.test.ts`), so a
    contract item that loses its covering test or its type rejection turns CI
    red.
- [x] Define supported Lynx and Solid version ranges and verify them in CI.
  - **Node half: done, and verified in CI.** `docs/compatibility.md` §5–§7
    (commit `5ecace6`) defines the set: exact pins for `solid-js` 1.9.15,
    `@lynx-js/web-core` 0.26.2, `@lynx-js/rspeedy` 0.18.0,
    `@lynx-js/lynx-core` 0.1.4, the two Lynx Rsbuild plugins, `@rsbuild/core`
    2.2.11, `@rsbuild/plugin-babel` 2.1.0, and `babel-preset-solid` 1.9.15, plus
    the Node and pnpm ranges. The `node-matrix` job in
    `.github/workflows/ci.yml` is what covers the Node range: it runs
    `pnpm install --frozen-lockfile`, `pnpm typecheck`, and `pnpm test` on
    `20.x`, `22.x`, and `24.x` — the two declared Node lines plus the major the
    open-ended `>=22.12.0` admits, chosen because no manifest in the graph caps
    `engines.node`. Locally the same gate exits 0 on 20.19.0, 20.20.2, 22.12.0,
    22.23.3, 24.22.1, and 26.1.0. Those runs recorded 98 tests each, which is
    what this repository had at the time; the suite is 121 today. The 121 figure
    was re-measured on Node 22.23.3 / pnpm 12.9.1 for this revision; the other
    five Node lines were not re-run, so their 121 is an expectation, not a
    result.
  - **Solid half: done — the range widens the evidence rather than shrinking the
    claim.** The range stays `^1.9.15` (`package.json:59`) and the `solid-matrix`
    job in `.github/workflows/ci.yml` gives it a run. What decides it:
    - `^1.9.15` admits exactly three published versions: `1.9.15` (the pin),
      `1.9.16`, and `1.9.17` (`latest`). `1.9.14` and below, `1.10.0-beta.0`, and
      every `2.x` are outside it. So the range is closable by running two
      versions, not by running a matrix of unknown width.
    - The overlay was probed before the job was written, because a job that
      would be red is worse than a narrowed range. On Node 22.23.3 / pnpm
      12.9.1, with the committed pins installed and `solid-js` 1.9.16 + 1.9.17
      overlaid over `babel-preset-solid` 1.9.15/1.9.16: `pnpm typecheck` exit 0,
      `pnpm test` exit 0 with 121 tests, and `pnpm web:build` exit 0 on **both**.
      Nothing failed, so the range did not need narrowing. The browser suites
      also ran green on 1.9.17 (17 + 9 passed) but are not in the job.
    - `babel-preset-solid` has to move with it: 1.9.15 declares peer `^1.9.15`
      and 1.9.16 declares `^1.9.16`, so the 1.9.16 leg pairs both at 1.9.16 and
      the 1.9.17 leg runs the 1.9.16 preset, which a consumer on 1.9.17 resolves
      anyway (there is no `babel-preset-solid@1.9.17`).
    - The job also runs `pnpm web:build`, which is the only step that executes
      the preset. `pnpm typecheck` and `pnpm test` only name it in string
      assertions — verified by swapping in a preset that throws: both still
      exited 0 while `web:build` failed.
    - The overlay is an uncommitted `overrides` entry in `pnpm-workspace.yaml`
      plus `pnpm install --no-frozen-lockfile`, because `pnpm add -D --no-save`
      does not exist in pnpm 12.9.1 and `pnpm add -D -E` was measured to let a
      later `git checkout` of the manifests silently downgrade the gate back to
      1.9.15. `docs/compatibility.md` §2 records both failures.
    - What is still unverified: the job has not run on GitHub Actions (this
      worktree cannot dispatch it), so the recorded evidence is the local replay
      of its exact steps. A future `1.9.18` would be admitted by the range and
      would need a `matrix.include` entry before it could be claimed.
  - The `unit` job's accounting of what closes this box: `solid-matrix` has
    `needs: unit`, so a red unit gate stops it from running rather than
    producing a second, confusing failure.
- [ ] Require native and web compatibility checks for changes to shared behavior.
  - **Web half: enforced.** The `browser` job runs both suites on every pull
    request — `PLAYWRIGHT_PORT=4186 pnpm web:test` (17 tests) and
    `PLAYWRIGHT_PORT=4200` with `test/browser/patterns.playwright.config.ts`
    (9 tests) — and a red suite fails the PR.
  - **Native half: cannot run in CI, and does not.** The `native-build` job only
    compiles the bundles with `pnpm native:build` and uploads
    `examples/lynx-for-native/dist`; no device or emulator is attached, and the
    job's own comment (`.github/workflows/ci.yml:308-310`) says native runtime
    behaviour is not covered. Nothing in CI fails when a change breaks native
    rendering, tap dispatch, or the `[solid-lynx parity]` report.
  - **What now exists in place of automation: a recorded, verifiable native run.**
    Three pieces, all present:
    1. `examples/lynx-for-native/scripts/run-native-probe.sh smoke` produces the
       capture (pinned serial, loopback serve, Explorer deep link, logcat).
    2. `scripts/verify-native-parity.mjs <capture>` turns that capture into an
       exit code — 0 verified, 1 findings, 2 could not evaluate — by parsing the
       `[solid-lynx parity]` line and checking it against `parityOperationIds`
       from `dist/parity.js`. Its own logic is tested host-free against capture
       fixtures (`test/native-parity-verify.test.ts`, 19 tests).
    3. `.github/pull_request_template.md:22-39` asks every PR to tick one of
       "Not required" or "Required and done", and lists what a required run
       must record: `adb -s R9WT911JVVH get-state` returning `device`, the
       `[solid-lynx parity]` line recorded in `docs/parity-checklist.md`, the
       stylesheet probe reviewed if that PAPI moved, `docs/capabilities.md`
       updated with what the run showed, and the captures in
       `/tmp/solid-lynx-logs` read rather than only produced.
  - **What is enforced, exactly, and what is not.** The template checklist and
    the verifier are both **convention**: the template is prose a contributor
    ticks by hand, and the verifier is a command someone has to remember to run
    on a capture someone has to keep. No workflow invokes
    `verify-native-parity.mjs`; `rg` finds no reference to it under
    `.github/` or in any test other than its own host-free suite. So a PR that
    changes native-facing behaviour and ticks nothing still merges, and no check
    goes red. The box's word is "Require", and nothing requires anything yet.
  - What would actually close it: a CI job that at minimum fails when the
    template's native section is unaddressed, and ideally a stored capture under
    `docs/evidence/` (which does not exist yet — no capture has survived) that
    the verifier is run against on every change to `src/lynx-host.ts` or the
    examples' native entries. Neither exists. This box stays unticked.
- [ ] Confirm deterministic root, listener, and stylesheet cleanup.
  - **Proven: root, listener, and ref cleanup.** `docs/contract.md` §9 names the
    mechanism and the covering test for each. The line numbers below are this
    tree's, not the ones §9 cited when it was written: commits `380284f` and
    `8b01d05` both inserted tests above the ref and CSS-id blocks, pushing those
    blocks down by 137 lines in `test/renderer.test.ts`. So a cite copied from a
    1.0.0-era note can be wrong by exactly that much — the CSS-id batch test was
    at `:1302` and is at `:1439`. `docs/contract.md` §2, §6, §7.5, §8, and §9
    were corrected to these numbers in the same change as this note, and every
    citation in this file was re-checked against the working tree.
    - node removal and per-root ownership — `test/renderer.test.ts:561`, `:1151`;
      browser `test/browser/lynx-for-web.test.ts:471`
    - listener-slot release on disposal — `test/renderer.test.ts:976`, `:821`
    - subtree detach and restore — `test/renderer.test.ts:789`
    - ref release — `test/renderer.test.ts:1300`; browser `:606`, `:630`
    - one flush at the end of disposal — `test/renderer.test.ts:733`
    - independent disposal of roots sharing a page — `test/renderer.test.ts:1151`;
      browser `:471`
    - remount with fresh listeners — `test/renderer.test.ts:853`; browser `:471`
  - **Strengthened in this release, beyond what §9 previously cited.** Two real
    additions, both in 1.0.0 and both with failing-first tests:
    - *The listener half got an actual fix, not just a test.* Commit `380284f`
      ("fix: release a listener through the API pair that filed it") changed
      `src/lynx-host.ts`: `attachEvent` used to pick its PAPI pair at attach time
      while `detachEvent` picked again at release time with a different
      preference order, so a host exposing `__AddEventListener` without
      `__RemoveEventListener` bound through the listener API and released through
      `__AddEvent` — leaking the original slot. A registration now records the
      pair that filed it (`src/lynx-host.ts:256-292`) and release uses that pair;
      when no complete pair exists, attach throws instead of filing a listener
      nothing can release. Covered by `test/renderer.test.ts:1014` (both
      directions) and `:1081` (removal API missing). This was a genuine defect in
      what the box calls "deterministic listener cleanup", found and closed rather
      than re-described.
    - *Two gaps the contract admitted are now covered.* Commit `8b01d05` added
      `test/renderer.test.ts:1109` (double-dispose: the second `dispose()` does not
      reach the host and does not throw — previously `docs/contract.md` §2 said
      this was "not asserted by a test") and `:1578` (a CSS id assigned before
      disposal still styles the element after a remount, which pins the
      "no un-assign call is made or needed" claim in §9).
  - **Not provable: stylesheet cleanup.** The renderer never loads a stylesheet,
    so there is nothing for it to clean up (`docs/contract.md` §8, §9 "Not proven
    / not applicable": a CSS id only selects among stylesheets the toolchain
    already compiled in, and `setCSSId` makes no un-assign call because disposal
    removes the elements). The native lifecycle is **unmeasured**: the probe card
    exists (`examples/lynx-for-native/src/stylesheet-probe.ts`, built by `pnpm
    native:build`) and would be run through
    `examples/lynx-for-native/scripts/run-native-probe.sh stylesheet`, but no
    device run has happened — only `--dry-run`. Native cleanup after `dispose()`
    is unmeasured for the same reason (`docs/contract.md` §9 "Native disposal").
  - **So the box stays unticked.** Two thirds of its sentence are proven and one
    third is not merely untested but *absent* on web and *unmeasured* on native;
    ticking it would collapse that distinction, which is the whole reason the box
    exists. Closing it needs either a device run of the stylesheet probe or an
    explicit narrowing of the box to root/listener cleanup — and narrowing it is
    a decision nobody has recorded, so this revision does not take it.
- [x] Publish migration and compatibility guidance for breaking changes.
  - `docs/migration.md` (commit `002b786`) is the consumer-side guide: refs,
    CSS ids, event props, JSX types, the `<list>` → `root.createList()` move,
    root lifecycle, and a "deterministic cleanup" section that separates what is
    proven from what is not, with a numbered verification checklist.
  - `docs/compatibility.md` (commit `5ecace6`) is the version half, including §8
    for what the ranges do not claim and §9 for how to change a supported
    version. Both are linked from `README.md` (Status block and Development
    section) and from `CHANGELOG.md`.

**Milestone complete when:** consumers can build and maintain a Solid Lynx app using documented APIs, with core behavior continuously validated in supported runtimes.

**Status of this milestone:** not complete. Two of the five items are done (three
once the Solid half above counts as done). The remaining two stay open for two
different reasons, and this revision records which is which rather than one
shared blocker:

| Box | Why it is still open |
| --- | --- |
| Require native and web compatibility checks for changes to shared behavior | Web is enforced in CI. Native cannot run in CI; the recorded-run mechanism (`run-native-probe.sh smoke` + `verify-native-parity.mjs`) and the PR template exist, but both are convention — nothing red fails a PR. |
| Confirm deterministic root, listener, and stylesheet cleanup | Root, listener, and ref cleanup are proven and were strengthened in 1.0.0 (`380284f`, `8b01d05`). Stylesheet cleanup is absent on web and unmeasured on native, so the box cannot close on evidence. |

Neither remaining item is waiting on a contributor decision. Both need work nobody
has done: a native runtime check that can fail a PR, and a stylesheet device run.
The 0.3 native-only box is absent from this table because it is scope-excluded,
not pending.

## Out of scope for the renderer

These remain the responsibility of the surrounding Lynx app framework or toolchain unless a focused integration is added:

- Native navigation and application lifecycle ownership
- Rspeedy bundling internals beyond Solid-specific integration
- Lynx's dual-thread worklet compiler and runtime scheduling
- Native modules and platform services
- Verifying dual-thread execution, worklets, and first-screen synchronization in
  this repository. The 0.3 box that used to read as pending work is recorded
  here as a scope decision instead (see the 0.3 note above). Worklets are
  compiled by Lynx's toolchain; dual-thread execution is a build configuration no
  card here emits (`background: false` everywhere); first-screen synchronization
  is host paint scheduling. `docs/contract.md` §15 records the same position, and
  `docs/parity-checklist.md:196-198` already carries the row-level version:
  dual-thread and worklets `not applicable` on web, first-screen `verified for
  web`, and all three `not measured` on native.
