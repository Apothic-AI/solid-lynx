# Roadmap

This roadmap describes the intended direction for solid-lynx (published on npm
as `@apothic-ai/solid-lynx`, because the unscoped name belongs to an unrelated
package — see `CHANGELOG.md`, "Package name"). Milestones are ordered by
dependency and confidence, not by release date. Version labels are planning
targets, not release promises.

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
verified by the local gate (`pnpm typecheck`, `test/consumer/*`, `pnpm test`) that
the `unit` job runs. That gate has been run here; the workflow carrying it has
not run on GitHub Actions. The device findings below are what the smoke run
established, and none of them is restated as a present pass.

Verified notes for this milestone:

- Native smoke: the card loads through `lynx://open?url=http://127.0.0.1:8099/main.lynx.bundle`
  in Lynx Explorer 4.1.0 (`com.lynx.explorer`) on an SM-A037U, renders an
  `Increment` control and `Native parity count: 0`, and tapping increments the
  count through `bindtap` with no renderer error. **That is the 2026-10-09 A03
  hand run and it is still prose**; the emulator captures do not cover a tap, so
  this bullet is the only record of one.
- Native parity, two runtimes: the 2026-10-09 A03 device run *reported* all
  twenty shared Element PAPI operations passing, matching the web host and the
  fake PAPI, and its capture is gone — so that run stays **reported, not
  reproduced** in `docs/parity-checklist.md`, as its own historical note. The
  2026-10-25 API 33 `x86_64` emulator run passed the same twenty operations **and
  its capture is stored**
  (`docs/evidence/native/2026-10-25-emulator-api33-smoke/`, verifier exit 0), so
  the checklist's native column is measured for that runtime. Closing the A03
  half still needs an A03 run with a kept capture.
- Two defects were found and fixed by the A03 device run: the native host returns
  element handles whose `typeof` is `"unknown"` (the host no longer validates
  creators with a DOM `typeof` check), and `__GetPageElement()` returns `null`
  until `__CreatePage()` has been called (the example now creates the page). The
  emulator run reproduces the first — the list card records a returned handle
  with `handleTypeof: "unknown"` — which is why the fix is measured rather than
  remembered.
- Explorer still shows a `processData is not a function` banner because the
  documented main-thread-only build emits an empty `/app-service.js`; it does not
  affect load, render, or tap, and the emulator capture carries the same banner
  and the same non-effect. Dual-thread cards remain unverified, and the
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
    - *Unmeasured on native — measured in part on an emulator.* The A03 run did
      observe the `__LoadStyleSheet`/`__AdoptStyleSheet`/`__ReplaceStyleSheets`
      globals in the host inventory, but it never exercised them, so nothing from
      that run claims their signatures or lifecycle
      (`docs/contract.md` §8 "Important limit", §9 "Not proven / not
      applicable"). The API 33 `x86_64` emulator run has since measured what the
      bindings will **accept and return** — `__LoadStyleSheet` needs a second,
      String parameter and `[url, "utf-8"]` returns `null`; `__AdoptStyleSheet`
      throws `param size should >= 1` with no arguments;
      `__ReplaceStyleSheets` accepts `[]`, `[null]` and `[[]]` and returns `null`
      without throwing — and **no call returned a stylesheet handle**, so the
      lifecycle (what a handle is, how one is created, adopted, or replaced) is
      still unmeasured. That is why the box stays open: the capability is not
      merely unexercised, it has no ownership contract to implement against
      (`docs/capabilities.md`, "The five measured stylesheet facts").
  - **How the native half is measured, and recorded.** The cards are
    `examples/lynx-for-native/src/stylesheet-probe.ts` (v1, one
    `[solid-lynx ss]` line per stage) and
    `examples/lynx-for-native/src/stylesheet-probe-v2.ts` (v2, one
    `[solid-lynx ss2]` line per stage), both built by `pnpm native:build` as
    `dist/stylesheet-probe.lynx.bundle` and
    `dist/stylesheet-probe-v2.lynx.bundle`. They call only what cannot mutate the
    card. The intended runner is
    `examples/lynx-for-native/scripts/run-native-probe.sh stylesheet`, which pins
    the A03 serial, serves the bundle on loopback, opens it in Explorer and
    captures logcat; `run-native-probe.sh stylesheet --dry-run` reviews the
    sequence without hardware. The runs that exist were taken outside that
    runner, by opening the bundles in Explorer on an API 33 `x86_64` emulator,
    and are stored in
    `docs/evidence/native/2026-10-25-emulator-api33-stylesheet/` (record, with
    manifest) and `.../2026-10-25-emulator-api33-stylesheet-v2/` (capture only,
    no manifest, so it is supporting bytes and not a record).
  - **The capture is now verifiable by process.**
    `scripts/verify-native-probe.mjs` reads a `[solid-lynx ss]` capture and
    requires the six stylesheet stages (`inventory`, `no-arguments`,
    `load-missing-url`, `load-real-url`, `summary`, `done`) to be present, once
    each, in that order, with every line parsing as JSON. It reads the
    capture's own fields for the two claims the card exists to make — that the
    mutating stage reached a real stylesheet while the missing-URL stage failed,
    and that `summary.unmeasured` is non-empty — and it never turns an `arity`
    into an expected parameter count. Exit codes are 0 verified / 1 findings /
    2 could not evaluate, the same three the parity verifier uses, and
    `scripts/require-native-evidence.mjs` now runs it for a stored manifest whose
    `card` is `stylesheet` or `stylesheet2` (parity for `smoke`, the same checker
    for `list`).
    `test/native-probe-verify.test.ts` drives every exit code through a real
    process against `test/fixtures/native-probe/`, whose README states that those
    fixtures are not device evidence. The parity verifier is unchanged: it still
    reads only `[solid-lynx parity]` and still exits 2 on a capture carrying only
    `[solid-lynx ss]` lines, which is asserted in that suite.
  - **No run has happened *through the runner*, and one has happened beside it.**
    `--dry-run` for all four cards (and the `run-stylesheet-probe.sh` wrapper)
    exits 0, and no card has been executed by that script. A reviewed command
    sequence is not a measurement, and neither is a verifier that passes on a
    synthetic fixture. Since this note was first written, a real measurement has
    been taken by hand: the v1 and v2 cards were opened in Lynx Explorer 4.1.0 on
    an API 33 `x86_64` emulator and both captures are stored. They measured the
    arity and return values of the three bindings and, for v2, the shape of
    `__CreateStyleObject`'s return. They did **not** measure a lifecycle — no
    call returned a handle — so the stylesheet half still stays open and the box
    stays unticked, even though its CSS-id half is done and tested and its
    capture format is checkable.
  - **The absence used to be recorded, and is now recorded as a partial
    measurement.** The pending record that named this card among its three
    (`docs/evidence/native/2026-10-25-1.0.0-pending/pending.json`) has been
    deleted in `85ddd12`, because a storable capture now exists and leaving a
    "nothing ran" record beside it would be false. What replaces it is not a
    closed box: it is two stored emulator captures (one of them a record, the v2
    one supporting bytes), a named missing capability (no handle, therefore no
    ownership contract), and a gate that still exits **1** for a native-facing
    change with no record of its own. `scripts/require-native-evidence.mjs`
    accepts evidence as answers about honesty, not about behaviour: a capture
    verifies or it does not, a `pending.json` exits **3** and prints
    `verdict: pending` (never 0), and the `native-evidence` job surfaces 3 as a
    warning rather than a pass. This box staying open is therefore still a state
    the release gate reports rather than a claim a reader has to take on trust —
    but the gate green is no longer the same thing as the capability being
    available.
- [x] Add refs and imperative element access with deterministic cleanup.
- [x] Evaluate native list virtualization and expose list callbacks if the Solid model can support them cleanly.
  - The renderer side is done: `root.createList()` creates the list through
    `__CreateList` and re-installs the callbacks through `__UpdateListCallbacks`,
    with a keyed indexed row model (`src/list.ts`), covered by fake-PAPI unit
    tests and by the browser suite driving the host's own `update-list-info`
    request path. `<list>` in JSX now fails rather than rendering a
    non-virtualized container. What is still open is recycling: no host in this
    repository has been seen to recycle a cell.
  - A native measurement card exists and **has run**:
    `examples/lynx-for-native/src/list-probe.ts`, built as
    `dist/list-probe.lynx.bundle` by `pnpm native:build`, with one
    `[solid-lynx lp]` stage line per step and host-free recorder tests in
    `test/list-probe-report.test.ts`. Its capture is read by
    `scripts/verify-native-probe.mjs`, which requires the seven list stages in
    order and treats the recycling question as one that must be *answered*: a
    recorded `0` for `enqueueComponent` verifies (the host never called it), an
    omitted counter is a finding, and `materialize` has to keep "the host asked"
    apart from "the probe materialized".
  - **What the run measured**, on the API 33 `x86_64` emulator (capture:
    `docs/evidence/native/2026-10-25-emulator-api33-list/`, verifier exit 0):
    the list PAPI is three bindings — `__CreateList` and `__UpdateListCallbacks`
    present, `__UpdateListComponents` and `__GetListComponents` **undefined**;
    `create` returned a handle with `typeof` `"unknown"`; `materialize` produced
    3 children for 3 toy rows the host never asked for; a permuted model **moved
    3 rows keeping element identity** (ids `[15,17,19]` → `[19,15,17]`, 0
    released, 0 rebuilt); a shrink to 1 **released 2 rows**; and
    `enqueueComponent` was **never called in any stage**. Viewport-driven
    recycling, scroll behaviour, cell reuse timing, and
    `operationId`/`enableReuseNotification` semantics stay outside it because the
    card never scrolls — its own `summary.unmeasured` says a zero there cannot be
    read as the host being unable to recycle. So recycling is still unobserved,
    now on a measured engine rather than an unrun adapter, and there is still no
    A03 list run.
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
  - Evidence the document is enforced rather than aspirational: the `unit` job in
    `.github/workflows/ci.yml` runs `pnpm typecheck` (build, then `tsc --noEmit`,
    then the consumer fixtures), `pnpm typecheck:consumer`
    (`test/consumer/tsconfig.json` and `tsconfig.dev.json`, which assert the
    type-level rejections with `@ts-expect-error`), and `pnpm test` — measured in
    this tree as **304 unit tests in 12 files**, of which `test/renderer.test.ts`
    contributes 63 (the file has grown since this box was written; the counts
    move, the arrangement does not, and `test/documented-counts.test.ts` now
    fails when a document disagrees with the measured suite). A contract item
    that loses its covering test or its type rejection therefore fails a command
    that the workflow runs, and the same commands have been run here to exit 0.
    The workflow itself has not run on GitHub Actions — see the next box — so the
    enforcement is real and local, not a claim about a runner.
- [ ] Define supported Lynx and Solid version ranges and verify them in CI.
      **Unticked on the CI half only.** The original wording is kept above,
      unedited, because the change is a correction of evidence rather than a
      redefinition of the goal. The ranges are defined and their commands pass
      locally; what is missing is the CI execution the box names. It was ticked
      while the workflow had never run anywhere, which is the exact overclaim
      the rest of this tree spends its effort removing — a claim stronger than
      its evidence. What would earn the tick: the first push of this branch,
      which starts `unit`, `node-matrix`, `solid-matrix`, `browser`,
      `native-build`, and `native-evidence` on GitHub Actions, plus one green
      `node-matrix` and one green `solid-matrix` run recorded with their URLs.
      That is one PR away, and nothing else is blocking it — see "What is still
      unverified" at the end of this box.
  - **Node half: defined, and verified locally — not in CI.** `docs/compatibility.md` §5–§7
    (commit `5ecace6`) defines the set: exact pins for `solid-js` 1.9.15,
    `@lynx-js/web-core` 0.26.2, `@lynx-js/rspeedy` 0.18.0,
    `@lynx-js/lynx-core` 0.1.4, the two Lynx Rsbuild plugins, `@rsbuild/core`
    2.2.11, `@rsbuild/plugin-babel` 2.1.0, and `babel-preset-solid` 1.9.15, plus
    the Node and pnpm ranges. The `node-matrix` job in
    `.github/workflows/ci.yml` *would* cover the Node range: it runs
    `pnpm install --frozen-lockfile`, `pnpm typecheck`, and `pnpm test` on
    `20.x`, `22.x`, and `24.x` — the two declared Node lines plus the major the
    open-ended `>=22.12.0` admits, chosen because no manifest in the graph caps
    `engines.node`. Locally the same gate exits 0 on 20.19.0, 20.20.2, 22.12.0,
    22.23.3, 24.22.1, and 26.1.0. Those runs recorded 98 tests each, which is
    what this repository had at the time; the suite is 304 now. The 121 figure
    quoted for the Node lines was re-measured on Node 22.23.3 / pnpm 12.9.1 at
    an earlier commit in this release, before the sweep and probe suites landed;
    the other five Node lines were not re-run, so their 121 is an expectation,
    not a result, and the 268 figure is measured on 22.23.3 only.
  - **Solid half: defined, and verified locally — not in CI.** The range stays
    `^1.9.15` (`package.json:59`) and the `solid-matrix` job in
    `.github/workflows/ci.yml` *would* give it a run. What decides it:
    - `^1.9.15` admits exactly three published versions: `1.9.15` (the pin),
      `1.9.16`, and `1.9.17` (`latest`). `1.9.14` and below, `1.10.0-beta.0`, and
      every `2.x` are outside it. So the range is closable by running two
      versions, not by running a matrix of unknown width.
    - The overlay was probed before the job was written, because a job that
      would be red is worse than a narrowed range. On Node 22.23.3 / pnpm
      12.9.1, with the committed pins installed and `solid-js` 1.9.16 + 1.9.17
      overlaid over `babel-preset-solid` 1.9.15/1.9.16: `pnpm typecheck` exit 0,
      `pnpm test` exit 0 with 121 tests (the suite has since grown to 304 at
      the same Node and pnpm, but that count was not re-run per Solid leg), and
      `pnpm web:build` exit 0 on **both**.
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
    - What is still unverified: **the job has never run on GitHub Actions.** No
      workflow has executed there for any commit on this branch — `gh run list`
      for the repository returns no runs at all, and `.github/workflows/ci.yml`
      is not on `origin/master`, which sits at `e40d1c5`, 52 commits behind.
      The workflow file is validated by static parse (both matrices expand, all
      six jobs and their `needs:` edges are well-formed), and its `run:` steps
      were replayed locally at named commits with the results above. That is a
      local replay of the exact steps, **not** a CI run: the leg matrix, the
      `needs: unit` edges, and every `actions/*` step are unexecuted. A future
      `1.9.18` would be admitted by the range and would need a `matrix.include`
      entry before it could be claimed.
  - The `unit` job's accounting of what closes this box: `solid-matrix` has
    `needs: unit`, so a red unit gate stops it from running rather than
    producing a second, confusing failure. That edge is declared and statically
    parsed; it has not been exercised, because nothing has run on a runner yet.
- [x] Require native and web compatibility checks for changes to shared behavior.
  - **Web half: enforced by a declared job, and green locally.** The `browser`
    job *would* run both suites on every pull request —
    `PLAYWRIGHT_PORT=4186 pnpm web:test` (17 tests) and `PLAYWRIGHT_PORT=4200`
    with `test/browser/patterns.playwright.config.ts` (9 tests) — and a red suite
    would fail it. Both suites were run here at this commit and passed 17 and 9.
    The job has not run on GitHub Actions, so what is established is that the
    suites are green and that a job runs them; that a PR would be blocked is the
    declared behaviour, not an observed one.
  - **Native half: enforced as a requirement on evidence, not as an execution.**
    The `native-evidence` job *would* run
    `scripts/require-native-evidence.mjs` over `pull_request.base.sha..HEAD` on
    every pull request, and a change to native-facing code with no satisfying
    record would be **red**. That is the
    specific gap this box named: it used to say "a PR that changes
    native-facing behaviour and ticks nothing still merges, and no check goes
    red". The check now exists, is wired into a job, and was demonstrated by
    hand against throwaway repositories for all four exit codes. It has not run
    on GitHub Actions, so "a bad PR is blocked" is the job's declared behaviour
    and the script's measured behaviour, not yet an observed CI event.
  - **The native half also has real captures now, which is a narrower statement
    than it sounds.** Three stored emulator runs are committed — all twenty parity operations pass,
    stylesheet v1's six stages (including a load of the real `probe.css`), and
    the list card's seven stages — each with a `manifest.json` whose verifier
    exits 0 when re-run against the stored bytes, and each naming its runtime
    (AVD `lynx33`, API 33, `x86_64`, Explorer 4.1.0, APK SHA-256
    `6ae29787a2166974c29c2f23d87f3b20a137abcf9a8c17903ad19f3fb7f00cb6`). Run over
    a range that contains them, the gate exits 0 with `verdict: satisfied`, which
    is the mechanism working on real input rather than on fixtures.
    **The box's state does not change for this, and the reason is one sentence:**
    the box asks that the checks be *required*, and what was missing was the
    enforcement path — green captures prove the path accepts a real run, not that
    a red PR blocks or that CI ever executed, and both of those still read
    "declared, never observed". What is still missing for the box to move on its
    own terms is one GitHub Actions run; what is still missing for the *native
    capability* record is A03 coverage and the stylesheet lifecycle, neither of
    which this box claims.
    - The path list is `NATIVE_FACING_PATHS` in
      `scripts/require-native-evidence.mjs`, exported so it is testable, and
      derived by reading the bundle rather than guessing. Runtime-reachable:
      `src/{index,jsx-runtime,jsx-dev-runtime,parity,universal,renderer,root,lynx-host,list,refs,events,render-context}.ts`.
      Type-only but compiled against by the cards: `src/{host,jsx-types}.ts`.
      `src/rspeedy.ts` configures the native build, so flipping `generate` to
      `"dom"` — which produces a bundle that builds and renders nothing — is
      caught. Everything under `examples/lynx-for-native/`. `.github/workflows/ci.yml`
      only when the changed lines land inside the `native-build` or
      `native-evidence` job, and there by structure rather than by position: a
      change counts only if it touches a significant line inside a native job's
      own body, so appending a job after `native-build` or commenting above it is
      not a native change, while deleting or renaming a native job, or changing
      what it `needs:`, is. `test/require-native-evidence.test.ts` asserts the list covers
      every file in `src/`, so a new source file forces a decision here.
    - Evidence has three forms, all committed by the change itself. A capture:
      `docs/evidence/native/<date-or-id>/` holding the log plus a `manifest.json`
      (device serial, `adb get-state` output, card, verifier exit code, verifier
      verdict line, timestamp, commit sha). The checker **runs**
      `scripts/verify-native-parity.mjs` against the stored bytes and requires
      exit 0, and cross-checks the manifest's recorded exit code and verdict
      line against that live run, so editing either half makes them disagree. Or
      a `decision.json`: an explicit recorded decision that this change needs no
      device run, with a reason, an author, a timestamp, and the paths it covers.
      Or a `pending.json`: the change *does* need a run, the run is specified and
      reviewed, and it has not happened — the card that will measure it, a reason
      at least 40 characters long, `blocked_by` naming the physical dependency
      (a bare `n/a`, `tbd`, or `no device` is rejected), every native-facing path
      it stands in for, an author, a timestamp, and a commit in the range.
    - **A pending record is not a pass, and cannot be made into one.** The gate
      exits **3** for it — never 0 — and prints `verdict: pending` plus a warning
      block naming every covered path, the card, and the blocker, with the line
      "NOTHING was verified as a pass" in it. It is accepted only when it is the
      complete truth for the range: pending and decision records together must
      cover every native-facing path, and one path left uncovered is exit 1 with
      the path named. A capture for the same range still wins (exit 0) and the
      pending record is reported as superseded. Why the third code exists at all:
      without it, a release whose probes are built and waiting on an unattached
      tablet had to either write a `decision.json` asserting no run was needed
      (false) or fail its own gate as though it had dodged the requirement. 3 is
      the difference between "unmet and scheduled" and "met" and "dodged".
    - **CI surfaces 3 as a warning, not a failure, and 1/2 still fail — as
      written and statically parsed.** The `native-evidence` job captures the
      script's exit code, emits a
      `::warning title=Native evidence PENDING — not a pass::` annotation and a
      job-summary block for 3, and exits with the code for anything else. So a
      red `native-evidence` job would always mean missing or unreadable evidence,
      and a green one with a `pending.json` in the range would say in the
      annotation that nothing was measured. The shell was replayed locally
      against the real repository (pending → step exit 0 with the annotation,
      missing → step exit 1) and the YAML parses; the annotation itself has not
      been rendered by GitHub, because no workflow has run there.
    - The reuse holes are closed. A capture whose recorded commit is at or
      before the range base does not count; neither does one whose native-facing
      files moved again after that commit. A manifest without its capture, a
      directory carrying two records, a `pending.json` whose commit is outside
      the range, and `docs/evidence/native/TEMPLATE/`, are all rejected by name.
    - The requirement's own logic is tested host-free:
      `test/require-native-evidence.test.ts` drives the script through
      `child_process` against git repositories built in `mkdtemp`, so it needs
      no device, no network, and not this repository's git state (50 tests, of
      which nine cover the pending form: full coverage → exit 3 and the warning
      text, one path missing → exit 1, capture wins → exit 0, a decision and the
      template unchanged, a shrug blocker rejected, two records in one directory
      rejected, a broken record beside a pending one → exit 1, a split record
      set covering between them, and a record from outside the range).
  - **What is still manual, and is not claimed as automated.** No device runs in
    CI, and this change does not make one run. `native-build` still only
    compiles the bundles. `device.getState` in a manifest is a string a human
    typed after `adb -s <serial> get-state`; nothing here can confirm a device
    existed. The forgery is a concrete one and is recorded in
    `docs/evidence/native/README.md` rather than left implied: copying
    `test/fixtures/native-parity/good-capture.log` into an evidence directory and
    writing a manifest satisfies the check without hardware — it was tried
    against this script and it passed. So the honest statement is: **the
    existence and re-verifiability of a run is required and checked; performing
    the run, and confirming that the record describes one, is still a human
    step.** A reviewer remains the only thing that can confirm the serial in a
    manifest matches hardware someone actually held. The 2026-10-25 records name
    `emulator-5554` and an AVD, not the A03: they are a run someone performed, and
    they prove the gate accepts one, not that an attached tablet can be attested
    by a script.
  - **What the evidence set now looks like, and what it does not cover.**
    `docs/evidence/native/` holds its README, a capture-less `TEMPLATE/`, and four
    run directories from 2026-10-25 — `smoke`, `stylesheet`, `list` with captures
    and manifests, and `stylesheet-v2` with a capture and **no manifest**, so the
    gate does not count it. The three-record pending set that stood for these
    cards was deleted in `85ddd12` once the captures existed; deleting it was
    correct because a "nothing ran" record beside a verified capture is false,
    and the A03 gap it also described is now stated in
    `docs/capabilities.md` and `docs/parity-checklist.md` instead. Running the
    gate on the range that contains those captures exits **0**, not 3 — and a
    range whose only native evidence would be an A03 run still has none, so the
    requirement is as unmet for tablet behaviour as it was, which
    `docs/parity-checklist.md` records as its own historical note.
- [x] Confirm deterministic root, listener, ref, and list-callback cleanup.
      **Retitled from "Confirm deterministic root, listener, and stylesheet
      cleanup".** The original wording is kept in this paragraph because the
      retitle is the substance of the change rather than a cosmetic edit: the
      third noun named a resource this renderer never acquires, so no amount of
      work here could have confirmed cleaning it up. The stylesheet half is not
      deleted — it is moved to an explicit "out of the claim" statement below,
      which is a claim a reader can check, unlike a permanently open box.
  - **Proven: root, listener, ref, and list-callback cleanup.** `docs/contract.md` §9 names the
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
    - a flush as the last thing disposal does — `test/renderer.test.ts:2086`
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
    removes the elements). The native lifecycle is **unmeasured**: the probe cards
    exist (`examples/lynx-for-native/src/stylesheet-probe.ts` and
    `.../stylesheet-probe-v2.ts`, built by `pnpm native:build`) and have now been
    run — by hand, on an API 33 `x86_64` emulator, with both captures stored —
    and they measured the bindings' arity and return values, **not a lifecycle**:
    no call returned a stylesheet handle, so there is still nothing whose cleanup
    could be observed or claimed. Neither card has been run through
    `examples/lynx-for-native/scripts/run-native-probe.sh stylesheet` (only
    `--dry-run`), and neither has run on the A03. Native cleanup *after
    `dispose()`* is unmeasured for a different reason and stays so: no card
    asserts node removal or listener-slot release afterwards (`docs/contract.md`
    §9 "Native disposal").
  - **The claim, resource by resource, and what each one is proven by.** This is
    the inventory the box asked for: every row is a resource a root can hold, and
    "cleanup" means the fake PAPI's own bookkeeping no longer contains it after
    `dispose()` — not that a release method was reached.

    | Resource | Residual after `dispose()` | Proven by |
    | --- | --- | --- |
    | Rendered nodes in the page | the root's own page children are gone; another root's are not | `test/renderer.test.ts:561`, `:1151`; browser `:471` |
    | Listener slots | none: every registration is released in the slot it was filed in | `test/renderer.test.ts:976` (slot tuples), `:821`, `:1014` |
    | Subtree listeners | detached with the subtree and restored on re-insertion | `test/renderer.test.ts:789` |
    | Refs | the ref no longer holds the node | `test/renderer.test.ts:1300`; browser `:606`, `:630` |
    | List rows and their callbacks | rows released, the installed pair left inert | `test/renderer.test.ts:1983`, `:1829` (host-removed row); the root-owned case is `:2086` |
    | The CSS-id record | the id stays on the root; the elements it was applied to are gone, and no un-assign call is made or needed | `test/renderer.test.ts:1578` |
    | All of the above at once, on one root that owned every resource | nothing in the host, read from the fake's bookkeeping | **`test/renderer.test.ts:2086`** (added in this change) |

    That last row is deliberately the file's final `describe` block rather than a
    neighbour of the other disposal tests. Inserting it near them shifted every
    following test down one line and silently invalidated a dozen
    `test/renderer.test.ts:NNN` citations across `docs/contract.md`,
    `docs/migration.md`, and this file — the same drift that `380284f` and
    `8b01d05` caused and the reason those citations get re-checked against the
    tree instead of trusted.

  - **The inventory turned up one claim that was not merely uncited but false.**
    `docs/contract.md` §9 said disposal "flushes the host (`__FlushElementTree`)
    once at the end" and cited `test/renderer.test.ts:733`. That test never
    constructs a root or calls `dispose()`: it drives `createGlobalLynxHost`
    directly and calls `host.flush()` itself, despite its name mentioning
    disposal. Measured on a rendered root, one `dispose()` issues **two**
    `__FlushElementTree` calls (the renderer's own disposal flushes at
    `src/renderer.ts:39`, then `src/root.ts:157`), and **three** when the root
    owned a list. So "once" was wrong twice over: wrong count, and no test for
    the count. The invariant that does hold, and is now tested, is that the
    *last* call disposal makes to the host is a flush, so whatever removals it
    performed are not left pending. §9's row was corrected in this change; the
    call count itself remains unasserted, and is recorded as such.
  - **Out of the claim: stylesheet cleanup.** The renderer never loads a
    stylesheet, so it has none to clean up. `src/` names no stylesheet API, and
    `@lynx-js/web-core` exposes none: its `ElementPAPIs` surface in
    `dist/types/IElementPAPI.d.ts` has `__SetCSSId`
    (`SetCSSIdPAPI = (elements, cssId, entryName) => void`) and nothing that
    adds, replaces, or removes a stylesheet (`docs/contract.md` §8;
    `docs/capabilities.md`, "Stylesheet loading and lifecycle"). A CSS id only
    selects among stylesheets the Lynx toolchain already compiled into the
    bundle, and `setCSSId` makes no un-assign call because disposal removes the
    elements the id was applied to. This is therefore a category the renderer
    does not participate in — **not** an unproven part of the claim — and it is
    why the box could not close on a device run either: running the native
    stylesheet probes measured `__LoadStyleSheet` semantics — its arity, its
    argument types, and that it returns `null` — which is a capability question,
    not this box's cleanup question. The native globals (`__LoadStyleSheet`,
    `__AdoptStyleSheet`, `__ReplaceStyleSheets`) exist and their *lifecycle* is
    unmeasured, now for a specific reason rather than for want of a run: no call
    in either card returned a stylesheet handle. That work is tracked where it
    belongs, in `docs/capabilities.md` "The five measured stylesheet facts", with
    both cards built, run, and captured.
  - **Unmeasurable here: native cleanup after `dispose()`.** The A03 device run
    exercised load, render, and tap dispatch, and the 2026-10-25 emulator captures
    exercise Element PAPI construction, the parity harness's own root disposal,
    and the list card's model changes — **neither asserts node removal or
    listener-slot release after the renderer's `dispose()`**, and no host-free
    test can, because the fake PAPI is not a host. Note what `renderer-dispose`
    passing on the emulator does and does not mean: it asserts that the nodes the
    harness's own root rendered were gone from its sandbox, which is the parity
    row's claim, not a measurement of what the engine does with a removed node or
    a released listener slot. This stays a named gap in `docs/contract.md` §9
    "Native disposal" and `docs/migration.md` §9.2, and it is out of this box's
    claim rather than left implied: the claim above is about what the renderer
    releases through the Element PAPI, which is the same code on both hosts, not
    about what a native engine then does with a removed node.
  - **So the box is ticked, as the narrower claim.** Every resource the renderer
    can acquire is proven released, in one test that reads the host's post-dispose
    state rather than a log of calls; the two things it still cannot show —
    stylesheet cleanup and native cleanup — are recorded as out of the claim and
    unmeasurable respectively, at the line where a reader will look for them.
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

**Status of this milestone:** complete for every claim the renderer can make, on
local evidence, with one box unticked. Four of the five items are done. The fifth
— "Define supported Lynx and Solid version ranges and verify them in CI" — is
ticked nowhere in this file: the ranges are defined and their commands pass
locally, but no workflow has ever run on GitHub Actions, so the "in CI" half of
that sentence is unearned. It is unticked rather than reworded because unticking
is what the evidence supports and the original wording is still visible above.
The cleanup box was retitled rather than left open — see its
note above for why a stylesheet-cleanup claim could not have been closed by any
amount of work here, and what replaced it.

What that means for the milestone criterion: "core behavior continuously
validated in supported runtimes" is true of this worktree and not yet true of a
runner. Continuous validation is the workflow's job, and the workflow has been
written, statically parsed, and replayed locally but never executed on GitHub.
The first push is what converts this, and it changes no code.

| Box | Where the honest limit is now recorded |
| --- | --- |
| Define supported Lynx and Solid version ranges and verify them in CI | **Unticked**, on the CI half only. The ranges are defined (`docs/compatibility.md` §5–§7) and their commands pass locally; no workflow has executed on GitHub Actions, so the "in CI" half is unearned. What earns the tick is a push plus one green `node-matrix` and one green `solid-matrix` run recorded with their URLs — one PR away. `docs/compatibility.md` §8, `docs/release.md` §7, and `README.md`'s status block all now say the same thing. |
| Confirm deterministic root, listener, ref, and list-callback cleanup | Ticked as the narrower claim, with `test/renderer.test.ts:2086` as the new proof that a disposed root leaves no residual host state. Stylesheet cleanup is out of the claim (nothing is ever loaded: `docs/contract.md` §8) and native cleanup after `dispose()` is unmeasurable without a host that reports it (`docs/contract.md` §9, "Native disposal") — the 2026-10-25 emulator captures do not close it either. Both remain recorded as gaps in `docs/capabilities.md` and `docs/migration.md` §9.2. |

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
