# Roadmap

This roadmap describes the intended direction for `solid-lynx`. Milestones are ordered by dependency and confidence, not by release date. Version labels are planning targets, not release promises.

## 0.2: Runtime confidence

Validate the renderer against Lynx Element PAPI in Lynx Explorer or on a device, then close correctness and lifecycle gaps.

- [ ] Exercise page creation, mounting, text updates, insertion, removal, and reordering in a real Lynx runtime.
- [ ] Verify attribute, style, dataset, boolean-property, and flush behavior against current Lynx APIs.
- [ ] Test event dispatch, propagation, capture, global bindings, namespaced handlers, replacement, and removal.
- [ ] Make root disposal detach event listeners and release all rendered nodes deterministically.
- [ ] Test multiple isolated roots and document whether disposed roots can be mounted again.
- [ ] Add regression coverage for each behavior confirmed in the native runtime.

**Milestone complete when:** core rendering, event, flush, and disposal behavior is verified in Lynx and covered by automated regression tests where the behavior can be simulated.

## 0.3: Tooling and types

Make Solid-on-Lynx projects straightforward to configure and author.

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
- [ ] Test shared rendering behavior against Lynx-for-Web in a browser.
- [ ] Publish examples for forms, keyed lists, asynchronous content, and platform-specific capabilities.

**Milestone complete when:** supported platform features have documented contracts and tests, and unsupported capabilities fail clearly rather than silently degrading.

## 1.0: Stability

Set a stable public contract after native validation and tooling have matured.

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
