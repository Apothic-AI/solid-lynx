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

**What is actually verified:** only Node 22.23.3. Node 20.19.x and Node 22.12.x
are within the declared range but were **not run** for this change. Treat the
range as the widest defensible claim and the verified point as a single version.

Note that `engines` is advisory unless a consumer's package manager enforces it;
pnpm does by default, npm warns.

## 2. Solid

| Source | Value |
| --- | --- |
| `package.json` `peerDependencies.solid-js` (after this change) | `^1.9.15` |
| `package.json` `devDependencies.solid-js` (after this change) | `1.9.15` (pinned) |
| `pnpm-lock.yaml` resolved | `solid-js@1.9.15` |
| `babel-preset-solid@1.9.15`'s own `peerDependencies.solid-js` | `^1.9.15` |
| Previously | `peerDependencies` said `^1.9.0`, `devDependencies` said `^1.9.9` |

**Why the peer range changed.** The package's compile path is
`babel-preset-solid`, and the version this repository builds with
(`1.9.15`, now pinned) declares `solid-js` peer `^1.9.15`. Promising `^1.9.0`
would claim compatibility with Solid versions the installed compiler does not
support. The new range is `babel-preset-solid`'s own peer range, not an invented
one.

**What is actually verified:** one Solid version, `1.9.15`, in every check in
this repository. `1.9.0`–`1.9.14` are excluded deliberately; a consumer on an
older Solid must upgrade. No Solid 2.x exists to test.

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

## 7. Supported-version summary

| Component | Supported now | Evidence | Width |
| --- | --- | --- | --- |
| Node.js | `^20.19.0 \|\| >=22.12.0`; verified on 22.23.3 | toolchain `engines`, README | range, one version run |
| pnpm | `12.9.1`, pinned by `packageManager: "pnpm@12.9.1"` in `package.json` | `package.json`, CI `pnpm/action-setup` | single version |
| Solid | `^1.9.15`; verified on 1.9.15 | `babel-preset-solid` peer, lockfile | narrow, one version run |
| `@lynx-js/web-core` | 0.26.2 only | lockfile, browser suite | single version |
| `@lynx-js/lynx-core` | 0.1.4 only | lockfile | single version |
| Lynx Explorer / engine | 4.1.0 / 3.5 only | `docs/building.md`, device run | single version, one hand run |
| `@lynx-js/rspeedy` | 0.18.0 only | lockfile, `web:build`/`native:build` | single version |
| `@rsbuild/core` | `^2.0.0` peer; 2.2.11 verified | plugin peers, lockfile | narrow |
| TypeScript | `^5.8.3`; 5.9.3 verified | devDependency, lockfile | narrow |

## 8. What this document does not claim

- **No version matrix in CI.** `.github/workflows/ci.yml` runs one Node version
  (`node-version: 22`) on `ubuntu-latest`, with one Solid, one `@lynx-js/web-core`,
  and one Lynx toolchain — the versions pinned in `package.json`. It does not
  test Node 20.19.x, any Solid other than 1.9.15, or any other `0.x` web-core. CI
  therefore repeats the local gate; it does not widen the supported set.
- **No native runtime in CI.** The `native-build` job compiles the bundle and
  uploads it as an artifact. No device or emulator is attached, so nothing native
  is executed by CI (`.github/workflows/ci.yml`, the comment above
  `native-build`).
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
- **No @lynx-js/types version.** The package is not installed, so no version of
  the official typings is supported or claimed. See
  [contract.md](contract.md) §12.
- **Node 20.19.x and Node 22.12.x were not run**, only 22.23.3. They are inside
  the declared range because the toolchain's own `engines` fields admit them,
  and for no other reason.

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

CI (`.github/workflows/ci.yml`) repeats steps 1-2 on `node-version: 22` plus both
browser suites and the native build, so a green CI run is the same evidence as a
green local run on Node 22 — not evidence for any other Node version. Step 3's
native hand run is never covered by CI.

The consumer fixture gate matters most in step 2: `pnpm typecheck:consumer`
compiles `test/consumer/tsconfig.json` and `test/consumer/tsconfig.dev.json`
against the built `dist/`, so a version bump that changes the JSX or event type
surface fails there even if the renderer still runs.
