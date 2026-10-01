# Roadmap

This roadmap describes the intended direction for `solid-lynx`. Milestones are ordered by dependency and confidence, not by release date. Version labels are planning targets, not release promises.

## 0.2: Lynx-for-Web integration

Establish a browser-based Lynx runtime path so renderer development does not depend on access to a physical device. The browser target must preserve Lynx semantics instead of replacing the host with ordinary DOM rendering.

- [x] Add a host-only browser fixture using `@lynx-js/web-core/client` and a static `<lynx-view>`.
- [ ] Build and load a Solid Lynx bundle through the web Element PAPI path. The current Rspeedy attempt emitted a web JavaScript chunk instead of a `.lynx.bundle`.
- [ ] Exercise page creation, mounting, text updates, insertion, removal, and reordering in the browser runtime.
- [ ] Verify attribute, style, dataset, boolean-property, and flush behavior against the web PAPI implementation.
- [ ] Test event dispatch, propagation, capture, global bindings, namespaced handlers, replacement, and removal in a browser.
- [x] Add a focused Playwright smoke test for the web-core bootstrap and static `<lynx-view>` host.
- [ ] Add Playwright coverage for Solid rendering, reactivity, events, property updates, and disposal.
- [ ] Make root disposal detach event listeners and release all rendered nodes deterministically.
- [ ] Test multiple isolated roots and document whether disposed roots can be mounted again.
- [x] Keep the in-memory fake PAPI tests as fast unit-level regression coverage.

**Milestone complete when:** a browser can run a Solid Lynx bundle through `@lynx-js/web-core` and `<lynx-view>`, with core rendering, event, flush, and disposal behavior covered by automated tests.

## 0.3: Native parity, tooling, and types

Validate native-specific behavior after the web path is working, while making Solid-on-Lynx projects straightforward to configure and author.

- [ ] Run a native Lynx smoke test in Lynx Explorer or on an Android/iOS device.
- [ ] Compare native and web behavior for shared Element PAPI operations.
- [ ] Verify native-only behavior such as dual-thread execution, worklets, and first-screen synchronization.
- [ ] Provide a reproducible Rspeedy integration, preferably as a small plugin or maintained configuration package.
- [ ] Document native and Lynx-for-Web build configurations and development workflows.
- [ ] Replace broad intrinsic JSX types with Lynx element and attribute types, using `@lynx-js/types` where compatible.
- [ ] Add typed event props and payloads, refs, styles, datasets, and custom elements.
- [ ] Add JSX compile and package-consumer fixtures to verify `jsx-runtime` and `jsx-dev-runtime` behavior.
- [ ] Expand tests for Solid control flow, keyed reconciliation, dynamic properties, event updates, and root isolation.

**Milestone complete when:** a fresh example app can be built from documented instructions and common Lynx JSX usage receives useful TypeScript checking.

## 0.4: Lynx platform capabilities

Add platform features through explicit, testable adapters while keeping the core host contract small.

- [ ] Integrate stylesheet loading, CSS ids, and stylesheet lifecycle where the Lynx PAPI requires it.
- [ ] Add refs and imperative element access with deterministic cleanup.
- [ ] Evaluate native list virtualization and expose list callbacks if the Solid model can support them cleanly.
- [ ] Evaluate gesture, animation, and portal/overlay APIs as separate capabilities.
- [ ] Publish examples for forms, keyed lists, asynchronous content, and platform-specific capabilities.

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
