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
- [x] Add refs and imperative element access with deterministic cleanup.
- [x] Evaluate native list virtualization and expose list callbacks if the Solid model can support them cleanly.
- [x] Evaluate gesture, animation, and portal/overlay APIs as separate capabilities.
- [x] Publish examples for forms, keyed lists, asynchronous content, and platform-specific capabilities.

**Milestone complete when:** supported platform features have documented contracts and tests, and unsupported capabilities fail clearly rather than silently degrading.

## 1.0: Stability

Set a stable public contract after web validation, native validation, and tooling have matured.

- [ ] Finalize and document the public host, root, event, and JSX contracts.
- [ ] Define supported Lynx and Solid version ranges and verify them in CI.
- [ ] Require native and web compatibility checks for changes to shared behavior.
- [ ] Confirm deterministic root, listener, and stylesheet cleanup.
- [ ] Publish migration and compatibility guidance for breaking changes.

**Milestone complete when:** consumers can build and maintain a Solid Lynx app using documented APIs, with core behavior continuously validated in supported runtimes.

## Out of scope for the renderer

These remain the responsibility of the surrounding Lynx app framework or toolchain unless a focused integration is added:

- Native navigation and application lifecycle ownership
- Rspeedy bundling internals beyond Solid-specific integration
- Lynx's dual-thread worklet compiler and runtime scheduling
- Native modules and platform services
