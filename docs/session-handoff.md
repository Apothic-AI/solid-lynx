# Fresh Session Handoff

Read this file first when resuming development in a fresh OpenCode session.

## Repository State

- Repository: `/home/bitnom/Code/solid-lynx` (`master`), plus per-tranche git
  worktrees under `/home/bitnom/Code/solid-lynx-wt/`. Work in the worktree you
  were given: it sits on its own `wt/...` branch.
- Version is `1.0.0` in `package.json` and `src/index.ts`, and the contract is
  frozen in [contract.md](contract.md). Check `git status --short --branch` and
  recent commits before editing, because `master` moves under a worktree while
  other tranches land.
- No changes from this work have been pushed.
- Do not amend or rewrite the existing commits. Continue with new commits.

Recent milestone commits:

- `faca97c` one native probe runner for all three cards.
- `8b01d05` idempotent disposal and CSS-id survival across a remount.
- `d8562dd` native list measurement card; `2bcac14` the indexed list row model
  and both probe cards with their recorder tests.
- `0d77793` contract frozen; `5ecace6` versions pinned; `002b786` migration and
  compatibility guidance; `a7d225c` CI workflow; `5c98160` release process.
- `cb18960` native page creation and PrimJS handle compatibility; native parity/docs.
- `bf0293d` 0.4 capability documentation and roadmap reconciliation.
- `0d1a715` owner-cleaned refs and root-scoped CSS ids.
- `62720ba` platform capability probe and forms/keyed-list/async example.
- `94d8239`, `882d0b5`, `036a442` reusable Rspeedy plugin, PAPI parity harness,
  build docs, and typed JSX consumer fixtures.
- `8a157ad`, `6a5e973`, `64ffd33`, `1d05efd` completed browser lifecycle, PAPI
  property, event, and keyed reconciliation coverage.

## Verified Checks

Every command below was run in the `wt/docs-refresh` worktree at commit
`3d12026` on Node `v22.23.3` / pnpm `12.9.1`, with the results in the comments.
They exited 0 unless the line says otherwise. Re-run them and read the counts
out of your own output rather than out of this file — these numbers are dated.

```bash
pnpm typecheck                     # exit 0
pnpm typecheck:consumer            # exit 0; test/consumer/tsconfig.json + tsconfig.dev.json
pnpm test                          # exit 0; 121 tests in 7 files (test/renderer.test.ts 62,
                                   #   test/native-parity-verify.test.ts 19, test/list-probe-report.test.ts 14,
                                   #   test/parity.test.ts 9, test/stylesheet-probe-report.test.ts 7,
                                   #   test/rspeedy.test.ts 6, test/packaging.test.ts 4)
pnpm build                         # exit 0
pnpm pack --dry-run                # exit 0; 43 tarball entries (30 under dist/, 8 under docs/,
                                   #   plus LICENSE, package.json, README.md, CHANGELOG.md,
                                   #   ROADMAP.md) as solid-lynx-1.0.0.tgz
pnpm native:build                  # exit 0; dist/main.lynx.bundle, dist/stylesheet-probe.lynx.bundle,
                                   #   dist/list-probe.lynx.bundle
PLAYWRIGHT_PORT=4230 pnpm web:test # exit 0; 17 browser tests in 54.7s
PLAYWRIGHT_PORT=4231 pnpm exec playwright test \
  --config test/browser/patterns.playwright.config.ts
                                   # exit 0; 9 tests in 39.7s
```

The A03 run reported all 20 shared Element PAPI parity operations passing,
rendered the native card, and verified a `bindtap` counter update. **Its logcat
capture was left in `/tmp` and is gone**, so [parity-checklist.md](parity-checklist.md)
marks the native column reported, not reproduced and separates unmeasured runtime
behavior. `node scripts/verify-native-parity.mjs <capture>` is the check a fresh
run has to pass before those rows can be cited as a present result.

`pnpm typecheck` and `pnpm test` both run `pnpm build` first, and `pnpm test`
ends with `pnpm typecheck:consumer` (`package.json`), so a failure in those
steps can surface under the earlier command name.

**The two browser suites take minutes, and running suites concurrently makes
the pattern suite flaky.** Cold Vite dependency optimization plus Lynx wasm
start-up dominates: in this session the Lynx-for-Web suite was ~60s wall clock
and the pattern suite ~40s, each with its own `webServer` build and serve step.
Do not read a slow first test as a regression — both suites already retry once
after a reload for exactly this reason (`test/browser/patterns.test.ts`,
`test/browser/lynx-for-web.test.ts`).

Observed in this session, and worth recognising rather than debugging: while a
second agent ran the pattern suite in another checkout at the same time, that
run failed the `indexed list model › re-installs the callbacks on a model change
and releases rows that left` test with `the pattern card never rendered` and
`page errors: none`, `console errors: none`, `failed requests: none` — i.e. the
30s render-poll timed out with a clean page, not a page error. That is a
concurrency/load artifact of running several suite+agent combinations at once,
not a product bug. Re-run the suite on its own and it passes 9/9; if you see
that message, check what else is running (`ps aux | grep -i playwright`, and
whether another checkout holds a port) before you change any code.

The A03 run passed all 20 shared Element PAPI parity operations, rendered the
native card, and verified a `bindtap` counter update; [parity-checklist.md](parity-checklist.md)
contains the native per-operation results and separates unmeasured runtime
behavior. **That is the only device evidence in this tree.** Nothing native has
been re-run for `1.0.0`: `adb -s R9WT911JVVH get-state` printed
`error: device 'R9WT911JVVH' not found` and exited 1 when this file was updated,
so native parity is reported, not reproduced (see "Remaining Work").

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
- **The stylesheet and list probes are built, unit-tested, and unmeasured.**
  `examples/lynx-for-native/src/stylesheet-probe.ts` and
  `examples/lynx-for-native/src/list-probe.ts` both build through
  `pnpm native:build` (`dist/stylesheet-probe.lynx.bundle`,
  `dist/list-probe.lynx.bundle`) and their recorders are covered by host-free
  tests (`test/stylesheet-probe-report.test.ts` 7 tests,
  `test/list-probe-report.test.ts` 14 tests). **No device run of either card
  exists.** Their A03 runs have not happened: `adb -s R9WT911JVVH get-state`
  reported `error: device 'R9WT911JVVH' not found` (exit 1) while this file was
  updated. Until those runs exist, the three stylesheet operations are known to
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
- **Native parity evidence is currently reported, not reproduced.** The twenty
  shared Element PAPI operations were recorded from the A03 in
  [parity-checklist.md](parity-checklist.md). There is no `test/fixtures/native-parity`
  directory and no `scripts/verify-native-parity.mjs` in this tree, and nothing
  in the docs references either, so no automated verifier resolves the recorded
  evidence: the verifier is in flight, not present. Quote the checklist as a
  hand run, and do not describe it as verified by a script.
- The web host does not implement runtime stylesheet loading/lifecycle. It has no
  corresponding stylesheet PAPI.
- Web-core global-bind callbacks are registered but its global dispatch pass does
  not invoke function callbacks; this host limitation is documented.
- The renderer has a list adapter and an indexed row model (`root.createList()`),
  measured against web-core only. A 2026-10-09 A03 smoke rendered the existing
  native card and verified its counter tap from 0 to 1; that card did not create
  a list or exercise either list callback, so native list behavior remains
  unverified. No host has been seen to recycle a cell.
- **Package identity is undecided.** `package.json` is still named
  `solid-lynx`, but that name on npm belongs to an unrelated package:
  `npm view solid-lynx version license maintainers` reports `1.0.0`, `MIT`,
  `pranshuchittora` (this project ships Apache-2.0). There are no git tags, no
  `publishConfig`, and no release workflow, so nothing here has ever been
  published ([release.md](release.md) §5). Do not treat a version bump as a
  release, and do not publish until the name is decided.
- Gesture PAPI functions are web-core no-op stubs; animation PAPI exists but is
  not exposed by the renderer; overlays/portals are not implemented.
- `@lynx-js/types` is not installed/resolvable in this package; current JSX types
  are a bounded local surface, not an exhaustive official native schema.

## Current Tranche

The tranche that produced `1.0.0` is closed on documentation and automation. What
landed, and where to read it:

- **Contract frozen.** [contract.md](contract.md) records every public signature
  with a status (stable, provisional, unsupported) and the test that covers it;
  §16 lists the exported surface with no automated test. Two version strings in
  that document are stale: line 3 says `solid-lynx@0.1.0`, and the `version`
  paragraph says the string is `"0.1.0"` at `src/index.ts:70`. `package.json`,
  the exported constant (line 72), and README's status line all say `1.0.0`.
  That is documentation drift; the constant is authoritative and no test asserts
  it (contract §16), so a version bump has to be checked by hand.
- **Compatibility pinned.** [compatibility.md](compatibility.md) fixes the exact
  `solid-js`, `@lynx-js/web-core`, `@lynx-js/rspeedy`, `@lynx-js/lynx-core`, and
  Rsbuild plugin versions the contract was verified against, and §8 states what
  the pins do not claim (the Node and Solid ranges in CI, no native runtime in
  CI).
- **Migration guide.** [migration.md](migration.md) is the `0.x` → frozen
  contract upgrade path: refs, CSS ids, event props, JSX types, the
  `<list>` → `root.createList()` move, root lifecycle.
- **CI and PR template.** `.github/workflows/ci.yml` has five jobs (`unit`;
  `node-matrix`, standing alone; then `solid-matrix`, `browser`, and
  `native-build`, all `needs: unit`); `.github/pull_request_template.md`
  repeats the same checks and adds the native-device question. CI compiles the
  native bundle and **executes nothing native**.
- **Release process and 1.0.0.** [release.md](release.md) is the cut order with
  the command behind each step; [CHANGELOG.md](../CHANGELOG.md) carries the
  `1.0.0` entry, and `package.json` and `src/index.ts` both say `1.0.0`. Nothing
  is tagged or published ([release.md](release.md) §5).

[ROADMAP.md](../ROADMAP.md) records the milestone honestly: three of the five
`1.0` items are done (the documented contracts, migration/compatibility guidance,
and the version ranges — Node via `node-matrix`, Solid via `solid-matrix`), and
the milestone is **not complete**. The open items are a native runtime check in
CI and deterministic stylesheet cleanup — the latter cannot be confirmed until
the stylesheet probe has a device run.

Two blockers remain, and neither is resolvable from a fresh session's shell:

1. **A03 device run for the probes.** The stylesheet and list cards are built and
   unit-tested but have no device result, so native stylesheet lifecycle and
   native list behavior stay unmeasured and no release may claim them. Needs the
   A03 attached at `R9WT911JVVH`.
2. **Package name decision.** The npm name `solid-lynx` is occupied by an
   unrelated package, so publishing needs a different name — an owner decision,
   not a code change.

## Resume Procedure

1. Check `git status --short --branch` and recent commits before editing.
2. Read [ROADMAP.md](../ROADMAP.md), [building.md](building.md), and the relevant
   capability/parity sections before claiming a milestone complete.
3. For Android work, load the `artemis-android-multi-user` skill and use only
   `R9WT911JVVH` with explicit `adb -s` targeting.
4. Preserve existing user work, add focused tests, run the relevant checks, and
   commit only when requested or explicitly delegated. Never push unless asked.
