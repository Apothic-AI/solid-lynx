# Cutting a release

How a release of `@apothic-ai/solid-lynx` — called solid-lynx everywhere else in
this repository — is cut, in the order it happens, with the command that proves
each step. Every command below was run in this repository at commit
`002b786` on Node `v22.23.3` / pnpm `12.9.1`, unless the step says **not run**
next to it. Where a step is not automated, that is stated rather than implied.

**Where this package actually is.** There are no git tags and
`.github/workflows/` contains only `ci.yml` — there is no release workflow. The
manifest's `name` is `@apothic-ai/solid-lynx` and it carries
`publishConfig.access: "public"`, because the unscoped name `solid-lynx` on npm
already belongs to a different package (`npm view solid-lynx license maintainers`
reports `MIT` and `pranshuchittora`; `npm view solid-lynx time.created` reports
`2025-03-10`). This repository has therefore **never published**, and the publish
half of this document is a description of what a publish would do, not a
procedure anyone has completed. Read §5 before you read anything into the word
"release".

## 1. Pre-flight: the gate CI would repeat

`.github/workflows/ci.yml` defines six jobs: `unit`, `node-matrix`, `solid-matrix`,
`browser`, `native-build`, `native-evidence`. `browser`, `native-build`, and
`native-evidence` all `needs: unit`, so `unit` gates them; `solid-matrix` also
has `needs: unit`. `node-matrix` has no `needs:` on purpose, so a failing matrix
leg reads as the matrix rather than as the unit gate. Every step below runs the same command a developer runs locally;
none needs a secret. Green means exit status 0 on that exact command.

**No workflow has executed on GitHub Actions for this repository.** The file is
validated by static parse and every command in it has been replayed locally at
named commits — that is what the "Result here" column records — but the jobs
themselves, their `needs:` edges, and every `actions/*` step are unexecuted. So a
green row below means "this command passes here", never "CI ran it and passed".

| CI job | Step in `ci.yml` | Command | Green means | Result here |
| --- | --- | --- | --- | --- |
| `unit` | Install | `pnpm install --frozen-lockfile` | lockfile and `package.json` agree; no resolution step | exit 0 |
| `unit` | Type check | `pnpm typecheck` | `tsc -p tsconfig.build.json`, then `tsc --noEmit`, then both consumer fixtures | exit 0 |
| `unit` | Type check consumer fixtures | `pnpm typecheck:consumer` | `test/consumer/tsconfig.json` and `test/consumer/tsconfig.dev.json` compile against the built `dist/` | exit 0 |
| `unit` | Unit tests | `pnpm test` | Vitest: every test file passes | exit 0, **228 tests in 11 files** |
| `unit` | (inside `pnpm test`) | `test/documented-counts.test.ts` | every document that states this suite's size agrees with the measured size | exit 0; a stale count in README, CHANGELOG, ROADMAP or `docs/` is a test failure, not a review note |
| `unit` | Build | `pnpm build` | `dist/` is written | exit 0 |
| `unit` | Package contents | `pnpm pack --dry-run` | the tarball builds and lists its contents | exit 0, 46 entries |
| `node-matrix` | Install / Type check / Unit tests, on `20.x`, `22.x`, `24.x` | `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test` | the unit gate passes at the top of each declared Node line | exit 0 on 20.20.2, 22.23.3, 24.22.1 locally (98 tests each at that commit — the count predates `test/packaging.test.ts`, which was added afterwards and is not re-measured here; the floors 20.19.0 and 22.12.0 also exit 0) |
| `browser` | Install Chromium | `pnpm exec playwright install --with-deps chromium` | Chromium present for Playwright | **not run** — the browser was already installed in this worktree; CI runs it because the runner starts bare |
| `browser` | Lynx-for-Web suite | `PLAYWRIGHT_PORT=4186 pnpm web:test` | builds the web bundle, serves it, drives it in Chromium | exit 0, **17 passed** (43.8s, on the 1.9.17 overlay — the pinned run was 54.2s) |
| `browser` | Pattern suite | `PLAYWRIGHT_PORT=4200 pnpm exec playwright test --config test/browser/patterns.playwright.config.ts` | the separate `examples/lynx-patterns` suite passes | exit 0, **9 passed** (41.5s) |
| `native-build` | Build the native bundle | `pnpm native:build` | `examples/lynx-for-native/dist/` holds the three bundles | exit 0, `main`, `stylesheet-probe`, `list-probe` |
| `native-evidence` | Require native evidence for this pull request | `node scripts/require-native-evidence.mjs --range <pr base sha>..HEAD` | a native-facing change carries a committed capture the verifier for its card accepts, or a recorded decision | **not run on GitHub Actions**; the script's 50 host-free tests are, and the four exit codes were demonstrated by hand (§3) |
| `solid-matrix` | Install / Overlay / Type check / Unit tests / Web build, on solid `1.9.16`+preset `1.9.16` and solid `1.9.17`+preset `1.9.16` | `pnpm install --frozen-lockfile`, `pnpm add`-free `overrides` in `pnpm-workspace.yaml` then `pnpm install --no-frozen-lockfile`, `pnpm typecheck`, `pnpm test`, `pnpm web:build` | the gate passes on every published Solid the peer range admits | exit 0 on both legs locally, 121 tests each at the time of that run (`ROADMAP.md` records that the suite has since grown; this row is not re-measured) — **not yet run on GitHub Actions** |

Two things about the scripts, so you do not run work twice. `pnpm typecheck` is
`pnpm build && tsc --noEmit && pnpm typecheck:consumer`, and `pnpm test` is
`pnpm build && vitest run && pnpm typecheck:consumer` (`package.json`). So the
shortest local repeat of the `unit` job is:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm pack --dry-run
```

Both browser suites start their own server on the port given by
`PLAYWRIGHT_PORT`; neither may share a port with a `pnpm web:serve` you left
running. Read test counts out of the run, not out of any document — some docs in
this tree still quote older totals.

The first three commands are also the `node-matrix` job. To repeat that locally,
switch Node to a 20 >= 20.19.0, a 22 >= 22.12.0, and any 24, running those three
commands on each; `docs/compatibility.md` §8 has the short form.

The `solid-matrix` job is a third version axis and its own three commands: the
same install, then an uncommitted `overrides` entry in `pnpm-workspace.yaml` plus
`pnpm install --no-frozen-lockfile`, then `pnpm typecheck`, `pnpm test`, and
`pnpm web:build`. `docs/compatibility.md` §8 has the replay in full, including
why the overlay must be an override rather than a `pnpm add`.

Run `docs/building.md`'s table against your own output: it lists which of these
steps this repository verifies, and the last row of it (running the bundle on a
device) is the one §3 is about.

## 2. The version bump

Two files are authoritative — `package.json` and `src/index.ts` — and two repeat
the version in prose that must not contradict them:

| File | What it holds | Current value |
| --- | --- | --- |
| `package.json` | `"version"` (line 3) | `0.1.0` |
| `src/index.ts` | `export const version = "0.1.0"` (line 72) | `0.1.0` |
| `CHANGELOG.md` | the entry for the version being cut | **does not exist in this tree** — see below |
| `README.md` | the `> **Status:**` line (line 7) names the release | `0.1.0` |

`docs/contract.md` (line 3, and line 57 where it quotes the constant) and
`docs/migration.md` (line 3) also name `0.1.0`. Those two are the contract-freeze
documents: a changed number there is a contract change, not a release chore. A
version bump either updates them in the same commit or records why the frozen
documents still describe the older release. Do not let `docs/release.md` be read
as permission to edit them.

`docs/contract.md` cites `version` as `src/index.ts:70`; the constant is at line
72 at this commit. The line reference is stale, the string is not. Grep for the
constant rather than trusting the line number.

**There is no `CHANGELOG.md` on this branch.** `git ls-files CHANGELOG.md`
prints nothing, so the first release that wants one creates it, and a changelog
that exists elsewhere is not evidence about this branch. If the file exists, add
an entry at the top whose heading names the version; if it does not, creating it
is part of the release commit. Either way:

- `CHANGELOG.md` **is** in the published tarball, together with `docs/` and
  `ROADMAP.md`: `package.json` `files` is
  `["dist", "docs", "CHANGELOG.md", "README.md", "ROADMAP.md", "LICENSE"]`.
  The README links to every one of those files, and `test/packaging.test.ts`
  fails if any link a consumer can see stops resolving inside the tarball.
  Verified in the `pnpm pack --dry-run` listing in §4.

Prove the version agrees before committing. Three commands, each run here with
exit 0:

```bash
node -p "require('./package.json').version"           # 0.1.0
grep -n 'export const version' src/index.ts           # 72:export const version = "0.1.0";
node -e "import('./dist/index.js').then(m => console.log(m.version))"   # 0.1.0, after pnpm build
```

The third reads the built output, so it catches a `src/index.ts` edit that was
never rebuilt. To fail loudly instead of eyeballing three values:

```bash
node -e 'const fs=require("node:fs");const pkg=JSON.parse(fs.readFileSync("package.json","utf8"));const m=fs.readFileSync("src/index.ts","utf8").match(/export const version = "([^"]+)"/);if(!m||m[1]!==pkg.version)throw new Error(`package.json ${pkg.version} vs src/index.ts ${m?m[1]:"missing"}`);console.log("agree:",pkg.version)'
```

Nothing in the test suite asserts the version: `docs/contract.md` §16 lists
`version` as exported with no automated test. That is why this is a checklist
item and not a green check.

Bump sequence:

1. Edit `package.json` and `src/index.ts` in the same commit, so no commit in
   history ships a package whose export disagrees with its manifest.
2. Add or update the `CHANGELOG.md` entry; adjust the `README.md` status line.
3. Re-run §1. A version bump alone should change nothing green; if
   `pnpm typecheck:consumer` goes red, the JSX or event type surface moved and
   that is a contract change, not a release chore (`docs/compatibility.md` §9
   says the same thing about dependency bumps).

## 3. What CI cannot check

`native-build` compiles the native bundles and uploads them as an artifact. No
device or emulator is attached to a runner, so **no native behaviour is executed
in CI** (`.github/workflows/ci.yml`, the comment above the `native-build` job,
and [compatibility.md](compatibility.md#8-what-this-document-does-not-claim) §8).

What the workflow *does* now check, once it runs, is that evidence exists. The
`native-evidence` job invokes
`scripts/require-native-evidence.mjs` over a pull request's diff
(`pull_request.base.sha..HEAD`) and fails it when the change touches
native-facing code and carries none of:

- a capture at `docs/evidence/native/<date-or-id>/` with a `manifest.json`, which
  the job re-verifies by running the verifier for that manifest's `card` against
  the stored bytes and requiring exit 0, cross-checked against the manifest's own
  recorded exit code and verdict line. `scripts/verify-native-parity.mjs` reads a
  `smoke` capture; `scripts/verify-native-probe.mjs` reads a `stylesheet` or
  `list` capture and requires that card's stages in order, including the
  recycling answer the list card exists to give; or
- a `decision.json` in the same place, recording explicitly that this
  native-facing change needs no device run, with a reason, an author, a
  timestamp, and the paths it covers; or
- a `pending.json` in the same place, recording that the run is specified,
  reviewed, and blocked — the card that will measure it, why it has not run, the
  physical dependency named, and every native-facing path it stands in for.

**No workflow has executed on GitHub Actions for this repository**, so everything
above is the job's wiring plus the script's measured behaviour, not an observed CI
result. §7 records the whole list of what could not run.

A `pending.json` is not a pass, and the gate does not report it as one. The
script exits **3** for it, and the `native-evidence` job is written to turn 3 into
a workflow warning annotation plus a job-summary block reading "pending, not a
pass", while exit 1 and exit 2 still fail the job. That split is deliberate: a
red `native-evidence` job would always mean the evidence is missing or
unreadable, never merely scheduled — and a green one with a `pending.json` in
the range would carry a warning that says no native behaviour in the pull
request was verified. The
two lie-adjacent outcomes this avoids are a `decision.json` asserting that no run
is needed when one is (false), and an exit 1 that reports a scheduled
requirement as though someone had dodged it.

The device run itself is still hand work, and this job does not pretend
otherwise: `device.getState` in a manifest is a string a human typed, and no
check on a runner can confirm hardware existed. On `push` and
`workflow_dispatch` there is no PR base, so the job prints that and passes rather
than evaluating a range that would mean nothing.

Three things are therefore hand work:

1. **The A03 smoke card** — `examples/lynx-for-native/src/main-thread.tsx`,
   built to `dist/main.lynx.bundle`. It renders a counter and logs one
   `[solid-lynx parity] {...}` line carrying all twenty Element PAPI operations.
   That line is only evidence once `scripts/verify-native-parity.mjs` accepts the
   capture it came from; the command is in "The native smoke step" below.
2. **The stylesheet probe** — `examples/lynx-for-native/src/stylesheet-probe.ts`,
   built to `dist/stylesheet-probe.lynx.bundle`, logging one `[solid-lynx ss]`
   line per stage. Its capture is verified by
   `scripts/verify-native-probe.mjs`, not by the parity verifier, which still
   exits 2 on a capture with no `[solid-lynx parity]` line.
3. **The list probe** — `examples/lynx-for-native/src/list-probe.ts`, built to
   `dist/list-probe.lynx.bundle`, logging one `[solid-lynx lp]` line per stage.
   The same probe verifier reads it and requires the recycling question to be
   answered.

Device setup, the pinned serial, the Explorer deep link, and the exact re-run
commands are in `docs/building.md`, "Verified A03 setup". Two rules from that
section are non-negotiable: every ADB command is pinned with
`adb -s R9WT911JVVH`, and the tablet `19779010` is in use by another agent and
must not be targeted.

**Review any of the three cards without hardware.** One runner is committed at
`examples/lynx-for-native/scripts/run-native-probe.sh` and takes the card as its
argument:

```bash
examples/lynx-for-native/scripts/run-native-probe.sh smoke --dry-run
examples/lynx-for-native/scripts/run-native-probe.sh stylesheet --dry-run
examples/lynx-for-native/scripts/run-native-probe.sh list --dry-run
```

| Card | Bundle | Console prefix |
| --- | --- | --- |
| `smoke` | `main.lynx.bundle` | `[solid-lynx parity]` |
| `stylesheet` | `stylesheet-probe.lynx.bundle` | `[solid-lynx ss]` |
| `list` | `list-probe.lynx.bundle` | `[solid-lynx lp]` |

The bundle stem is accepted too (`main`, `stylesheet-probe`, `list-probe`), and
the old entry point `examples/lynx-for-native/scripts/run-stylesheet-probe.sh`
remains as a thin wrapper that execs the general script with `stylesheet`. An
unknown card is a usage error and exits 2 without touching a device.

All four dry runs (three cards plus the wrapper) ran here: exit 0. Each prints
the `get-state`, `pnpm native:build`, the loopback
`python3 -m http.server 8099`, `adb reverse tcp:8099`, the
`lynx://open?url=.../<card>.lynx.bundle?v=<stamp>` deep link, the
`logcat -d -s lynx_console` and `screencap` captures into
`/tmp/solid-lynx-logs`, the `grep` for the card's prefix, and the cleanup. Drop
`--dry-run` to run it for real; it exits 3 with a message and changes nothing if
the A03 is not attached.

A real run that captures no line for the chosen prefix exits 5 and points at the
log and the screenshot instead of reporting a result, so an empty capture cannot
be read as a measurement. **However, no dry run is a device result.** No device
run of any of the three cards is recorded anywhere in this tree, and
`docs/capabilities.md` says so for the stylesheet and list probes in as many
words.

### The native smoke step

The smoke card's job is one log line, so naming the line is not enough: the line
has to be verified, and the capture has to outlive `/tmp`. The step is four
commands, and the fourth is the one that produces a verdict:

```bash
pnpm build
pnpm native:build
examples/lynx-for-native/scripts/run-native-probe.sh smoke
node scripts/verify-native-parity.mjs /tmp/solid-lynx-logs/lynx_console-smoke-<stamp>.log
```

`scripts/verify-native-parity.mjs` reads the capture and exits **0** verified,
**1** findings, **2** could not evaluate, following the same discipline as dagr.
It parses every `[solid-lynx parity]` line, compares the operations against
`parityOperationIds` from the built `dist/parity.js` (so `pnpm build` has to run
first, or it exits 2 and says so), and rejects any operation that is not `pass`
or `unsupported` with a recorded reason. Its `--help` documents all of it, and
`test/native-parity-verify.test.ts` asserts each exit code against a capture
fixture without a device.

**Only exit 0 may be cited as a native pass.** An exit 1 is findings to record or
fix; an exit 2 is not a result at all — an empty capture, an unparseable line, or
a missing `dist/` — and must never be written up as a run that passed.

Then keep the capture. A log left in `/tmp` cannot be re-checked, which is
exactly what happened to the 2026-10-09 A03 run: it reported all twenty
operations, its `[solid-lynx parity]` line was never copied out of `/tmp`, and
`docs/parity-checklist.md` now records the native column as **reported, not
reproduced**.

The durable place is now a specific one, and the release gate depends on it.
Commit the capture under `docs/evidence/native/<date-or-id>/` beside a
`manifest.json`, following [evidence/native/README.md](evidence/native/README.md)
and `docs/evidence/native/TEMPLATE/manifest.json` — `device.serial`,
`device.getState` (the `adb get-state` output, which has to read `device`),
`card`, `timestamp`, `commit`, and the verifier's exit code and verdict line.
The `commit` has to be inside the change the capture backs: a run from before the
change, or one whose native files moved again afterwards, does not satisfy the
requirement and `require-native-evidence.mjs` says so.

A fifth command closes the loop, and it is the one that decides whether the
evidence is acceptable rather than merely present:

```bash
node scripts/require-native-evidence.mjs --range <base>..HEAD
```

Exit 0 is satisfied, 1 is missing or mismatched evidence, 2 is could not
evaluate, and 3 is **pending, not a pass**. The `native-evidence` CI job is
written to run the same command from the PR base and to turn 3 into a warning
annotation; neither has happened on a runner yet.

**No capture is stored in this repository at this commit.** `docs/evidence/native/`
holds its README, the capture-less `TEMPLATE/`, and one directory of pending
records — `2026-10-25-1.0.0-pending/pending.json`. That is deliberate: a
synthetic capture filed as evidence would be exactly the thing this mechanism
exists to prevent, and the pending records are the honest alternative. On this
release's range, `--range origin/master..HEAD` therefore exits **3** and prints
`verdict: pending`, naming the 22 native-facing paths and the blocker. Anything
other than 0 or 3 — an absent record, a record covering part of the range — is
still exit 1, and a real native-facing PR with no record at all will be red
until someone runs the card or records why they cannot.

**What a release does when the device is absent**, stated as a procedure so the
next one does not have to re-derive it:

1. Run the gate on the release range. Expect exit 3 if the pending records are
   complete, and 1 if they are not — the difference is whether every
   native-facing path is named, and the report says which one was missed.
2. Do not write a `decision.json` for a change that needs a run. That record
   asserts no device run is needed; using it here would be false, and it is the
   one failure this directory cannot catch.
3. Keep the pending record in the release commit, and repeat in the release
   notes, in the roadmap's open items, and in `docs/capabilities.md` that the
   cards have not run. The gate's exit code is not a substitute for those
   sentences; it is what makes them checkable.
4. When the device arrives, store the capture in its own directory with its
   manifest. The capture supersedes the pending record, the range goes to exit 0,
   and nothing needs to be deleted first.

**Always the same rule: a green `native-evidence` job with a `pending.json` in the
range means nothing was measured.** The annotation says so. A reader who takes
that green tick as "native verified" has read it wrong, and the one thing this
arrangement cannot fix is that GitHub has no neutral job conclusion — which is
exactly why the warning is loud, why the verdict line says `pending` rather than
`satisfied`, and why the warning block names every path instead of only counting
them.

**Whether the device is attached right now:**

```bash
adb -s R9WT911JVVH get-state
```

**Not run for this release**, and not passable here: at this commit the command
prints `error: device 'R9WT911JVVH' not found` and exits 1. No device run is
recorded in this release, which is what `2026-10-25-1.0.0-pending/pending.json`
records and what the gate's exit 3 states.

**The rule that decides whether a release is done.** A release that changes
native-facing behaviour — the host adapter, event names or dispatch, CSS ids,
list callbacks, anything that alters the emitted native bundle — needs the
device run recorded in `docs/capabilities.md` before the release is called done.
Not before the commit; before the release is declared. Where that record is
absent, the release says so rather than inheriting the previous run's result.

"A recorded run" now has a definition, so it cannot be argued with after the
fact: **the capture file, the verifier's exit code and verdict line, and the
path where the capture is kept.** A release note that has the first two but not
the third is not recorded, because nobody can re-run the check on those bytes.
An unrecorded run cannot be cited, not even as a pass nobody disputes — and one
whose capture is gone is not recorded, however clear its original report was.

That is the current state, and it is not a formality: `docs/capabilities.md`
records the stylesheet probe as **"This has not been run yet"**, its
"Remaining blockers" section says the capability probe has not run on a device,
and `docs/contract.md` §16 lists the stylesheet and list probes as built and
unit-tested but **unmeasured on native**. A release note may repeat what
`docs/parity-checklist.md` records from the A03 smoke (that the 2026-10-09 run
*reported* twenty shared operations, rendering, and one `bindtap`), and must say
in the same breath that the capture is gone. It may not restate those rows as a
present-tense pass, and it may not upgrade anything else from "unmeasured".

## 4. Build and pack

```bash
pnpm build          # tsc -p tsconfig.build.json -> dist/     exit 0
pnpm pack --dry-run # list the tarball without writing it     exit 0, 46 entries
```

`pnpm pack --dry-run` ran here and listed **46 entries**: 30 files under
`dist/` (`*.js` and `*.d.ts` for every `src/` module), the eleven files in
`docs/` (`building`, `capabilities`, `compatibility`, `contract`, `migration`,
`parity-checklist`, `release`, `session-handoff`, and the three under
`docs/evidence/native/`: its `README.md`, `TEMPLATE/manifest.json`, and
`2026-10-25-1.0.0-pending/pending.json`), `CHANGELOG.md`, `ROADMAP.md`, plus
`LICENSE`, `package.json`, `README.md`. It ends with `Tarball Details` /
`apothic-ai-solid-lynx-1.0.0.tgz` and writes no file (`git status` was clean
afterwards).
No capture ships, because none is stored — the pending record is the record that
none exists.

What ends up in the tarball is decided by `files` in `package.json`:
`["dist", "docs", "CHANGELOG.md", "README.md", "ROADMAP.md", "LICENSE"]`.
`package.json` and the `LICENSE` also ship because npm always includes them.
There is no `prepack` or `prepare` script, so `pnpm pack` does **not** rebuild
`dist/` — run `pnpm build` first, or the tarball carries whatever was last
built.

Why the documentation ships at all: the README tells a reader to consult the
contract, the compatibility ranges, the migration guide, the capability matrix,
and the changelog, and every one of those is a relative link. If the files are
not in the tarball those links are dead for exactly the audience that needs
them. `docs/` is 180 KiB of markdown, and the whole tarball compresses to
111 KiB, so the documentation costs about 75 KiB over the network, and
the shipped docs cross-link each other — `contract.md`, `compatibility.md`,
`capabilities.md` and `migration.md` all point at `building.md` or
`parity-checklist.md` — so the directory ships whole rather than as a hand-picked
subset that would leave second-hop links dangling. Shipping only the four
consumer-facing documents plus `CHANGELOG.md` leaves fifteen such links dead;
shipping the whole directory leaves none. The three links in `docs/`
that pointed at repository-only files (`examples/…/run-native-probe.sh`,
`run-stylesheet-probe.sh`) were rewritten as plain code spans, and
`test/packaging.test.ts` now enforces both rules: every relative link in every
shipped markdown file resolves to a shipped file with an existing heading, or it
fails.

What does **not** ship, and this surprises people reading the repo:

- `src/`, `test/`, `examples/`, `scripts/` — none of it. The parity verifier is
  a repository tool, not a published one, so a consumer never gets it.
- `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`,
  `playwright.config.ts`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.github/`.

Consequence worth checking on every release: the `exports` map points at
`dist/*.js` and `dist/*.d.ts` for five entry points. A new entry point or a moved
file that is not under `dist/` is invisible in the tarball, and
`pnpm pack --dry-run` is the cheapest place to notice. `test/consumer-install.test.ts`
is the second: it unpacks the tarball this repository's `pnpm pack` produces into
a temp `node_modules/@apothic-ai/solid-lynx`, imports each documented entry
through node's own resolver, and fails on a subpath that `exports` no longer
answers for or on a target that is not in the tarball.

## 5. Publishing

**Nothing in this repository publishes, and this procedure is unproven.** No git
tag exists (`git tag --list` is empty), `.github/workflows/` contains only
`ci.yml`, and there is no `NPM_TOKEN` or registry credential wired into any
workflow here. `package.json` now carries `publishConfig.access: "public"` — that
is a packaging fact about a scoped package, not a publish: a scoped package
defaults to `restricted`, so without it even a correct tarball would be
unreachable outside the npm organisation.

What the command would do, if it were ever run deliberately:

- `pnpm publish` packs the same 46 entries §4 lists and uploads them to
  `https://registry.npmjs.org/` as
  `@apothic-ai/solid-lynx@<package.json version>`, tarball
  `apothic-ai-solid-lynx-<version>.tgz`. A dry run was executed here to confirm
  the target and that nothing was uploaded:
  `pnpm publish --dry-run --no-git-checks` printed
  `📦 solid-lynx@0.1.0 → https://registry.npmjs.org/` and
  `[WARN] Skip publishing solid-lynx@0.1.0 (dry run)`, exit 0, no tarball left
  behind. **That is not a publish** and must not be cited as one; it was run
  before the scope existed, so its package name is the old one and its line
  describes what that run printed, not what a run today would print. **Not
  re-run** after the rename.
- A real publish would need publish rights on the `@apothic-ai` npm organisation,
  which is the operator's decision and is recorded outside this repository. The
  unscoped name it used to target belongs to another maintainer
  (`npm view solid-lynx version license maintainers` → `1.0.0`, `MIT`,
  `pranshuchittora`, exit 0), and that is why the scope exists.

**Do not publish on the strength of this document.** No step in it has been
executed against a registry, and there is no tag or workflow to make a publish
repeatable. If publishing is ever wanted, the credential and the automation are
decisions for the repository owner first, and this section gets rewritten from a
run that actually happened.

## 6. Rollback and known limitations

Rollback is short because nothing has been released. There is no published
version to unpublish or deprecate, no tag to move, and no registry state to
restore. A version bump in this repository is rolled back by reverting the commit
that changed `package.json`, `src/index.ts`, the changelog, and the README status
line — they move together or not at all. `dist/` is gitignored and rebuildable
(`pnpm build`), so it is never the thing to restore.

If that changes — if a tag exists, or a publish happens — the rollback stops
being a `git revert` and becomes a registry operation against a version that
consumers may already have installed. That document does not exist yet.

**What a release may not claim.**
[compatibility.md §8](compatibility.md#8-what-this-document-does-not-claim),
"What this document does not claim", is the list a release note has to stay
inside. The load-bearing one for this release: **no CI run exists.** No workflow
has executed on GitHub Actions for any commit on this branch, so a release note
may not say CI verified anything. What it may say is that the workflow is
written and statically parsed, that its steps were replayed locally at named
commits, and that the local gate passes. Beyond that: three Node lines
(`20.x`, `22.x`, `24.x` from the `node-matrix` job, once it runs) rather than the
exact `20.19.0` / `22.12.0` floors of the declared
`^20.19.0 || >=22.12.0` range, every version inside the Solid peer range (from
the `solid-matrix` job — locally green, not yet run on GitHub Actions), no
web-core matrix, no native runtime in CI, no second native runtime and no device
other than the A03, no cross-OS claim, no cross-host stylesheet or list claims,
and no `@lynx-js/types` version.
`docs/contract.md` §16 is the companion list for exports with no test, including
`version` itself and every native runtime claim
beyond the recorded smoke.

`ROADMAP.md`'s 1.0 milestone has open boxes — among them "Require native and web
compatibility checks for changes to shared behavior" — so a release note should
not read those as satisfied. `docs/capabilities.md` "Remaining blockers" is the
per-capability version of the same statement.

## 7. What this document could not run

| Step | Status | Why |
| --- | --- | --- |
| A03 smoke card on a device | **not run** | `adb -s R9WT911JVVH get-state` → `device 'R9WT911JVVH' not found`, exit 1. No hardware attached in this worktree, so there is no capture for the verifier to read. |
| `node scripts/verify-native-parity.mjs <capture>` on a device capture | **not run** | Same reason: no capture exists. The verifier itself is exercised host-free against fixtures for every outcome (0, 1, and 2, including a capture with no parity line). |
| `node scripts/verify-native-probe.mjs <capture>` on a device capture | **not run** | Same reason: no stylesheet or list capture exists. The checker is exercised host-free against `test/fixtures/native-probe/` for all three exit codes on both cards, including a list capture that never answers the recycling question and one where the host never called `enqueueComponent`. A fixture that verifies is not a device run — its README says so. |
| `node scripts/require-native-evidence.mjs --range <base>..HEAD` against a real device capture | **not run** | No capture exists to point it at. The script's own four exit codes (0 satisfied, 1 missing, 2 could not evaluate, 3 pending-not-a-pass) were demonstrated against throwaway git repositories under `/tmp`, and its 50 host-free tests build their own repositories; the `native-evidence` job has not run on GitHub Actions, because no runner can be dispatched from this worktree. |
| Stylesheet probe on a device | **not run** | Same device; only `--dry-run` was executed (exit 0), which reviews the sequence and touches nothing. |
| List probe on a device | **not run** | Same device; only `--dry-run` was executed (exit 0). The list card has had a runner since `run-native-probe.sh` took a card argument — it is no longer loaded by hand — but a reviewed command sequence is not a device result. |
| Any job of `.github/workflows/ci.yml`, on GitHub Actions | **not run** | No workflow has ever executed for this repository: `gh run list` returns no runs, and the workflow file is not on `origin/master` (which sits at `e40d1c5`, 52 commits behind). The file is validated by static parse and its `run:` steps are replayed locally, which is not the same thing — the leg matrices, the `needs:` edges and every `actions/*` step are unexecuted. |
| `pnpm exec playwright install --with-deps chromium` | **not run** | Chromium was already installed here; a CI runner would install it because it starts bare. |
| The `solid-matrix` job's steps, verbatim, on both legs | **run locally**, exit 0 | The job's `run:` blocks were extracted from the parsed YAML and executed in order for `solid-js` 1.9.16 / `babel-preset-solid` 1.9.16 and `solid-js` 1.9.17 / preset 1.9.16. Every command exited 0 and the tree was clean afterwards. What is **not** run is the workflow itself on GitHub Actions — no runner could be dispatched from this worktree, so the leg matrix, the `needs: unit` edge, and the `actions/*` steps are unverified until a push runs them. |
| `pnpm publish` (real) | **not run**, deliberately | §5. The unscoped name belongs to another maintainer and this repository has no credential or release workflow. Only `--dry-run` was executed, before the scope existed, and it uploaded nothing. |

Everything else in this document — the install, the five gate commands
(`typecheck`, `typecheck:consumer`, `test`, `build`, `pack --dry-run`), both
browser suites, `pnpm web:build`, `pnpm native:build`, the native runner's four
`--dry-run` invocations (smoke, stylesheet, list, and the wrapper), the three
version commands, the version-agreement one-liner,
`npm view solid-lynx`, and `pnpm publish --dry-run` — was executed at this
commit and exited 0.
