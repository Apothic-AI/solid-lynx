# Fresh Session Handoff

Read this file first when resuming development in a fresh OpenCode session.

## Repository State

- Repository: `/home/bitnom/Code/solid-lynx`
- Branch: `master`, with implementation baseline `cb18960`; local branch is ahead
  of `origin/master`. Check status and recent commits because this handoff is
  maintained in follow-up documentation commits.
- No changes from this work have been pushed.
- Do not amend or rewrite the existing commits. Continue with new commits.

Recent milestone commits:

- `cb18960` native page creation and PrimJS handle compatibility; native parity/docs.
- `bf0293d` 0.4 capability documentation and roadmap reconciliation.
- `0d1a715` owner-cleaned refs and root-scoped CSS ids.
- `62720ba` platform capability probe and forms/keyed-list/async example.
- `94d8239`, `882d0b5`, `036a442` reusable Rspeedy plugin, PAPI parity harness,
  build docs, and typed JSX consumer fixtures.
- `8a157ad`, `6a5e973`, `64ffd33`, `1d05efd` completed browser lifecycle, PAPI
  property, event, and keyed reconciliation coverage.

## Verified Checks

Most recent complete repository checks on the implementation:

```bash
pnpm typecheck
pnpm typecheck:consumer
pnpm test                 # 54 unit tests
pnpm build
PLAYWRIGHT_PORT=4186 pnpm web:test  # 17 browser tests
PLAYWRIGHT_PORT=4200 pnpm exec playwright test \
  --config test/browser/patterns.playwright.config.ts  # 5 tests
pnpm native:build
pnpm pack --dry-run
```

The A03 run passed all 20 shared Element PAPI parity operations, rendered the
native card, and verified a `bindtap` counter update. [parity-checklist.md](parity-checklist.md)
contains the native per-operation results and separates unmeasured runtime
behavior.

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

The authoritative checklist is [ROADMAP.md](../ROADMAP.md); detailed platform
evidence is in [capabilities.md](capabilities.md).

- Native dual-thread/worklet/first-screen behavior remains unverified and is not
  implemented by this renderer.
- Native `global-bind` delivery, event propagation/capture parity, CSS-id
  execution, and runtime stylesheet PAPI semantics remain unmeasured.
- The A03 exposes `__LoadStyleSheet`, `__AdoptStyleSheet`, and
  `__ReplaceStyleSheets`, but the app has not tested their signatures or
  lifecycle. Do not infer support from names alone.
- The web host does not implement runtime stylesheet loading/lifecycle. It has no
  corresponding stylesheet PAPI.
- Web-core global-bind callbacks are registered but its global dispatch pass does
  not invoke function callbacks; this host limitation is documented.
- List virtualization needs a renderer-side indexed row model. Gesture PAPI
  functions are web-core no-op stubs; animation PAPI exists but is not exposed by
  the renderer; overlays/portals are not implemented.
- `@lynx-js/types` is not installed/resolvable in this package; current JSX types
  are a bounded local surface, not an exhaustive official native schema.

## Resume Procedure

1. Check `git status --short --branch` and recent commits before editing.
2. Read [ROADMAP.md](../ROADMAP.md), [building.md](building.md), and the relevant
   capability/parity sections before claiming a milestone complete.
3. For Android work, load the `artemis-android-multi-user` skill and use only
   `R9WT911JVVH` with explicit `adb -s` targeting.
4. Preserve existing user work, add focused tests, run the relevant checks, and
   commit only when requested or explicitly delegated. Never push unless asked.
