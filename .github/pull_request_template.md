## What changed

<!-- One or two sentences. Name the files a reviewer should read first. -->

## Checks

All of these must be green on the PR head before merge. They are the same
commands `.github/workflows/ci.yml` runs; run them locally in this order.

- [ ] `pnpm typecheck` — exit 0
- [ ] `pnpm typecheck:consumer` — exit 0 (JSX/event type surface still compiles against `dist/`)
- [ ] `pnpm test` — exit 0
- [ ] `pnpm build` — exit 0
- [ ] `pnpm pack --dry-run` — exit 0, and the new entry points/files actually appear
- [ ] `PLAYWRIGHT_PORT=<free port> pnpm web:test` — exit 0
- [ ] `PLAYWRIGHT_PORT=<other free port> pnpm exec playwright test --config test/browser/patterns.playwright.config.ts` — exit 0
- [ ] `pnpm native:build` — exit 0

CI (`unit`, then `browser` and `native-build`) must be green too; a local pass on
a different Node version is not the same evidence (`docs/compatibility.md` §8).

## Native device run

Tick one. CI compiles the native bundle and executes nothing, so this is hand
work on the A03 (`adb -s R9WT911JVVH`; the tablet `19779010` is not yours to
target).

- [ ] **Not required** — this PR does not change native-facing behaviour
      (`src/lynx-host.ts`, event names or dispatch, CSS ids, list callbacks, or
      anything else that changes the emitted native bundle).
- [ ] **Required and done** — the behaviour changed, and the run is recorded:
      - [ ] `adb -s R9WT911JVVH get-state` returned `device`, not an error
      - [ ] A03 smoke card: `[solid-lynx parity]` line captured, result recorded in `docs/parity-checklist.md`
      - [ ] `examples/lynx-for-native/scripts/run-stylesheet-probe.sh --dry-run` reviewed if the stylesheet PAPI moved
      - [ ] `docs/capabilities.md` updated with what the run actually showed
      - [ ] Captures in `/tmp/solid-lynx-logs` read, not just produced

A PR that changes native-facing behaviour and has neither box ticked is not
mergeable. "CI was green" is not a native result.

## Docs the change forces

- [ ] `docs/contract.md` updated when any public signature, status
      (stable/provisional/unsupported), or contract behaviour changes — including
      the line numbers and test citations it quotes.
- [ ] `docs/compatibility.md` updated when a dependency version, supported
      range, or the `engines` field changes; `pnpm-lock.yaml` changed with it.
- [ ] `README.md` and `docs/migration.md` updated when a consumer-visible API
      or behaviour changes.
- [ ] Version bump, if any: `package.json` and `src/index.ts` say the same thing,
      and `CHANGELOG.md` has an entry for it (`docs/release.md` §2).
- [ ] `docs/capabilities.md` updated when a capability's measured status moves.
      Do not move a capability row without a run behind it.

## Claims

- [ ] **No unmeasured native capability is claimed.** Wording matches
      `docs/capabilities.md` "Remaining blockers" and `docs/contract.md` §16:
      measured is measured, unmeasured says so.
