/**
 * Consumer install: the packed tarball, unpacked into an empty app's
 * `node_modules`, must actually import — its entry points must resolve, its
 * docs must be reachable from where it was installed, and it must need nothing
 * at runtime but `solid-js`.
 *
 * Why this file exists. `test/packaging.test.ts` reads the real tarball's file
 * list and its link graph, but it reads them from the repository checkout: it
 * proves the right files are *named* in `files[]`, not that a package installed
 * from them *works*. `docs/compatibility.md` §6 argues at length that only
 * `solid-js` is a required peer and that the three toolchain peers are optional
 * because only `solid-lynx/rspeedy` needs them — and nothing exercised that
 * argument either. Both were verified by hand once (pack, install, import,
 * `createLynxRoot()` with no host). A hand check is not a regression: the day
 * `exports` loses a subpath, or `files[]` drops `docs`, or the root entry grows
 * an import of `@rsbuild/core`, every existing test still passes.
 *
 * What makes this an install test rather than a source test:
 *
 *  1. `pnpm pack` runs for real (no `--dry-run`, no hand-built tar), into a
 *     temp directory. The tarball is the workspace's own output and its file
 *     list is still decided by `files[]`.
 *  2. The tarball is extracted to `<temp>/app/node_modules/solid-lynx`. There is
 *     deliberately no `npm install`: the package manager would want the
 *     registry, and "install" here means laying out the tree node itself
 *     resolves against. `solid-js` — the one required peer — is *copied* out of
 *     this repository's installed tree (dereferencing the pnpm store symlink)
 *     so that the temp app is self-contained and node cannot silently reach
 *     back into the repository for anything. Nothing else is copied: no
 *     `@rsbuild/*`, no `babel-preset-solid`. That absence is the evidence for
 *     §6, not a convenience.
 *  3. Resolution is done by node, in a child process. The probe runs as
 *     `node --input-type=module -e "…"` with its cwd set to the temp app,
 *     because node resolves a bare specifier from the *importing module's* URL.
 *     An `-e` script's URL is `<cwd>/[eval1]`, so its imports start at the temp
 *     app; a probe file living in this repository would instead resolve from
 *     the repository and prove nothing. The test process never imports
 *     `solid-lynx` itself.
 *  4. Every assertion is read from the child's report of what node actually
 *     resolved, so a failure names the real resolution. The probe never throws:
 *     a broken subpath is recorded against that subpath, so one failure does not
 *     hide the rest.
 *
 * Offline and deterministic: `pnpm pack` reads the working tree, `tar` unpacks
 * it, and one node child process imports it. No registry, no network, no
 * device, no browser, no port binding. The temp tree is removed in `afterAll`.
 *
 * Cost, measured on this worktree with `dist/` already built (which `pnpm test`
 * guarantees, because it runs `pnpm build` first): `pnpm pack` 21-29 ms, tar
 * extraction 5 ms, copying `solid-js` 3-5 ms, the child process 29-33 ms —
 * ~60-72 ms end to end, and 0.3-0.5 s of wall time for the file as Vitest
 * reports it, the rest being collection and transpilation. That is fast enough
 * for the `unit` job's `pnpm test` with no gating or tagging.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * `docs/contract.md` §14 states the count ("20 ids") and `test/parity.test.ts`
 * treats the array as the operation list, so the count is contract. The ids
 * themselves are not asserted: renaming one is a labelling change, dropping one
 * is a diagnostic that silently stops checking an operation.
 */
const EXPECTED_PARITY_OPERATION_COUNT = 20;

/** The entry points §1 of `docs/contract.md` documents as reachable. */
const REQUIRED_ENTRY_POINTS = [
  "solid-lynx",
  "solid-lynx/parity",
  "solid-lynx/jsx-runtime",
  "solid-lynx/jsx-dev-runtime",
] as const;

/**
 * `solid-lynx/rspeedy` is the fifth documented entry, and the one whose module
 * graph imports the optional toolchain peers on purpose. It is checked
 * separately: the specifier must resolve through `exports`, and importing it may
 * fail only on a declared optional peer — never on the package's own files.
 */
const TOOLCHAIN_ENTRY_POINT = "solid-lynx/rspeedy";

/** The peers `package.json` declares with `optional: true`. */
const OPTIONAL_PEERS = ["@rsbuild/core", "@rsbuild/plugin-babel", "babel-preset-solid"];

/** The documents the README links to and a consumer is expected to be able to read. */
const REQUIRED_DOCS = ["docs/contract.md", "docs/compatibility.md"];

interface PackResult {
  name: string;
  version: string;
  filename: string;
  files: Array<{ path: string }>;
}

interface EntryReport {
  /** URL node resolved the specifier to, or `null` when resolution threw. */
  url: string | null;
  /** Named exports, sorted; empty when the import threw or exported nothing. */
  exports: string[];
  /** `CODE: first line of message`, when resolve or import threw. */
  error: string | null;
}

interface DocReport {
  url: string | null;
  exists: boolean;
  bytes: number;
}

interface ConsumerReport {
  cwd: string;
  lynxGlobals: Record<string, string>;
  entries: Record<string, EntryReport>;
  solidJs: { url: string | null; error: string | null };
  packageRootUrl: string | null;
  root: { version: unknown; versionType: string; createLynxRoot: string } | null;
  parity: { isArray: boolean; length: number; allStrings: boolean; unique: boolean } | null;
  jsx: Record<string, string> | null;
  jsxDev: Record<string, string> | null;
  docs: Record<string, DocReport>;
  noHost: {
    threw: boolean;
    isError?: boolean;
    name?: string;
    message?: string;
    isTypeError?: boolean;
    isReferenceError?: boolean;
  };
  rspeedy: {
    url: string | null;
    error: string | null;
    imported: boolean | null;
    code: string | null;
    message: string | null;
  };
}

const REPORT_MARKER = "SOLID_LYNX_CONSUMER_REPORT ";

/**
 * The probe that runs inside the temp app. It is one `-e` program rather than a
 * file in this repository because node resolves bare specifiers relative to the
 * importing module: a file under `test/` would resolve `solid-lynx` from the
 * repository, which is exactly what this test must not measure.
 *
 * It imports nothing belonging to the package under test by path. Every
 * specifier is a published one, and every question it answers is about what node
 * resolved. Arguments: `argv[1]` is the installed package root, used only as the
 * fallback origin for the docs check when the root entry itself does not import.
 */
const PROBE_SCRIPT = `
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const report = {
  cwd: process.cwd(),
  lynxGlobals: {},
  entries: {},
  solidJs: { url: null, error: null },
  packageRootUrl: null,
  root: null,
  parity: null,
  jsx: null,
  jsxDev: null,
  docs: {},
  noHost: { threw: false },
  rspeedy: { url: null, error: null, imported: null, code: null, message: null },
};

const firstLine = message => String(message === undefined ? "" : message).split("\\n")[0];
const describeError = error =>
  (error && error.code ? error.code + ": " : "") + firstLine(error && error.message);

// The Lynx Element PAPI lives on the global object in a real Lynx runtime. If
// any of it were present here, the host-free assertion below would be vacuous.
for (const name of ["__CreatePage", "__CreateElement", "__AppendElement"]) {
  report.lynxGlobals[name] = typeof globalThis[name];
}

// Resolve and import one specifier, recording either answer. Never throws: a
// broken subpath must show up against that subpath, not abort the probe.
async function attempt(specifier) {
  let url = null;
  let error = null;
  let namespace = null;
  try {
    url = import.meta.resolve(specifier);
  } catch (thrown) {
    error = describeError(thrown);
  }
  if (url !== null) {
    try {
      namespace = await import(specifier);
    } catch (thrown) {
      error = describeError(thrown);
    }
  }
  return { url, error, namespace };
}

for (const specifier of ${JSON.stringify([...REQUIRED_ENTRY_POINTS, TOOLCHAIN_ENTRY_POINT])}) {
  const { url, error, namespace } = await attempt(specifier);
  report.entries[specifier] = {
    url,
    exports: namespace === null ? [] : Object.keys(namespace).sort(),
    error,
  };
}

// The required peer, as the installed package itself resolves it. Reported so
// the parent can prove it came from the temp app and not from this repository.
{
  const { url, error } = await attempt("solid-js");
  report.solidJs = { url, error };
}

// The installed package root: derived from the URL node resolved for the root
// entry, so the docs below are located from the install rather than from a
// repository path. Falls back to the root the parent passed in, so the docs
// check still reports when the root entry itself is what broke.
const rootEntry = report.entries["solid-lynx"];
report.packageRootUrl = rootEntry.url !== null
  ? new URL("../", rootEntry.url).href
  : (process.argv[1] === undefined ? null : pathToFileURL(process.argv[1] + "/").href);

if (rootEntry.url !== null) {
  const { namespace: root } = await attempt("solid-lynx");
  if (root !== null) {
    report.root = {
      version: root.version,
      versionType: typeof root.version,
      createLynxRoot: typeof root.createLynxRoot,
    };

    // No Lynx host in this process: createLynxRoot() must fail with the package's
    // own diagnostic, not with a TypeError from a missing global.
    try {
      root.createLynxRoot();
      report.noHost = { threw: false };
    } catch (error) {
      report.noHost = {
        threw: true,
        isError: error instanceof Error,
        name: error && error.name,
        message: error && error.message,
        isTypeError: error instanceof TypeError,
        isReferenceError: error instanceof ReferenceError,
      };
    }
  }
}

if (report.entries["solid-lynx/parity"].error === null) {
  const { namespace } = await attempt("solid-lynx/parity");
  const ids = namespace === null ? undefined : namespace.parityOperationIds;
  if (namespace !== null) {
    report.parity = {
      isArray: Array.isArray(ids),
      length: Array.isArray(ids) ? ids.length : -1,
      allStrings: Array.isArray(ids) && ids.every(id => typeof id === "string"),
      unique: Array.isArray(ids) && new Set(ids).size === ids.length,
    };
  }
}

if (report.entries["solid-lynx/jsx-runtime"].error === null) {
  const { namespace } = await attempt("solid-lynx/jsx-runtime");
  if (namespace !== null) {
    report.jsx = {
      Fragment: typeof namespace.Fragment,
      jsx: typeof namespace.jsx,
      jsxs: typeof namespace.jsxs,
    };
  }
}

if (report.entries["solid-lynx/jsx-dev-runtime"].error === null) {
  const { namespace } = await attempt("solid-lynx/jsx-dev-runtime");
  if (namespace !== null) {
    report.jsxDev = {
      Fragment: typeof namespace.Fragment,
      jsxDEV: typeof namespace.jsxDEV,
    };
  }
}

for (const doc of ${JSON.stringify(REQUIRED_DOCS)}) {
  if (report.packageRootUrl === null) {
    report.docs[doc] = { url: null, exists: false, bytes: 0 };
    continue;
  }
  const docUrl = new URL(doc, report.packageRootUrl);
  const path = fileURLToPath(docUrl);
  const present = existsSync(path);
  report.docs[doc] = {
    url: docUrl.href,
    exists: present,
    bytes: present ? readFileSync(path, "utf8").length : 0,
  };
}

// The toolchain entry: its specifier must resolve through exports, and its
// module graph may only be missing the optional peers.
{
  const { url, error, namespace } = await attempt(${JSON.stringify(TOOLCHAIN_ENTRY_POINT)});
  report.rspeedy.url = url;
  report.rspeedy.error = error;
  report.rspeedy.imported = namespace !== null ? true : url === null ? null : false;
  if (namespace === null && error !== null) {
    report.rspeedy.code = error.split(":")[0];
    report.rspeedy.message = error;
  }
}

process.stdout.write(${JSON.stringify(REPORT_MARKER)} + JSON.stringify(report));
`;

let tempRoot: string;
let appDir: string;
let installedRoot: string;
let installedRootUrl: string;
let pack: PackResult;
let installedManifest: {
  name: string;
  version: string;
  type?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};
let report: ConsumerReport;

/** `true` when `url` points into the installed package directory. */
function isInsideInstalled(url: string | null): boolean {
  if (url === null) return false;
  return url === installedRootUrl || url.startsWith(installedRootUrl + "/");
}

beforeAll(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "solid-lynx-consumer-"));
  appDir = join(tempRoot, "app");
  installedRoot = join(appDir, "node_modules", "solid-lynx");
  installedRootUrl = pathToFileURL(installedRoot).href;
  const packDir = join(tempRoot, "pack");
  mkdirSync(packDir, { recursive: true });
  mkdirSync(join(appDir, "node_modules"), { recursive: true });

  // The real tarball, from the real `files[]`. `pnpm` for the same reason
  // `test/packaging.test.ts` uses it: it is the package manager this repository
  // pins, and its `--json` result names the tarball it wrote. No `--dry-run`.
  const packed = execFileSync(
    "pnpm",
    ["pack", "--pack-destination", packDir, "--json"],
    { cwd: packageRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  pack = JSON.parse(packed) as PackResult;

  if (!pack.filename || !existsSync(pack.filename)) {
    throw new Error(`pnpm pack reported ${JSON.stringify(pack.filename)}, which does not exist`);
  }

  // A tarball carries `dist/` only if it was built first. Say so plainly
  // instead of letting the import fail as a resolution error.
  const shipped = new Set(pack.files.map(entry => entry.path));
  if (!shipped.has("dist/index.js")) {
    throw new Error(
      "the tarball has no dist/index.js: run `pnpm build` before the tests "
        + "(the package ships only what `files[]` selects, and only what is built)",
    );
  }

  // Extraction rather than `npm install`: installing would go to the registry,
  // and the point is the layout node resolves against, not npm's bookkeeping.
  // npm-compatible tarballs put everything under one `package/` directory, so
  // that directory becomes the installed package.
  execFileSync("tar", ["-xzf", pack.filename, "-C", join(appDir, "node_modules")], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const unpacked = join(appDir, "node_modules", "package");
  if (!existsSync(unpacked)) {
    throw new Error(`the tarball ${pack.filename} did not unpack a package/ directory`);
  }
  renameSync(unpacked, installedRoot);

  // The one required peer, copied (not linked) out of this repository's
  // installed tree. Copying keeps the temp app self-contained: node cannot
  // follow a symlink back into the repository's `node_modules` and find a
  // package this test means to prove absent. `dereference` flattens the pnpm
  // store symlink the repository's own `node_modules/solid-js` is.
  const requireFromHere = createRequire(import.meta.url);
  const solidJsSource = dirname(requireFromHere.resolve("solid-js/package.json"));
  cpSync(solidJsSource, join(appDir, "node_modules", "solid-js"), {
    recursive: true,
    dereference: true,
  });

  writeFileSync(
    join(appDir, "package.json"),
    `${JSON.stringify({ name: "solid-lynx-consumer-probe", private: true, type: "module" }, null, 2)}\n`,
  );

  installedManifest = JSON.parse(
    readFileSync(join(installedRoot, "package.json"), "utf8"),
  ) as typeof installedManifest;

  // The child is the only thing that touches the package. Its cwd is the temp
  // app, which is what makes bare-specifier resolution start there; NODE_OPTIONS
  // and NODE_PATH are dropped so an inherited loader or an unlisted search path
  // cannot stand in for the install.
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (key === "NODE_OPTIONS" || key === "NODE_PATH") continue;
    env[key] = value;
  }

  const stdout = execFileSync(
    process.execPath,
    [
      // `browser` is the condition set a Lynx app's bundler resolves with (and
      // the set `vitest.config.ts` declares). Without it node picks Solid's
      // server build, which is not what a renderer consumer gets.
      "--conditions=browser",
      "--input-type=module",
      "-e",
      PROBE_SCRIPT,
      installedRoot,
    ],
    { cwd: appDir, encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] },
  );

  const marker = stdout.indexOf(REPORT_MARKER);
  if (marker < 0) {
    throw new Error(`the consumer probe printed no report; stdout was:\n${stdout}`);
  }
  report = JSON.parse(stdout.slice(marker + REPORT_MARKER.length)) as ConsumerReport;
});

afterAll(() => {
  if (tempRoot !== undefined) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe("a consumer that installs the packed tarball", () => {
  it("installs the workspace's own tarball into an empty app", () => {
    // The tarball is the workspace output, not something this file built.
    expect(pack.name).toBe("solid-lynx");
    expect(pack.filename.endsWith(".tgz")).toBe(true);

    // What landed on disk is what `pnpm pack` wrote, unmodified.
    expect(installedManifest.name).toBe(pack.name);
    expect(installedManifest.version).toBe(pack.version);
    expect(installedManifest.type).toBe("module");

    // Nothing but the package and its one required peer is installed. That is
    // the condition §6 of docs/compatibility.md is argued under, and every
    // import below runs in it.
    expect(readdirSync(join(appDir, "node_modules")).sort()).toEqual(["solid-js", "solid-lynx"]);
  });

  it("resolves every documented entry point inside the installed copy", () => {
    const failures: string[] = [];

    for (const specifier of REQUIRED_ENTRY_POINTS) {
      const entry = report.entries[specifier];
      if (entry === undefined) {
        failures.push(`${specifier}: not attempted`);
      } else if (entry.error !== null) {
        failures.push(`${specifier}: ${entry.error}`);
      } else if (!isInsideInstalled(entry.url)) {
        // A package that resolved from this checkout would prove nothing about
        // the install, so resolving outside the temp app is a failure too.
        failures.push(`${specifier}: resolved outside the install, to ${entry.url}`);
      } else if (entry.exports.length === 0) {
        failures.push(`${specifier}: resolved to ${entry.url} but exported nothing`);
      }
    }

    expect(failures, failures.join("\n")).toEqual([]);

    // The required peer resolved from the temp app too, so the imports above
    // were not served by this repository's node_modules.
    const peerPrefix = pathToFileURL(join(appDir, "node_modules", "solid-js")).href;
    expect(report.solidJs.error, `solid-js did not resolve: ${report.solidJs.error}`).toBeNull();
    expect(
      report.solidJs.url?.startsWith(peerPrefix),
      `solid-js resolved to ${report.solidJs.url}, which is not the temp app's copy`,
    ).toBe(true);
  });

  it("exports the version its own manifest declares", () => {
    expect(report.root, "solid-lynx did not import").not.toBeNull();
    expect(report.root?.versionType).toBe("string");
    expect(report.root?.version).toBe(installedManifest.version);

    // The manifest inside the tarball is the repository's manifest, so a
    // version bumped in one place has to reach both.
    const repositoryVersion = (
      JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { version: string }
    ).version;
    expect(installedManifest.version).toBe(repositoryVersion);
  });

  it("ships the twenty parity operation ids", () => {
    expect(report.parity, "solid-lynx/parity did not import").not.toBeNull();
    expect(report.parity?.isArray).toBe(true);
    expect(report.parity?.allStrings).toBe(true);
    expect(report.parity?.unique).toBe(true);
    expect(
      report.parity?.length,
      `solid-lynx/parity exported ${report.parity?.length} operation id(s); `
        + `docs/contract.md §14 freezes ${EXPECTED_PARITY_OPERATION_COUNT}`,
    ).toBe(EXPECTED_PARITY_OPERATION_COUNT);
  });

  it("ships the JSX runtimes with the documented helpers", () => {
    // §1 of docs/contract.md: these two entries exist for
    // `jsxImportSource: "solid-lynx"`; their types are contract and their
    // runtime functions are provisional. Names only — not behaviour, and not the
    // whole export list, so adding a helper is not a failure here.
    expect(report.entries["solid-lynx/jsx-runtime"].error, "solid-lynx/jsx-runtime did not import")
      .toBeNull();
    expect(report.entries["solid-lynx/jsx-dev-runtime"].error, "solid-lynx/jsx-dev-runtime did not import")
      .toBeNull();
    for (const name of ["Fragment", "jsx", "jsxs"] as const) {
      expect(report.jsx?.[name], `solid-lynx/jsx-runtime does not export ${name}()`).toBe("function");
    }
    for (const name of ["Fragment", "jsxDEV"] as const) {
      expect(report.jsxDev?.[name], `solid-lynx/jsx-dev-runtime does not export ${name}()`).toBe(
        "function",
      );
    }
  });

  it("ships the docs a consumer is pointed at, reachable from the install", () => {
    const failures: string[] = [];

    for (const doc of REQUIRED_DOCS) {
      const entry = report.docs[doc];
      if (entry === undefined) {
        failures.push(`${doc}: not attempted`);
      } else if (!entry.exists) {
        failures.push(`${doc}: missing at ${entry.url ?? "an unknown install root"}`);
      } else if (entry.bytes === 0) {
        failures.push(`${doc}: present at ${entry.url} but empty`);
      } else if (!(entry.url ?? "").startsWith(installedRootUrl + "/")) {
        failures.push(`${doc}: read from ${entry.url}, which is outside the install`);
      }
    }

    expect(failures, failures.join("\n")).toEqual([]);

    // Presence as the installing host sees it, not only inside the child.
    for (const doc of REQUIRED_DOCS) {
      expect(existsSync(join(installedRoot, doc)), `${doc} is not under the installed root`).toBe(true);
    }
  });

  it("fails with its own diagnostic, not a TypeError, when there is no Lynx host", () => {
    // The child proved the Element PAPI globals are absent, so the call below is
    // genuinely host-free.
    expect(report.lynxGlobals).toEqual({
      __CreatePage: "undefined",
      __CreateElement: "undefined",
      __AppendElement: "undefined",
    });

    expect(report.root, "solid-lynx did not import").not.toBeNull();
    expect(report.root?.createLynxRoot).toBe("function");
    expect(report.noHost.threw, "createLynxRoot() with no Lynx host did not throw").toBe(true);
    expect(report.noHost.isError, "the thrown value is not an Error").toBe(true);
    expect(report.noHost.isTypeError, "threw a TypeError; the missing host was not diagnosed").toBe(
      false,
    );
    expect(report.noHost.isReferenceError, "threw a ReferenceError; a global was dereferenced").toBe(
      false,
    );
    // Narrow on purpose: the diagnostic must name the operation, not match a
    // whole sentence that a wording change would break.
    expect(
      report.noHost.message ?? "",
      `the error must name the missing Element PAPI operation; it was: ${report.noHost.message}`,
    ).toContain("__CreatePage");
  });

  it("needs only solid-js at runtime; the toolchain peers are optional", () => {
    // §6 of docs/compatibility.md, as shipped: exactly one non-optional peer.
    const peers = Object.keys(installedManifest.peerDependencies ?? {});
    expect(peers).toContain("solid-js");
    const optional = installedManifest.peerDependenciesMeta ?? {};
    expect(optional["solid-js"]?.optional, "solid-js must not be marked optional").not.toBe(true);

    for (const peer of OPTIONAL_PEERS) {
      expect(peers, `${peer} should stay declared as a peer`).toContain(peer);
      expect(
        optional[peer]?.optional,
        `${peer} is a toolchain peer and must stay optional, or every consumer install grows a toolchain`,
      ).toBe(true);
    }

    // §6 also states there is no `dependencies` block: the runtime entry imports
    // only `solid-js`. A runtime dependency would be an install-time
    // requirement with no peer declaration behind it.
    expect(
      Object.keys(installedManifest.dependencies ?? {}),
      "the packed manifest gained a runtime dependency; docs/compatibility.md §6 says there is none",
    ).toEqual([]);

    // The toolchain entry is the declared exception, and this app has none of
    // its peers installed: the specifier must still resolve through `exports`,
    // and importing it may fail only because a declared optional peer is absent.
    expect(
      report.rspeedy.url,
      `solid-lynx/rspeedy does not resolve through exports: ${report.rspeedy.error ?? "no url"}`,
    ).toMatch(/\/rspeedy\.js$/);
    expect(isInsideInstalled(report.rspeedy.url)).toBe(true);

    if (report.rspeedy.imported === false) {
      expect(
        report.rspeedy.code,
        `solid-lynx/rspeedy failed for a reason other than a missing peer: ${report.rspeedy.message}`,
      ).toBe("ERR_MODULE_NOT_FOUND");
      expect(
        OPTIONAL_PEERS.some(peer => (report.rspeedy.message ?? "").includes(peer)),
        `solid-lynx/rspeedy failed on ${report.rspeedy.message}, which names no declared optional peer`,
      ).toBe(true);
    }

    // The four runtime entries above imported in this tree, which is the
    // positive half of the same claim: none of them needed a toolchain peer.
    for (const specifier of REQUIRED_ENTRY_POINTS) {
      expect(
        report.entries[specifier].error,
        `${specifier} did not import in an app that has only solid-js installed`,
      ).toBeNull();
    }
  });
});
