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
- [ ] `node scripts/require-native-evidence.mjs --range <base>..HEAD` — exit 0
      (`<base>` is this PR's base sha; the `native-evidence` job runs the same
      command for you)

CI (`unit`, then `browser`, `native-build`, and `native-evidence`) must be green
too; a local pass on a different Node version is not the same evidence
(`docs/compatibility.md` §8).

## Native evidence

This section is checked, not just asked. `scripts/require-native-evidence.mjs`
computes whether this PR touches native-facing behaviour and fails the
`native-evidence` job if it does and carries no satisfying record; the full path
list is `NATIVE_FACING_PATHS` in that script and is documented in
`docs/evidence/native/README.md`. One of the first two boxes below therefore has
to be true of the committed diff, not of this text.

- [ ] **No native-facing path changed** — `src/` files the native bundle reaches,
      `src/host.ts` / `src/jsx-types.ts`, `src/rspeedy.ts`,
      `examples/lynx-for-native/`, or the `native-build` / `native-evidence` jobs.
      The check confirms this from the diff.
- [ ] **Native-facing, and the run is recorded** — both of:
      - [ ] The capture is committed at `docs/evidence/native/<date-or-id>/` with
            a `manifest.json`, and `node scripts/verify-native-parity.mjs` exits 0
            against that stored copy
      - [ ] `docs/parity-checklist.md` and `docs/capabilities.md` updated with
            what the run showed; the stylesheet probe reviewed if that PAPI moved
- [ ] **Native-facing, and no device run is needed** — a `decision.json` is
      committed at `docs/evidence/native/<date-or-id>/` with a reason, an author,
      a timestamp, and the paths it covers. Use this for a comment rewrite or a
      docs-only change inside native code, not for a behaviour change.

Hand work still required for a required run, on the A03
(`adb -s R9WT911JVVH`; the tablet `19779010` is not yours to target):

- [ ] `adb -s R9WT911JVVH get-state` returned `device`, not an error
- [ ] `examples/lynx-for-native/scripts/run-native-probe.sh smoke` captured the
      `[solid-lynx parity]` line, and it was read rather than only produced

Nothing in CI executes native code: `native-build` compiles the bundle and
`native-evidence` reads files. So a green `native-evidence` job means the
evidence is complete and re-verifiable, **not** that native behaviour was
measured on this PR. "CI was green" is not a native result.

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
