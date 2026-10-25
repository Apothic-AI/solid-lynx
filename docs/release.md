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
| `unit` | Unit tests | `pnpm test` | Vitest: every test file passes | exit 0, **304 tests in 12 files** |
| `unit` | (inside `pnpm test`) | `test/documented-counts.test.ts` | every document that states this suite's size agrees with the measured size | exit 0; a stale count in README, CHANGELOG, ROADMAP or `docs/` is a test failure, not a review note |
| `unit` | Build | `pnpm build` | `dist/` is written | exit 0 |
| `unit` | Package contents | `pnpm pack --dry-run` | the tarball builds and lists its contents | exit 0, 52 entries |
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

### When a browser suite reports a card that never rendered

Both browser suites once failed intermittently — on 2-core GitHub runners, in
different tests, in both fixtures — with the same report: the card never
rendered, and `page errors: none / console errors: none / failed requests: none`.
That silence was not a healthy page. It was the shape of the failure.

**What a stall looks like.** `lynx-view` has a shadow root containing an `iframe`
and a `link` and nothing else. The realm iframe exists and its document loads;
web-core has installed its element APIs in it (`__CreatePage` is a function); the
decode worker answered `ready`, all five sections and `done`. The card's own
main-thread script was never appended to the realm, so `[part="page"]` was never
created, `lynx-view` stayed `display: none`, and the fixture's probe was never
installed. No exception was thrown anywhere, which is why every page-level list
was legitimately empty.

**What each diagnostic field means.** `test/browser/realm-diagnostics.ts` holds
the shared machinery, and both suites print the same report:

| Field | What it tells you |
| --- | --- |
| `exceptions` / `console` under `Lynx iframe realm` | What the realm itself threw or logged. An empty list here means the realm is clean, *not* that nothing ran — the sink is installed inside that frame by an init script, and a frame with no sink prints `no error sink installed` instead. |
| `phase` | The first boot stage that had not happened: no shadow root → no realm iframe → no `LynxViewInstance` stylesheet → element APIs not installed → **element APIs installed but the card's lepus code never reached `onMTSScriptsLoaded`** → card script inserted and not loaded → rendered. |
| `elementApisInstalled` + `cardScriptInserted` | The two halves of the boot, read separately. `true`/`false` together is the race described below; `false`/`false` means the realm never got its config section either. |
| `realmReachable` / `realmFailure` | Whether the page can read the realm's document at all. A detached or cross-origin realm is a different fault from one that ran and threw. |
| `realmScripts` | Every script in the realm head: web-core's inline `lynx:mtsready` bootstrap first, then the card's `blob:` script if it was ever appended. |
| `viewBox` / `viewIsVisible` / `viewBoxOverWait` | `lynx-view`'s own box. **A zero box is normal here, not a fault** — web-core's own CSS is `display: none` until the page is appended, and `[height="auto"]` adds `contain: content`. A healthy boot creates the realm iframe while the box is still `0x0`, so layout is not a precondition for the realm. |
| `bootTrace` | Each phase with the elapsed milliseconds at which it was first seen. A phase reached at 200 ms and held for 30 s is a stall; a phase reached at 29 s is a slow step. This is what separates "stopped" from "slow". |
| card bundle workers + message sequence | The decode worker's `sent`/`received` traffic, in order. `ready, section:6, section:3, section:4, section:2, section:1, done` with no card script afterwards is the stall. |
| boot resources | The wasm, web-core module and bundle requests with their timings, so a fetch that never arrived is visible without a second run. |

**Which hypothesis the evidence supported.** Not the two that were worth checking
first:

- *The realm's wasm/bundle fetches are slow under the dev-server transform graph.*
  **Ruled out as the cause.** Under a deterministic reproduction the decode
  worker completes in full — all five sections and `done` — before the stall. The
  fetches are not the thing that stopped; the main thread is.
- *`lynx-view` only boots once it has a non-zero layout box.* **Ruled out.**
  Nothing in web-core gates the realm on layout: `createIFrameRealm` never reads
  a rect, and `BoundingClientRectService`/`convertLengthToPx` read one only when
  the card asks for it. Measured on a healthy boot, the realm iframe is created
  while `lynx-view` is still `0x0` with `display: none`. Giving the fixture
  explicit dimensions would not have changed anything; the fixtures already set
  `width="auto"` and an explicit `style="width: min(100%, 40rem)"`.

What the evidence did support is a race inside `@lynx-js/web-core`'s
`TemplateManager`, upstream of this package: the worker's `done` message could
overtake the `LynxViewInstance` dynamic import that every section handler awaits.
`done` moves the in-flight bundle from `#loadingBundles` to `#bundles`, while the
section writers (`#setLepusCode`, `#setConfig`, …) look the bundle up in
`#loadingBundles` **by url**. A handler that resumed after `done` therefore wrote
`lepusCode` into an object nobody read, `onMTSScriptsLoaded` found no `root`
chunk, and it never called `mtsRealm.loadScript`. No throw, no console output, no
failed request — exactly the silent stall.

The fix is a dependency patch, `patches/@lynx-js__web-core@0.26.2.patch`,
registered in `pnpm-workspace.yaml` under `patchedDependencies` and applied by
`pnpm install`. It defers moving the bundle to `#bundles`, and `#resolvePromise`,
until the last in-flight section handler has finished writing, so the two maps
cannot disagree whatever order the messages and the import resolve in. No test
timeout was raised, no retry was added and no assertion was relaxed. Upstream
`@lynx-js/web-core` 0.26.5 still has the race, so this patch is not superseded by
bumping the dependency.

**Reproducing it deterministically.**

```bash
pnpm web:build
pnpm exec vite examples/lynx-for-web/site \
  --config examples/lynx-for-web/site/vite.config.ts \
  --host 127.0.0.1 --port 4399 --strictPort &
node scripts/repro-boot-stall.mjs 4399
```

The script holds `LynxViewInstance.js` for 1500 ms — several times the whole boot
cost — which widens the real race to a certainty without touching the decoder,
the wasm or the bundle. Exit 0 means every run booted; exit 1 means at least one
stalled; exit 2 means it could not evaluate (no dev server, no Chromium).

| Tree | `--runs=4`, default delay | Result |
| --- | --- | --- |
| patch not applied | 4 | **0 booted, 4 stalled** |
| patch applied | 4 | **4 booted, 0 stalled** |
| patch applied, `--baseline` (no delay) | 2 | 2 booted, 0 stalled |

A stall from this script prints the stalled stage and
`page-level channels: (none)`, which is the CI signature reproduced on demand. If
it ever stalls with the patch in place, check that `pnpm install` actually applied
the patch (`patches/` must be present and `pnpm-workspace.yaml` must list it)
before looking anywhere else.

**Reading a stall you did not cause.** The phase that names this bug is
*"web-core installed the realm's element APIs from the config section, but the
card's lepus code never reached onMTSScriptsLoaded"*. If instead `phase` stops at
`no realm iframe` or at `element APIs not installed`, the boot stopped earlier and
the bug is not this one — look at the realm's `exceptions`, its `realmScripts`,
and the boot-resource list.

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
| `package.json` | `"version"` (line 3) | `1.0.0` |
| `src/index.ts` | `export const version = "1.0.0"` (line 72) | `1.0.0` |
| `CHANGELOG.md` | the entry for the version being cut | an `Unreleased` section with no number, and a `1.0.0` entry below it |
| `README.md` | the `> **Status:**` line (line 14) names the release | `1.0.0` |

`docs/contract.md` (line 3, and line 68 where it quotes the constant) and
`docs/migration.md` also name `1.0.0`. Those are the contract-freeze documents: a
changed number there is a contract change, not a release chore. A version bump
either updates them in the same commit or records why the frozen documents still
describe the older release. Do not let `docs/release.md` be read as permission to
edit them.

`CHANGELOG.md` **is** in the published tarball, together with `docs/` and
`ROADMAP.md`: `package.json` `files` is
`["dist", "docs", "CHANGELOG.md", "README.md", "ROADMAP.md", "LICENSE"]`.
The README links to every one of those files, and `test/packaging.test.ts`
fails if any link a consumer can see stops resolving inside the tarball.
Verified in the `pnpm pack --dry-run` listing in §4. It follows that a change to
the shipped prose is a change to the artifact without being a change to the code
— §2's last subsection is about which of those earns a new number.

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

### What state `1.0.0` is actually in, and why this tree has no bump

`@apothic-ai/solid-lynx@1.0.0` **is published**. `npm view
@apothic-ai/solid-lynx time.modified dist-tags` reports it as `latest`, published
2026-10-25, and `gitHead aded55b` on its manifest. `aded55b` is an ancestor of
this tree, so "what is on the registry" and "what is at `HEAD`" are different
commits and this document must not read as though they were the same.

The difference does not reach the artifact. Measured, not assumed: unpack the
published tarball, build this tree, and diff the two `dist/` trees.

```bash
npm pack @apothic-ai/solid-lynx@1.0.0 && tar -xzf apothic-ai-solid-lynx-1.0.0.tgz
pnpm build && diff -r package/dist dist && echo "dist identical"
```

It prints nothing but `dist identical`. Everything in `aded55b..HEAD` is tests,
scripts, patches, evidence, examples and documentation — no `src/`, no
`package.json`, no build config — so a republish today would ship the same
renderer, types and exports. That is why this tree carries no version bump:
**a version number that moves while the shipped bytes do not is a false claim
about what changed.**

The one thing a republish *would* change is documentation: `files[]` includes
`docs/`, `CHANGELOG.md`, `README.md` and `ROADMAP.md`, so the next tarball's prose
differs from the installed one. That is a reason a republish could be justified
and a consumer who reads docs from `node_modules` would benefit; it is not a
reason to call it a fix. If one is cut for that, `1.0.1` is the number and the
`CHANGELOG.md` entry says so. `1.0.0`'s own entry is not edited to mention work
that postdates it.

## 2a. Checks to run before the next publish

Each of these is a question a publish makes urgent and nothing in CI asks.

**1. Is the web-core patch still needed?** The patch in
`patches/@lynx-js__web-core@0.26.2.patch` fixes an upstream boot race (see §1,
"When a browser suite reports a card that never rendered"). Before publishing,
check the version `package.json` pins, not the one that was checked last time:

```bash
grep -n 'web-core' package.json pnpm-workspace.yaml
npm view @lynx-js/web-core versions --json | tail -20
```

Read the installed host's `done` handler. The defect is the ordering, so it is
visible as code rather than inferred from a failing test:

```bash
sed -n "/case 'done':/,/break;/p" \
  node_modules/@lynx-js/web-core/dist/client/mainthread/TemplateManager.js
```

If the handler still moves the bundle from `#loadingBundles` to `#bundles` before
the section handlers finish, the upstream bug is live and the patch is still
needed. 0.26.5 was inspected this way and still has it. If upstream has fixed it,
delete the `patchedDependencies` entry **and** the patch file in one commit, then
re-run the reproducer below with the patch gone — it must still boot. If it
does, the removal is proven; if it stalls, the patch is still load-bearing.

**2. Does the patch still apply?** A `patchedDependencies` entry that no longer
matches its target fails the install, not the tests, so it can survive a green
`pnpm test` in a tree installed before the drift. Re-apply from scratch:

```bash
rm -rf node_modules && pnpm install --frozen-lockfile
```

`pnpm` reports a patch that did not apply. Then run the reproducer, which is the
thing that distinguishes "installed" from "in effect":

```bash
pnpm web:build
pnpm exec vite examples/lynx-for-web/site \
  --config examples/lynx-for-web/site/vite.config.ts \
  --host 127.0.0.1 --port 4399 --strictPort &
node scripts/repro-boot-stall.mjs 4399
```

Exit 0 means every run booted; exit 1 means at least one stalled, which means the
patch is not in effect whatever the install said.

**3. Is the shipped code what the version number claims?** A version asks the
reader to assume the number and the bytes agree. Compare them instead of trusting
that the last bump commit was complete:

```bash
git diff --stat <last-published-tag-or-gitHead>..HEAD -- src package.json tsconfig.build.json
```

An empty result means the number can stay and the changelog is the only thing a
publish would change. A non-empty result means the shipped surface moved: the
version must move, and the entry has to describe the change rather than the
process that produced it. This is the check that would have caught a `src/` fix
sitting under an unchanged `1.0.0`.

**4. Does the prose still match the artifact?** `docs/capabilities.md` and
`docs/compatibility.md` describe what this repository measured, and the browser
results they cite were measured with the local patch applied. If the patch is
removed or replaced, those sentences are wrong until they are rewritten. The
`documented-counts` test catches stale *numbers* on every run; nothing catches a
stale *claim*, so this one is by hand.

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
  `smoke` capture; `scripts/verify-native-probe.mjs` reads a `stylesheet`,
  `stylesheet2` or `list` capture and requires that card's stages in order,
  including the recycling answer the list card exists to give; or
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

1. **The smoke card** — `examples/lynx-for-native/src/main-thread.tsx`,
   built to `dist/main.lynx.bundle`. It renders a counter and logs one
   `[solid-lynx parity] {...}` line carrying all twenty Element PAPI operations.
   That line is only evidence once `scripts/verify-native-parity.mjs` accepts the
   capture it came from; the command is in "The native smoke step" below. The
   stored 2026-10-25 capture is from an emulator, not the A03.
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

**Review any of the cards without hardware.** One runner is committed at
`examples/lynx-for-native/scripts/run-native-probe.sh` and takes the card as its
argument:

```bash
examples/lynx-for-native/scripts/run-native-probe.sh smoke --dry-run
examples/lynx-for-native/scripts/run-native-probe.sh stylesheet --dry-run
examples/lynx-for-native/scripts/run-native-probe.sh stylesheet2 --dry-run
examples/lynx-for-native/scripts/run-native-probe.sh list --dry-run
```

| Card | Bundle | Console prefix |
| --- | --- | --- |
| `smoke` | `main.lynx.bundle` | `[solid-lynx parity]` |
| `stylesheet` (v1) | `stylesheet-probe.lynx.bundle` | `[solid-lynx ss]` |
| `stylesheet2` (v2) | `stylesheet-probe-v2.lynx.bundle` | `[solid-lynx ss2]` |
| `list` | `list-probe.lynx.bundle` | `[solid-lynx lp]` |

The bundle stem is accepted too (`main`, `stylesheet-probe`,
`stylesheet-probe-v2`, `list-probe`), and the old entry point
`examples/lynx-for-native/scripts/run-stylesheet-probe.sh` remains as a thin
wrapper that execs the general script with `stylesheet`. An unknown card is a
usage error and exits 2 without touching a device.

All four dry runs (four cards, plus the wrapper) ran here: exit 0. Each prints
the `get-state`, `pnpm native:build`, the loopback
`python3 -m http.server 8099`, `adb reverse tcp:8099`, the
`lynx://open?url=.../<card>.lynx.bundle?v=<stamp>` deep link, the
`logcat -d -s lynx_console` and `screencap` captures into
`/tmp/solid-lynx-logs`, the `grep` for the card's prefix, and the cleanup. Drop
`--dry-run` to run it for real; it exits 3 with a message and changes nothing if
the A03 is not attached.

A real run that captures no line for the chosen prefix exits 5 and points at the
log and the screenshot instead of reporting a result, so an empty capture cannot
be read as a measurement. **However, no dry run is a device result, and no card
has ever been run through this script.** The runs that do exist were taken outside
it, by opening the bundles in Lynx Explorer on an API 33 `x86_64` emulator, and
three of them are stored as records (`docs/capabilities.md` says exactly what each
one did and did not measure). **No A03 run of any card is recorded anywhere in
this tree.**

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

**Three captures are stored in this repository, and they are emulator runs.**
`docs/evidence/native/` holds its README, the capture-less `TEMPLATE/`, and four
run directories from 2026-10-25:

| Directory | Card | Record |
| --- | --- | --- |
| `2026-10-25-emulator-api33-smoke/` | `smoke` | capture + manifest, verifier exit 0 |
| `2026-10-25-emulator-api33-stylesheet/` | `stylesheet` | capture + manifest, verifier exit 0 |
| `2026-10-25-emulator-api33-list/` | `list` | capture + manifest, verifier exit 0 |
| `2026-10-25-emulator-api33-stylesheet-v2/` | `stylesheet2` | capture, **no manifest** — supporting bytes, not a record |

The manifests name the runtime (AVD `lynx33`, API 33, `x86_64`, Explorer 4.1.0,
APK SHA-256 `6ae29787a2166974c29c2f23d87f3b20a137abcf9a8c17903ad19f3fb7f00cb6`)
and the serial `emulator-5554`. The pending record set that stood here before them
(`2026-10-25-1.0.0-pending/pending.json`) was **deleted in `85ddd12`**: a
verified capture supersedes a pending record, and leaving it would have kept
saying nothing had run. On the range that contains those commits,
`node scripts/require-native-evidence.mjs --range origin/master..HEAD` exits
**0** with `verdict: satisfied`, not 3. A range whose native change has no record
of its own is still exit 1, so the mechanism is unchanged: it accepts a capture
it can re-verify, and it says `missing` when there is none.

**A release must still say what the emulator does not cover.** Exit 0 on the
gate means the captures are complete for the paths they were taken for; it does
not mean native behaviour was executed on the runner, that the A03 has any
capture, or that the stylesheet lifecycle and list recycling are measured. Those
three statements belong in the release notes in the same breath as the exit code.

**What a release does when a run is needed and the device is absent**, stated as
a procedure so the next one does not have to re-derive it:

1. Run the gate on the release range. Expect exit 3 if a `pending.json` covers
   every native-facing path, and 1 if the record set is absent or incomplete —
   the difference is whether every native-facing path is named, and the report
   says which one was missed.
2. Do not write a `decision.json` for a change that needs a run. That record
   asserts no device run is needed; using it here would be false, and it is the
   one failure this directory cannot catch.
3. Keep the pending record in the release commit, and repeat in the release
   notes, in the roadmap's open items, and in `docs/capabilities.md` what the
   cards have and have not measured. The gate's exit code is not a substitute for
   those sentences; it is what makes them checkable.
4. When the run happens, store the capture in its own directory with its
   manifest. The capture supersedes the pending record, the range goes to exit 0,
   and the pending record can be deleted afterwards — which is what `85ddd12`
   did, and why that deletion was a factual correction rather than a tidy-up.

**Always the same rule: a green `native-evidence` job with a `pending.json` in the
range means nothing was measured.** The annotation says so. A reader who takes
that green tick as "native verified" has read it wrong, and the one thing this
arrangement cannot fix is that GitHub has no neutral job conclusion — which is
exactly why the warning is loud, why the verdict line says `pending` rather than
`satisfied`, and why the warning block names every path instead of only counting
them.

**Whether the A03 is attached right now:**

```bash
adb -s R9WT911JVVH get-state
```

**Not run for this release**, and not passable here: the command prints
`error: device 'R9WT911JVVH' not found` and exits 1. **No A03 run is recorded for
any card**, and the 2026-10-09 run's own capture is still lost. Every stored
capture in this tree is an API 33 `x86_64` emulator run, which shares the
Explorer build and the APK digest with the tablet and nothing else that a
device claim needs — no GPU, no digitizer, no memory pressure, and no tap.

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
records the stylesheet probe as **run on the API 33 emulator, with the five facts
it measured and the lifecycle it did not**, its "Remaining blockers" section says
the capability probe has still only run in a browser, and `docs/contract.md` §16
records exactly what the emulator captures cover and what is left unmeasured (no
stylesheet handle, no list recycling, no native `dispose()` observation). A
release note may repeat what `docs/parity-checklist.md` records from the A03 smoke
(that the 2026-10-09 run *reported* twenty shared operations, rendering, and one
`bindtap`), and must say
in the same breath that the capture is gone. It may not restate those rows as a
present-tense pass, and it may not upgrade anything else from "unmeasured".

## 4. Build and pack

```bash
pnpm build          # tsc -p tsconfig.build.json -> dist/     exit 0
pnpm pack --dry-run # list the tarball without writing it     exit 0, 52 entries
```

`pnpm pack --dry-run` ran here and listed **52 entries**: 30 files under
`dist/` (`*.js` and `*.d.ts` for every `src/` module), the **17** files under
`docs/` (`building`, `capabilities`, `compatibility`, `contract`, `migration`,
`parity-checklist`, `release`, `session-handoff`, plus the nine under
`docs/evidence/native/` — its `README.md`, `TEMPLATE/manifest.json`, and the
seven files of the three emulator records and the manifest-less v2 capture),
`CHANGELOG.md`, `ROADMAP.md`, plus `LICENSE`, `package.json`, `README.md`. It
ends with `Tarball Details` / `apothic-ai-solid-lynx-1.0.0.tgz` and writes no
file (`git status` was clean afterwards). That is 759,053 B unpacked and a
209,789 B tarball, of which **234,679 B unpacked are the four emulator capture
logs** — the evidence ships with the package, so an installed copy can be read
against `docs/capabilities.md`.

An earlier edition of this section said 46 entries and "no capture ships". Both
were correct when the pending record was the only evidence in the tree and are
wrong now: the pending record was deleted in `85ddd12` and four capture logs took
its place. The count moves with `docs/`, which ships whole, so re-run the command
on the release commit rather than copying this number.

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
them. `docs/` is now 517 KiB on disk — 284 KiB of markdown plus 229 KiB of
emulator capture logs — and the whole tarball packs to 205 KiB, because logcat
text compresses far better than prose does. The evidence is shipped on purpose:
a reader who installs the package can see what was measured and what was not,
and the manifests beside the captures carry the runtime and verifier verdict. The
shipped docs cross-link each other — `contract.md`, `compatibility.md`,
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

**Nothing in this repository publishes automatically, and this procedure is unproven
from this worktree.** No git tag exists (`git tag --list` is empty),
`.github/workflows/` contains only `ci.yml`, and there is no `NPM_TOKEN` or
registry credential wired into any workflow here. `package.json` carries
`publishConfig.access: "public"` — that is a packaging fact about a scoped
package, not a publish: a scoped package defaults to `restricted`, so without it
even a correct tarball would be unreachable outside the npm organisation.

The registry is not empty, and this section has to start from what is actually
there. `@apothic-ai/solid-lynx@1.0.0` **is published**, with `dist-tags.latest` at
`1.0.0`, published 2026-10-25, `gitHead aded55b`. A second version,
`0.0.0-stage`, was created 2026-10-25T14:40:38Z, about 90 seconds before it, by
the same publisher account; nothing in this repository's files, changelogs or
provenance describes it, so it is recorded here as a registry fact and as an open
question rather than explained away. Its existence means the `@apothic-ai` npm
organisation is live and something outside this tree has publish rights to it —
which is a credential fact §2a's checklist assumes and this document cannot
verify.

What the command would do, if it were ever run deliberately:

- `pnpm publish` packs the same 52 entries §4 lists and would upload them to
  `https://registry.npmjs.org/` as `@apothic-ai/solid-lynx@<package.json
  version>`. Because `1.0.0` is taken, a publish from this tree without a bump
  fails; the number has to move first, and §2's last subsection says whether it
  should. The 52 entries were re-measured against the published tarball: it
  contains 52 files, so the entry count in §4 is the count a consumer actually
  received.
- A dry run was executed before the scope existed, in the `0.1.0` era, and
  printed `📦 solid-lynx@0.1.0 → https://registry.npmjs.org/` and
  `[WARN] Skip publishing solid-lynx@0.1.0 (dry run)`, exit 0, no tarball left
  behind. **That is not a publish** and must not be cited as one; its package
  name is the old one and its line describes what that run printed, not what a
  run today would print. **Not re-run** after the rename.
- A real publish needs publish rights on the `@apothic-ai` npm organisation. That
  credential exists somewhere and is not in this repository; it is the operator's,
  and it is the reason §2a's checks are worth doing before the command, not after.
  The unscoped name this repository used to target belongs to another maintainer
  (`npm view solid-lynx version license maintainers` → `1.0.0`, `MIT`,
  `pranshuchittora`, exit 0), and that is why the scope exists.

**Do not publish on the strength of this document.** No step in it was executed
against a registry from this worktree, and there is no tag or workflow to make a
publish repeatable — the one publish that has happened was done by hand, outside
this procedure. Publishing is an owner's decision, and §2a is what to check before
asking for it.

## 6. Rollback and known limitations

Rollback has two shapes, and which one applies depends on what is being undone.

**Shipped code that is not published yet** — anything in `aded55b..HEAD` today —
is still a `git revert` of the commit that changed it. `dist/` is gitignored and
rebuildable (`pnpm build`), so it is never the thing to restore.

**Anything consumers already have is a registry operation.** `1.0.0` is a
published version, so reverting a commit here does not remove it from npm and
does not change what an installed consumer runs. Undoing a published release
means `npm deprecate` (with a message naming the reason and the version to move
to) or a new patch version that supersedes it — never a republish of `1.0.0` and
never an `npm unpublish` without the owner's explicit decision, since
unpublishing takes the tarball away from anyone who has not installed it yet.
`1.0.0` corresponds to commit `aded55b`. That mapping is the thing to preserve:
if `1.0.1` is ever cut, record its own commit here, because a version whose
commit nobody wrote down cannot be audited later.

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
| `pnpm publish` (real) | **not run here**, deliberately | §5. No publish was made from this worktree, and nothing in this document was produced by one. It is a fact about the registry's current state, not about this document's runs: `@apothic-ai/solid-lynx@1.0.0` was published on 2026-10-25 from commit `aded55b`, which is an ancestor of this tree, so the publish is real and predates everything §2a was written for. |

Everything else in this document — the install, the five gate commands
(`typecheck`, `typecheck:consumer`, `test`, `build`, `pack --dry-run`), both
browser suites, `pnpm web:build`, `pnpm native:build`, the native runner's four
`--dry-run` invocations (smoke, stylesheet, list, and the wrapper), the three
version commands, the version-agreement one-liner,
`npm view solid-lynx`, and `pnpm publish --dry-run` — was executed at this
commit and exited 0.
