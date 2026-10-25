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
- [x] Provide a reproducible Rspeedy integration, preferably as a small plugin or maintained configuration package.
- [x] Document native and Lynx-for-Web build configurations and development workflows.
- [x] Replace broad intrinsic JSX types with Lynx element and attribute types, using `@lynx-js/types` where compatible.
- [x] Add typed event props and payloads, refs, styles, datasets, and custom elements.
- [x] Add JSX compile and package-consumer fixtures to verify `jsx-runtime` and `jsx-dev-runtime` behavior.
- [x] Expand tests for Solid control flow, keyed reconciliation, dynamic properties, event updates, and root isolation.

**Milestone complete when:** a fresh example app can be built from documented instructions and common Lynx JSX usage receives useful TypeScript checking.

Verified notes for this milestone:

- Native smoke: the card loads through `lynx://open?url=http://127.0.0.1:8099/main.lynx.bundle`
  in Lynx Explorer 4.1.0 (`com.lynx.explorer`) on an SM-A037U, renders an
  `Increment` control and `Native parity count: 0`, and tapping increments the
  count through `bindtap` with no renderer error.
- Native parity: all twenty shared Element PAPI operations pass on the device,
  matching the web host and the fake PAPI; see `docs/parity-checklist.md`.
- Two defects were found and fixed by the device run: the native host returns
  element handles whose `typeof` is `"unknown"` (the host no longer validates
  creators with a DOM `typeof` check), and `__GetPageElement()` returns `null`
  until `__CreatePage()` has been called (the example now creates the page).
- Explorer still shows a `processData is not a function` banner because the
  documented main-thread-only build emits an empty `/app-service.js`; it does not
  affect load, render, or tap. Dual-thread cards remain unverified.

## 0.4: Lynx platform capabilities

Add platform features through explicit, testable adapters while keeping the core host contract small.

- [ ] Integrate stylesheet loading, CSS ids, and stylesheet lifecycle where the Lynx PAPI requires it.
  - CSS ids are done: `root.setCSSId()` drives `__SetCSSId` over a root's own page
    children and is covered by fake-PAPI and browser tests.
  - Stylesheet loading and lifecycle stay open. web-core exposes no PAPI that adds,
    replaces, or removes a stylesheet, so it is documented as unsupported rather
    than approximated. The A03 device run did observe native
    `__LoadStyleSheet`/`__AdoptStyleSheet`/`__ReplaceStyleSheets` globals; their
    semantics are unmeasured, so integrating them is still open.
  - A measurement card for the three native operations is built
    (`examples/lynx-for-native/src/stylesheet-probe.ts`, logging one
    `[solid-lynx ss]` line per stage, calling only what cannot mutate the card).
    Its A03 run has not happened yet, so nothing about their signatures or
    lifecycle is claimed, and no renderer or web-side stylesheet API has been
    added.
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
    `@ts-expect-error`), and `pnpm test` (94 unit tests in 5 files: 58 in
    `test/renderer.test.ts`, 14 in `test/list-probe-report.test.ts`, 9 in
    `test/parity.test.ts`, 7 in `test/stylesheet-probe-report.test.ts`, 6 in
    `test/rspeedy.test.ts`), so a contract item that loses its covering test or
    its type rejection turns CI red.
- [ ] Define supported Lynx and Solid version ranges and verify them in CI.
  - Half done. `docs/compatibility.md` §5–§7 (commit `5ecace6`) defines the set:
    exact pins for `solid-js` 1.9.15, `@lynx-js/web-core` 0.26.2,
    `@lynx-js/rspeedy` 0.18.0, `@lynx-js/lynx-core` 0.1.4, the two Lynx Rsbuild
    plugins, `@rsbuild/core` 2.2.11, `@rsbuild/plugin-babel` 2.1.0, and
    `babel-preset-solid` 1.9.15, plus the Node and pnpm ranges.
  - Not done: CI **verifies one pinned set, not the declared ranges**.
    `.github/workflows/ci.yml` runs `node-version: 22` with that single
    resolved Solid/web-core/Rspeedy set, and `docs/compatibility.md` §8 says so
    outright ("No version matrix in CI … CI therefore repeats the local gate; it
    does not widen the supported set"). Node 20.19.x and 22.12.x have never
    been run. The box stays open until CI checks more than the one set.
- [ ] Require native and web compatibility checks for changes to shared behavior.
  - Not satisfied, and the gap is a native runtime in CI. The `browser` job does
    run both web suites on every pull request — `PLAYWRIGHT_PORT=4186 pnpm
    web:test` (17 tests) and `PLAYWRIGHT_PORT=4200` with
    `test/browser/patterns.playwright.config.ts` (9 tests) — so web is checked.
  - Native is not: the `native-build` job only compiles the bundle with `pnpm
    native:build` and uploads `examples/lynx-for-native/dist`. No device or
    emulator is attached, and the job's own comment says native runtime
    behaviour stays a manual check. Nothing in CI fails when a change breaks
    native rendering, tap dispatch, or the `[solid-lynx parity]` report, so
    nothing *requires* a native check.
- [ ] Confirm deterministic root, listener, and stylesheet cleanup.
  - Root, listener, and ref cleanup are proven; the stylesheet half cannot be.
    `docs/contract.md` §9 names the mechanism and the covering test for each:
    node removal and per-root ownership (`test/renderer.test.ts:561`, `:1014`;
    browser `test/browser/lynx-for-web.test.ts:471`), listener-slot release on
    disposal (`:976`, `:821`), subtree detach and restore (`:789`), ref release
    (`:1163`; browser `:690`), one flush at the end of disposal (`:733`),
    independent disposal of roots sharing a page (`:1014`; browser `:527`), and
    remount with fresh listeners (`:853`; browser `:527`).
  - Stylesheet cleanup is unconfirmable in this release: the renderer never loads
    a stylesheet (`docs/contract.md` §8, §9 "Not proven / not applicable"), and
    the native stylesheet lifecycle is **unmeasured** — the probe card exists
    (`examples/lynx-for-native/src/stylesheet-probe.ts`, built by `pnpm
    native:build`) but has not run on a device. Native cleanup after `dispose()`
    is unmeasured for the same reason. This box stays open until at least the
    stylesheet probe has a device run.
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

**Status of this milestone:** not complete. Two of the five items are done; the
remaining three are blocked on a version matrix and a native runtime in CI, and
on the native stylesheet measurement.

## Out of scope for the renderer

These remain the responsibility of the surrounding Lynx app framework or toolchain unless a focused integration is added:

- Native navigation and application lifecycle ownership
- Rspeedy bundling internals beyond Solid-specific integration
- Lynx's dual-thread worklet compiler and runtime scheduling
- Native modules and platform services
