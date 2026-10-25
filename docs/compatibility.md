# Compatibility

What this repository actually builds and tests against, and how narrow each
range is. The rule for this document: a version appears as *supported* only if
this repository has run against it or a manifest in the repository declares it.
Where only one version was ever exercised, that is stated instead of a range.

Every number below is traceable to `package.json`, `pnpm-lock.yaml`,
`docs/building.md`, `examples/*/lynx.config.ts`, or an installed package's own
manifest. Nothing here is inferred from a vendor release note.

## 1. Node.js

| Source | Value |
| --- | --- |
| `package.json` `engines.node` (after this change) | `^20.19.0 \|\| >=22.12.0` |
| Installed toolchain requires it | `vite@8.3.1`, `@lynx-js/rspeedy@0.18.0`, `@rsbuild/core@2.2.11` each declare `engines.node` = `^20.19.0 \|\| >=22.12.0` |
| Looser in the same graph | `vitest@3.2.7` declares `^18.0.0 \|\| ^20.0.0 \|\| >=22.0.0`; `@playwright/test@1.63.0` declares `>=20`; `@lynx-js/rsbuild-plugin@0.1.3` and `@lynx-js/vanilla-rsbuild-plugin@0.1.2` declare `>=18` |
| `README.md` "Development" (pre-existing) | "Use Node.js 20.19+ or 22.12+ with pnpm for the Rspeedy/Vite example toolchain." |
| Node the worktree was built and tested with | `v22.23.3` |
| pnpm used | `12.9.1` |

**Why the `engines` range changed.** It was `>=20`, which claims support for
Node 20.0–20.18 and Node 21. Those versions cannot install or run the toolchain
this repository depends on: `vite`, `@lynx-js/rspeedy`, and `@rsbuild/core` all
require `^20.19.0 || >=22.12.0`. `>=20` also admits any future major, which is
not something this repository has tested. The new range is the intersection of
the declared requirements of the three hard toolchain dependencies, and it
matches the sentence already in the README.

**What is actually verified:** the edges of the declared range, locally. This
repository ran the unit gate — `pnpm install --frozen-lockfile`,
`pnpm typecheck`, `pnpm test` — to exit 0 on 20.19.0, 20.20.2, 22.12.0,
22.23.3, and 24.22.1, each with 98 passing tests. The `node-matrix` job in
`.github/workflows/ci.yml` is written to run the same three commands as three
legs (`20.x`, `22.x`, `24.x`), which resolve to the newest release on each line
rather than to the floor — but **it has not run on GitHub Actions**: no workflow
has, for any commit on this branch. So the Node range is verified here and
declared for CI, not verified in CI. Node 21, 23, and 25 are outside the range
by declaration and were never run.

Note that `engines` is advisory unless a consumer's package manager enforces it.
npm warns. pnpm 12.9.1 does **not** enforce it by default either: installing a
dependency whose `engines.node` is `>=99.0.0` succeeded with exit 0 and no
warning, and the same install failed with `ERR_PNPM_UNSUPPORTED_ENGINE` only when
repeated with `--engine-strict`. So a consumer on Node 20.0 can install this
package, and the range above is a claim, not a gate — which is why `node-matrix`
exists.

## 2. Solid

| Source | Value |
| --- | --- |
| `package.json` `peerDependencies.solid-js` | `^1.9.15` |
| `package.json` `devDependencies.solid-js` | `1.9.15` (pinned) |
| `pnpm-lock.yaml` resolved | `solid-js@1.9.15` |
| `babel-preset-solid@1.9.15`'s own `peerDependencies.solid-js` | `^1.9.15` |
| `babel-preset-solid@1.9.16`'s own `peerDependencies.solid-js` | `^1.9.16` |
| Published `solid-js` inside `^1.9.15` | exactly `1.9.15`, `1.9.16`, `1.9.17` (`1.9.17` is `latest`); `1.9.14` and below and every `2.x` / `1.10.0-beta` are outside the range |
| Previously | `peerDependencies` said `^1.9.0`, `devDependencies` said `^1.9.9` |

**Why the peer range says `^1.9.15`.** The package's compile path is
`babel-preset-solid`, and the version this repository builds with
(`1.9.15`, now pinned) declares `solid-js` peer `^1.9.15`. Promising `^1.9.0`
would claim compatibility with Solid versions the installed compiler does not
support. The range is `babel-preset-solid`'s own peer range, not an invented one.

**What is actually verified:** all three versions the range admits, each run
against the gate in this repository. `1.9.15` is the pin the whole repository
builds against; `1.9.16` and `1.9.17` are overlaid on top of it and run by the
`solid-matrix` job in `.github/workflows/ci.yml`.

| Solid | `babel-preset-solid` | Where it runs | Result |
| --- | --- | --- | --- |
| `1.9.15` | `1.9.15` | `unit`, `node-matrix`, `browser`, `native-build`, every local run | green |
| `1.9.16` | `1.9.16` | `solid-matrix` leg 1 | green, locally |
| `1.9.17` | `1.9.16` | `solid-matrix` leg 2 | green, locally |

The two versions above the pin are run with the preset a consumer on that Solid
would resolve, which is why `1.9.17` uses the `1.9.16` preset: there is no
`babel-preset-solid@1.9.17` on npm, and `1.9.16`'s own peer range (`^1.9.16`)
admits `1.9.17`. Overriding only the runtime would test a pairing no consumer can
install.

**What was run, exactly.** On Node `v22.23.3` / pnpm `12.9.1`, each version
after `pnpm install --frozen-lockfile`, the overlay applied, and then:

| Command | `1.9.16` / preset `1.9.16` | `1.9.17` / preset `1.9.16` |
| --- | --- | --- |
| `pnpm typecheck` | exit 0 | exit 0 |
| `pnpm test` | exit 0, 121 tests in 7 files at the time of that run | exit 0, 121 tests in 7 files at the time of that run |
| `pnpm web:build` | exit 0 | exit 0 |

Nothing failed on either version, so nothing was narrowed. `1.9.0`–`1.9.14`
remain excluded deliberately — a consumer on an older Solid must upgrade — and
no `1.10.x` or `2.x` is inside the range to test.

**Why `pnpm web:build` is one of the three.** `babel-preset-solid` is not
executed by `pnpm typecheck` or `pnpm test`: both name the preset in string
assertions but never load it. Verified by replacing the installed
`babel-preset-solid` with a stub whose entry throws — `pnpm typecheck` and
`pnpm test` still exited 0, while `pnpm web:build` failed with
`[BABEL]: BROKEN BPS LOADED`. Without the web build, a Solid bump that
type-checks but compiles badly would pass a job named after that Solid.

**How the overlay is applied, and the two mechanisms that did not work.** The
job appends an `overrides` entry to `pnpm-workspace.yaml` in the runner's working
directory — never committed — and installs with `pnpm install --no-frozen-lockfile`.
Neither `pnpm add` route survives a real run:

- `pnpm add -D --no-save` does not exist in the pinned pnpm `12.9.1`; it exits
  with `unexpected argument '--no-save'`.
- `pnpm add -D -E solid-js@1.9.17 babel-preset-solid@1.9.16` installs the
  overlay, but it rewrites `package.json` and `pnpm-lock.yaml`, and restoring
  those with `git checkout` makes pnpm's implicit pre-script install resync
  `node_modules` back to the committed pins. Measured: after that restore,
  `pnpm typecheck` printed `solid-js 1.9.17 → 1.9.15` and then exited 0, so the
  gate ran the pin while the job claimed the overlay. The overrides mechanism is
  part of pnpm's own configuration, so the pre-script install keeps it; with the
  committed `pnpm-lock.yaml` restored mid-run, the gate still ran on `1.9.17`.

`--no-frozen-lockfile` appears only in that job. An override is a resolution the
committed lockfile does not contain, so pnpm must re-resolve and a frozen install
refuses to. It is acceptable there because nothing in the job is authoritative:
`unit` and `node-matrix` run the same gate against the committed lockfile with
`--frozen-lockfile`, and `solid-matrix` has `needs: unit`. The re-resolve is also
wide — overriding one package rewrites the peer-resolution suffixes of many
unrelated entries (306–318 lockfile lines on this tree) — which is a second
reason its lockfile is scaffolding and never committed.

## 3. Lynx web runtime (`@lynx-js/web-core`)

| Source | Value |
| --- | --- |
| `package.json` `devDependencies["@lynx-js/web-core"]` (after this change) | `0.26.2` (pinned) |
| `pnpm-lock.yaml` resolved | `0.26.2` |
| Installed manifest | no `engines` field; peers `@lynx-js/lynx-core@0.1.4`, `tslib ^2.5.0`, `@lynx-js/animax 0.1.0-alpha.0` |
| `docs/capabilities.md` | measured against "`@lynx-js/web-core` 0.26.2" |
| Related runtime | `@lynx-js/lynx-core` `0.1.4` (pinned) |

**Range: none — one version.** `@lynx-js/web-core` is a pre-1.0 package on a
`0.x` line where a minor bump may be breaking by convention, and the renderer
calls private-looking `__`-prefixed Element PAPI globals whose stability the
package does not promise. This repository passes `@lynx-js/web-core` 0.26.2 to
the browser suite and nothing else. 0.26.2 is the only supported version; any
other version is untested, not "probably fine".

## 4. Lynx native runtime (Lynx Explorer / Lynx engine)

| Source | Value |
| --- | --- |
| `docs/building.md`, `docs/session-handoff.md` | Lynx Explorer **4.1.0** (`com.lynx.explorer`), engine **3.5** |
| Device | SM-A037U, Android 13 (API 33), serial `R9WT911JVVH` |
| APK digest recorded | SHA-256 `6ae29787a2166974c29c2f23d87f3b20a137abcf9a8c17903ad19f3fb7f00cb6`, `arm64-v8a` |
| `docs/parity-checklist.md` | all twenty shared Element PAPI operations were **reported** passing on this device on 2026-10-09; the capture is lost, so the column is reported, not reproduced |

**Range: none — one version, tested once, by hand.** There is no native version
matrix and no native *runtime* CI: `.github/workflows/ci.yml` builds the native
bundle (`pnpm native:build`) but attaches no device or emulator, and says so in
its own comment. Explorer 4.1.0 / engine 3.5 is the only native runtime this
project has ever loaded a bundle into. iOS has never been run. Older or newer
Explorer builds are untested.

Keeping this honest matters more than it looks: most of the "unsupported"
column in [contract.md](contract.md) and [capabilities.md](capabilities.md) is
about native behaviour that one hand run did not measure, not about behaviour
that was measured and failed.

## 5. Rspeedy and the build plugins

| Package | `package.json` (after this change) | Resolved | Own `engines.node` |
| --- | --- | --- | --- |
| `@lynx-js/rspeedy` | `0.18.0` (pinned) | 0.18.0 | `^20.19.0 \|\| >=22.12.0` |
| `@lynx-js/rsbuild-plugin` | `0.1.3` (pinned) | 0.1.3 | `>=18` |
| `@lynx-js/vanilla-rsbuild-plugin` | `0.1.2` (pinned) | 0.1.2 | `>=18` |
| `@rsbuild/core` | `2.2.11` (pinned) | 2.2.11 | `^20.19.0 \|\| >=22.12.0` |
| `@rsbuild/plugin-babel` | `2.1.0` (pinned) | 2.1.0 | — |
| `@babel/core` | `^7.28.0` | 7.29.7 | — |
| `babel-preset-solid` | `1.9.15` (pinned) | 1.9.15 | — |
| `typescript` | `^5.8.3` | 5.9.3 | — |
| `vite` | `^8.3.1` | 8.3.1 | `^20.19.0 \|\| >=22.12.0` |
| `vitest` | `^3.2.4` | 3.2.7 | — |
| `@playwright/test` | `^1.63.0` | 1.63.0 | `>=20` |

**Why these are pinned exactly.** `@lynx-js/rspeedy`, the two Lynx Rsbuild
plugins, `@lynx-js/lynx-core`, `@lynx-js/web-core`, `@rsbuild/core`,
`@rsbuild/plugin-babel`, `babel-preset-solid`, and `solid-js` are the packages
that decide what the emitted bundle *means*. This repository has run exactly the
versions in the table and no others. A `^` range there is a support claim with
no test behind it, so each is now an exact version. `pnpm-lock.yaml` already
resolved to these versions, so pinning changed no installed code.

`typescript`, `vite`, `vitest`, `@playwright/test`, and `@babel/core` keep their
caret ranges: they are build- and test-time tooling whose failures show up as a
red check in this repository rather than as a wrong consumer bundle. Their
lockfile-resolved versions are what this repository actually ran.

`@lynx-js/vanilla-rsbuild-plugin@0.1.2` declares peer
`@lynx-js/rspeedy` `^0.17.0 || ^0.18.0`, and `@lynx-js/rsbuild-plugin@0.1.3`
and `@rsbuild/plugin-babel@2.1.0` declare peer `@rsbuild/core` `^2.0.0`. Those
declarations are the source of the `^2.0.0` peer range this package declares for
`@rsbuild/core`.

`@lynx-js/rspeedy@0.18.0` declares peer `typescript` `5.1.6 - 6.0.x` but does
not declare an `@rsbuild/core` peer; the `@rsbuild/core` range for this package
comes from the two Babel/Rsbuild plugins, not from Rspeedy.

## 6. Peer dependencies this package declares

After this change, `package.json`:

```json
"peerDependencies": {
  "solid-js": "^1.9.15",
  "@rsbuild/core": "^2.0.0",
  "@rsbuild/plugin-babel": "^2.1.0",
  "babel-preset-solid": "^1.9.15"
},
"peerDependenciesMeta": {
  "@rsbuild/core": { "optional": true },
  "@rsbuild/plugin-babel": { "optional": true },
  "babel-preset-solid": { "optional": true }
}
```

Only `solid-js` is a non-optional peer, because only the runtime entry needs it:
`dist/index.js` and `dist/universal.js` import `solid-js` and
`solid-js/universal`. The other three are needed only by the
`solid-lynx/rspeedy` entry (`src/rspeedy.ts:1-2` imports `@rsbuild/core` and
`@rsbuild/plugin-babel`; `babel-preset-solid` is referenced by name in the preset
it emits), so a consumer that only renders — for example a test double built on
`createLynxRenderer` — does not need them. Declaring them as peers with
`optional: true` records the requirement without forcing an install.

There is no `dependencies` block. The runtime entry imports only `solid-js`; the
`@lynx-js/*` packages are the consuming app's toolchain, not this package's
runtime dependency, which matches what `README.md` "Install" already tells an
app to install.

**Covered by a test.** `test/consumer-install.test.ts` packs this workspace with
`pnpm pack`, unpacks the tarball into `<temp>/app/node_modules/solid-lynx`, copies
`solid-js` beside it and nothing else, and imports every documented entry in a
`node --input-type=module` child process whose cwd is that directory. The
permitted entry points import with **no toolchain peer present**, and
`solid-lynx/rspeedy` resolves through `exports` and fails only on a declared
optional peer — so this section's split between required and optional is measured
rather than argued. The test also fails if the packed manifest grows a
`dependencies` block or if any optional peer stops being `optional: true`.

## 7. Supported-version summary

| Component | Supported now | Evidence | Width |
| --- | --- | --- | --- |
| Node.js | `^20.19.0 \|\| >=22.12.0`; verified on 20.19.0, 20.20.2, 22.12.0, 22.23.3, 24.22.1 | toolchain `engines`, README, CI `node-matrix`, local runs | range, both floors and three line tops run |
| pnpm | `12.9.1`, pinned by `packageManager: "pnpm@12.9.1"` in `package.json` | `package.json`, CI `pnpm/action-setup` | single version |
| Solid | `^1.9.15`; verified on 1.9.15, 1.9.16, and 1.9.17 — the whole range | `babel-preset-solid` peer, lockfile, CI `solid-matrix`, local runs | range, every admitted version run |
| `@lynx-js/web-core` | 0.26.2 only | lockfile, browser suite | single version |
| `@lynx-js/lynx-core` | 0.1.4 only | lockfile | single version |
| Lynx Explorer / engine | 4.1.0 / 3.5 only | `docs/building.md`, device run | single version, one hand run |
| `@lynx-js/rspeedy` | 0.18.0 only | lockfile, `web:build`/`native:build` | single version |
| `@rsbuild/core` | `^2.0.0` peer; 2.2.11 verified | plugin peers, lockfile | narrow |
| TypeScript | `^5.8.3`; 5.9.3 verified | devDependency, lockfile | narrow |

## 8. What this document does not claim

- **One axis of a matrix, and no CI run yet.** Nothing in this repository has
  executed on GitHub Actions — `gh run list` for the repository returns no runs,
  and `.github/workflows/ci.yml` is not on `origin/master`. The `node-matrix`
  job is *written* to run the unit gate on `20.x`,
  `22.x`, and `24.x`, so Node 20 (lower line) and Node 24 (admitted by the
  open-ended `>=22.12.0`) would be exercised instead of only Node 22. The
  `solid-matrix` job is written to run the gate on `solid-js` 1.9.16 and
  1.9.17, the two published versions `^1.9.15` admits above the pin, and its
  steps were replayed locally (§2). Between them those are **the
  Node and Solid axes only**. They do not test any `@lynx-js/web-core` other than
  0.26.2, any Lynx toolchain other than the pinned set in `package.json`, or any
  OS other than `ubuntu-latest`. A green matrix would narrow the Node and Solid
  claims; it would not widen the supported set on any other axis. There is no
  green matrix yet — the local replays above are what exists.
- **The Solid matrix tests the full admitted range; a green run is what licenses
  that sentence.** `^1.9.15` admits exactly `1.9.15`, `1.9.16`, and `1.9.17`
  (checked against the published list; `1.9.14` and below and every `2.x` and
  `1.10.0-beta` are outside). `1.9.15` is what every other job resolves;
  `1.9.16` and `1.9.17` are overlaid by `solid-matrix` and ran green locally
  (§2). Two limits remain: the `solid-matrix` legs have not yet run on GitHub
  Actions, and the range stops at `1.9.17` only because that is the newest
  published version — a `1.9.18` would be admitted by the range and would need a
  matrix entry before it could be claimed.
- **The Solid legs override rather than pin.** `solid-matrix` installs with
  `pnpm install --no-frozen-lockfile` after appending an `overrides` entry to
  `pnpm-workspace.yaml`, because an override is a resolution the committed
  lockfile cannot contain. Nothing in that job is authoritative: `unit` and
  `node-matrix` run the same gate against the committed lockfile with
  `--frozen-lockfile` and it has `needs: unit`, so lockfile consistency is still
  `unit`'s claim, not `solid-matrix`'s. See §2 for the two `pnpm add` mechanisms
  that were tried and did not survive a real run.
- **No native runtime in CI.** The `native-build` job compiles the bundle and
  uploads it as an artifact. No device or emulator is attached, so nothing native
  is executed by CI (`.github/workflows/ci.yml`, the comment above
  `native-build`). The `native-evidence` job does not change that: it reads a
  diff and re-runs `scripts/verify-native-parity.mjs` over a stored capture, so a
  green run means the evidence is complete and re-verifiable, not that native
  behaviour was executed on the runner.
- **No second native runtime.** No iOS run, no newer or older Explorer build, no
  device other than the A03 recorded in `docs/building.md`.
- **No cross-host stylesheet or list claims.** [capabilities.md](capabilities.md)
  remains authoritative, and it marks native per-capability results as not
  measured.
- **No present-tense native parity claim.** The 2026-10-09 A03 run reported all
  twenty Element PAPI operations passing, but its capture was left in `/tmp`.
  [parity-checklist.md](parity-checklist.md) therefore marks the native column
  reported, not reproduced, and a native pass may be cited only once a stored
  capture verifies (`scripts/verify-native-parity.mjs`, exit 0).
- **No cross-OS claim.** Every matrix leg and every other job runs on
  `ubuntu-latest`. macOS and Windows are untested, so nothing here says the
  package installs or runs there.
- **No package-manager resolution claim.** The consumer test extracts the tarball
  itself instead of running `npm install`, precisely so it needs no registry. It
  proves the installed layout node resolves against, not that a package manager
  resolves this manifest's peer set the way this document says.
- **No @lynx-js/types version.** The package is not installed, so no version of
  the official typings is supported or claimed. See
  [contract.md](contract.md) §12.
- **The `20.x` / `22.x` / `24.x` matrix entries are line *tops*, and the floors
  were proven by hand instead.** `actions/setup-node` resolves `20.x` to the
  newest 20 and `22.x` to the newest 22, not to `20.19.0` or `22.12.0`, so a CI run
  would not by itself prove the declared floors. Those floors were run locally
  before this change: the unit gate exited 0 on both 20.19.0 and 22.12.0. Right
  now the local run is the only evidence there is, because no CI run exists.
  Node 21, 23, and 25 sit outside `^20.19.0 || >=22.12.0` by declaration and were
  never run.

### Running the Node matrix locally

The job is three commands on each Node line. There is no version file in this
repository and no committed Node manager config — `mise` happens to be what the
worktrees use, but nothing in the tree requires it — so pick whichever Node
manager you already have, switch the line, and repeat:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

Run it once on a 20 >= 20.19.0, once on a 22 >= 22.12.0, and once on any 24. Each
run rebuilds `dist/` (both `typecheck` and `test` start with `pnpm build`), so a
stale `dist/` cannot make a leg look green.

### Running the Solid matrix locally

The `solid-matrix` job is the same three commands after an overlay, which is why
it can be replayed here at all. On Node 22 with the committed pins installed:

```bash
pnpm install --frozen-lockfile
git checkout -- pnpm-workspace.yaml   # start from a clean workspace file
printf '\noverrides:\n  solid-js: 1.9.17\n  babel-preset-solid: 1.9.16\n' >> pnpm-workspace.yaml
pnpm install --no-frozen-lockfile
pnpm typecheck
pnpm test
pnpm web:build
git checkout -- package.json pnpm-lock.yaml pnpm-workspace.yaml
```

Swap the two versions for the `1.9.16` / `1.9.16` leg. Read the installed
versions back rather than trusting the install — `node -p
"require('solid-js/package.json').version"` — because a `git checkout` of the
manifests while an override is active is exactly the mistake that makes the gate
run the pin under a job named after the overlay (§2). The last line matters
before you commit anything: it is the pair of files the mechanism must never
move.

## 9. Changing a supported version

Because most entries above are exact versions, bumping one is a deliberate act:

1. Change the exact version in `package.json`, then run `pnpm install` so
   `pnpm-lock.yaml` records it. A `--frozen-lockfile` install must still pass.
2. Run the full local gate: `pnpm typecheck`, `pnpm typecheck:consumer`,
   `pnpm test`, `pnpm build`, `pnpm web:build`, `pnpm native:build`.
3. For anything that changes the emitted bundle, re-run the browser suite
   (`PLAYWRIGHT_PORT=<free> pnpm web:test` and the pattern config) and re-run the
   native parity card by hand, then update
   [parity-checklist.md](parity-checklist.md) — not just this file.
4. Update the table in §7 with the version you actually ran. Do not widen a
   range because a vendor notes compatibility; widen it when a check here ran
   green.
5. If the version is inside the declared `peerDependencies.solid-js` range,
   `solid-matrix` is where it gets its run: add the Solid and the
   `babel-preset-solid` a consumer on it resolves to the job's `matrix.include`
   in `.github/workflows/ci.yml` (§2), then run both locally as
   "Running the Solid matrix locally" above describes. A range bump and a matrix
   entry are the same commit, or the range publishes a version with no run behind
   it.

`.github/workflows/ci.yml` is written to repeat steps 1-2 on Node 22 plus both
browser suites and the native build, with the `node-matrix` job repeating the
unit gate on the `20.x`, `22.x`, and `24.x` Node lines and the `solid-matrix`
job repeating it on the two published Solids above the pin. **It has not run:**
no workflow has executed on GitHub Actions for any commit on this branch. The
`solid-matrix` steps were replayed locally (§2); `node-matrix`'s legs resolve
to line tops that were not re-run here.

Once it does run, a green CI run would be
evidence for three Node lines and every version inside the Solid peer range, all
on `ubuntu-latest` — not for the exact `20.19.0` / `22.12.0` floors, not for any
other OS, and not for any other version axis. Step 3's native hand run is never
covered by CI.

The consumer fixture gate matters most in step 2: `pnpm typecheck:consumer`
compiles `test/consumer/tsconfig.json` and `test/consumer/tsconfig.dev.json`
against the built `dist/`, so a version bump that changes the JSX or event type
surface fails there even if the renderer still runs.
