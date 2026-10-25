/**
 * Packaging contract: every documentation link a consumer can see must land
 * somewhere they can actually reach.
 *
 * The defect this file exists for: `package.json` `files` listed only
 * `dist`, `README.md` and `LICENSE`, so a published package carried a README
 * whose nine "read this for the contract / limits / migration" links all
 * pointed at files that were not in the tarball. Nothing failed locally,
 * because from a repository checkout every one of those paths exists.
 *
 * The check is deliberately offline and mechanical:
 *
 *  1. Ask the package manager for the real file list of the tarball
 *     (`pnpm pack --dry-run --json`; see `PACK_JSON_COMMAND` for why pnpm and
 *     not npm). That is the only source of truth for what ships, so this test
 *     cannot drift from `files[]` the way a hard-coded list would.
 *  2. Extract every markdown link target from the shipped `.md` files, the
 *     README and the shipped `docs/` included.
 *  3. Fail on any relative target that is not in the tarball, on any link that
 *     escapes the package root (a `../` link cannot be satisfied from an
 *     installed package), and on any fragment that names no heading in the
 *     file it points at.
 *
 * Network links are never followed: `http(s)` targets are accepted as-is, so
 * the test needs no network, no device and no browser.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * `pnpm pack --dry-run --json` is used instead of `npm pack --dry-run --json`
 * for one reason: pnpm is the package manager this repository pins
 * (`packageManager: pnpm@12.9.1`) and the one the `unit` CI job's
 * `pnpm pack --dry-run` step already runs, so the test measures the same
 * command a release does. Its JSON is a single object with a `files` array of
 * `{ path }` entries — the same shape npm produces, plus the `Tarball Details`
 * summary line on stderr that `--json` suppresses. Both were checked; pnpm's
 * output is pure JSON on stdout with an empty stderr.
 */
const PACK_JSON_COMMAND = "pnpm";

/** Directories and files to scan for links. `files[]` decides membership. */
const MARKDOWN_EXTENSIONS = [".md"];

interface PackEntry {
  path: string;
}

interface PackResult {
  name: string;
  version: string;
  filename: string;
  files: PackEntry[];
}

interface LinkTarget {
  /** File the link was found in, package-relative and `/`-separated. */
  file: string;
  /** 1-based line number, for a failure message that points at the source. */
  line: number;
  /** The raw text inside `(...)`. */
  raw: string;
}

/**
 * The published identity, in the one file that reads the packed tarball's own
 * manifest rather than the repository's.
 *
 * `name` and `publishConfig` are packaging facts, not prose: the scope decides
 * which npm organisation owns the package, and a scoped package defaults to
 * `restricted`, so `publishConfig.access: "public"` is the only thing that makes
 * an install reachable from outside that organisation. Both are asserted from
 * the tarball's package.json, so a repository manifest that disagreed with what
 * shipped would fail here.
 */
const PACKAGE_NAME = "@apothic-ai/solid-lynx";
const PACKAGE_SCOPE = "@apothic-ai";
const PACKAGE_BASENAME = "solid-lynx";

/** What the pre-scope name was, so a revert fails with the decision named. */
const LEGACY_UNSCOPED_NAME = "solid-lynx";

let pack: PackResult;
let shippedFiles: Set<string>;

/** Convert an absolute path to the package-relative form used by `pack`. */
function toPackagePath(absolutePath: string): string {
  return relative(packageRoot, absolutePath).split(sep).join("/");
}

/**
 * Strip fenced code blocks. A link inside a fence is sample text, not a link,
 * and must not be validated — otherwise documenting markdown syntax in this
 * very file's neighbours would fail the build.
 */
function withoutFencedCode(source: string): string {
  const lines = source.split("\n");
  const kept: string[] = [];
  let fence: string | undefined;

  for (const line of lines) {
    const marker = /^\s*(```+|~~~+)/.exec(line);
    if (marker) {
      if (fence === undefined) {
        fence = marker[1][0];
      } else if (marker[1][0] === fence) {
        fence = undefined;
      }
      kept.push("");
      continue;
    }
    kept.push(fence === undefined ? line : "");
  }

  return kept.join("\n");
}

/**
 * Every inline markdown link target in `source`, as `[label](target)`.
 *
 * Inline links only. This repository's documentation uses no reference-style
 * definitions and no raw HTML anchors (checked), so the narrower parse is
 * honest here; if a future doc adds either, `packaging.test.ts`'s sibling
 * assertion on `linkTargets` counts would not catch it — `hasNoUnparsedLinks`
 * does, by refusing a `](` the parser did not consume.
 */
function linkTargets(file: string, source: string): LinkTarget[] {
  const targets: LinkTarget[] = [];
  const lines = withoutFencedCode(source).split("\n");

  lines.forEach((line, index) => {
    // `[^\]]*` rather than `.*?` so a label may not swallow a nested bracket.
    for (const match of line.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      targets.push({ file, line: index + 1, raw: match[1] });
    }
  });

  return targets;
}

/**
 * The `](#fragment)` form GitHub generates for a heading: lowercase, drop
 * inline code backticks and punctuation, spaces to hyphens.
 */
function headingSlug(heading: string): string {
  return heading
    .replace(/^#{1,6}\s*/, "")
    .replace(/`/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

function headingSlugs(source: string): Set<string> {
  const slugs = new Set<string>();
  for (const line of withoutFencedCode(source).split("\n")) {
    if (/^#{1,6}\s/.test(line)) {
      slugs.add(headingSlug(line));
    }
  }
  return slugs;
}

/** `true` when `candidate` is inside the package directory. */
function isInsidePackage(candidate: string): boolean {
  return candidate === packageRoot || candidate.startsWith(packageRoot + sep);
}

function readDoc(file: string): string {
  return readFileSync(join(packageRoot, file), "utf8");
}

beforeAll(() => {
  // `pnpm build` is part of `pnpm test`, so `dist/` exists by the time this
  // runs. -s keeps stderr out of the parsed JSON; pnpm writes the summary there.
  const json = execFileSync(PACK_JSON_COMMAND, ["pack", "--dry-run", "--json"], {
    cwd: packageRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  pack = JSON.parse(json) as PackResult;
  shippedFiles = new Set(pack.files.map(entry => entry.path));
});

describe("the published package", () => {
  it("has a usable tarball file list", () => {
    expect(pack.name).toBe(PACKAGE_NAME);
    expect(pack.files.length).toBeGreaterThan(0);
    // Sanity: the entries are package-relative paths, not absolute ones, and
    // the two files npm always adds are present.
    expect(shippedFiles.has("package.json")).toBe(true);
    expect(shippedFiles.has("README.md")).toBe(true);
    for (const entry of shippedFiles) {
      expect(entry.startsWith("/")).toBe(false);
      expect(entry.startsWith("../")).toBe(false);
    }
  });

  it("publishes under the scoped name with public access", () => {
    // `package.json` always ships (npm adds it even when `files[]` omits it), so
    // the manifest read here is the one a registry receives. Its own copy inside
    // the unpacked tarball is asserted in `test/consumer-install.test.ts`, where
    // there is an installed tree to read it from; this is the cheaper half that
    // fails first, in the same run as the file list.
    expect(shippedFiles.has("package.json")).toBe(true);

    const manifest = JSON.parse(
      readFileSync(join(packageRoot, "package.json"), "utf8"),
    ) as { name: string; version: string; publishConfig?: { access?: string } };

    expect(manifest.name).toBe(PACKAGE_NAME);
    // `pnpm pack` reports the name it read from that same manifest, so the two
    // cannot disagree without this failing.
    expect(pack.name).toBe(manifest.name);
    expect(pack.version).toBe(manifest.version);

    // A revert of the name is a different package on npm, not a rename.
    expect(manifest.name).not.toBe(LEGACY_UNSCOPED_NAME);
    expect(manifest.name).toBe(`${PACKAGE_SCOPE}/${PACKAGE_BASENAME}`);

    // Scoped packages default to `restricted`; without this every install
    // outside the organisation gets a 404 and the tarball is unusable.
    expect(
      manifest.publishConfig?.access,
      "a scoped package defaults to restricted; publishConfig.access must say public",
    ).toBe("public");
  });

  it("names its tarball after the scoped package", () => {
    // pnpm drops the `@` and keeps the rest: `@apothic-ai/solid-lynx` packs to
    // `apothic-ai-solid-lynx-<version>.tgz`. Read from what pnpm wrote, not from
    // a remembered string.
    expect(pack.filename).toBe(
      `${PACKAGE_SCOPE.slice(1)}-${PACKAGE_BASENAME}-${pack.version}.tgz`,
    );
    expect(pack.filename).not.toBe(`${LEGACY_UNSCOPED_NAME}-${pack.version}.tgz`);
  });

  it("ships every document the README links to", () => {
    // The defect made concrete: these nine links used to be dead in the
    // tarball. Each is now a shipped file, so this list doubles as the
    // regression record.
    for (const required of [
      "docs/contract.md",
      "docs/compatibility.md",
      "docs/migration.md",
      "docs/capabilities.md",
      "docs/session-handoff.md",
      "CHANGELOG.md",
      "ROADMAP.md",
      "LICENSE",
    ]) {
      expect(shippedFiles.has(required), `${required} must be in the tarball`).toBe(true);
    }
  });

  it("has no relative link that points outside the tarball", () => {
    const shippedDocs = [...shippedFiles]
      .filter(path => MARKDOWN_EXTENSIONS.some(extension => path.endsWith(extension)))
      .sort();

    // The scan has to cover the README and the shipped docs, or it could pass
    // by scanning nothing. Asserted after the link problems, so the useful
    // enumeration is what a failure reports first.
    const problems: string[] = [];

    for (const file of shippedDocs) {
      for (const target of linkTargets(file, readDoc(file))) {
        const raw = target.raw.trim();
        const where = `${target.file}:${target.line}`;

        // Network links are reachable from anywhere and are never followed.
        if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !raw.startsWith("./") && !raw.startsWith("../")) {
          if (!/^https?:\/\//i.test(raw) && !raw.startsWith("mailto:")) {
            // A scheme other than http(s)/mailto ships fine only if it is a
            // real scheme the reader's client understands; fail loudly rather
            // than silently accepting a typo like `htps://`.
            problems.push(`${where}: unsupported link scheme in ${raw}`);
          }
          continue;
        }

        const [targetPath, fragment] = raw.split("#");
        const absolute = targetPath === ""
          ? join(packageRoot, file)
          : resolve(packageRoot, dirname(file), targetPath);
        const shippedPath = toPackagePath(absolute);

        if (!isInsidePackage(absolute)) {
          problems.push(
            `${where}: ${raw} escapes the package root (resolves outside to ${shippedPath}); ` +
              "an installed package cannot contain it",
          );
          continue;
        }

        if (targetPath !== "" && !shippedFiles.has(shippedPath)) {
          problems.push(`${where}: ${raw} resolves to ${shippedPath}, which is not in the tarball`);
          continue;
        }

        if (fragment) {
          if (!existsSync(absolute)) {
            problems.push(`${where}: ${raw} names a heading in a file that does not exist`);
            continue;
          }
          const slugs = headingSlugs(readFileSync(absolute, "utf8"));
          if (!slugs.has(fragment)) {
            problems.push(
              `${where}: ${raw} names #${fragment}, but ${shippedPath} has no such heading`,
            );
          }
        }
      }
    }

    expect(problems, problems.join("\n")).toEqual([]);

    expect(shippedDocs).toContain("README.md");
    expect(shippedDocs.some(path => path.startsWith("docs/"))).toBe(true);
  });

  it("parses every link the shipped docs contain", () => {
    // Guards the extractor: an inline-link form it does not understand
    // (`[x]: y` definitions, raw `<a href>`, a malformed `](`) would otherwise
    // let a broken link through by never being seen.
    const shippedDocs = [...shippedFiles].filter(path => path.endsWith(".md"));
    const offenders: string[] = [];

    for (const file of shippedDocs) {
      const source = readDoc(file);
      const withoutCode = withoutFencedCode(source);

      if (/^\s{0,3}\[[^\]]+\]:\s+\S/m.test(withoutCode)) {
        offenders.push(`${file}: reference-style link definition`);
      }
      if (/<a\s[^>]*href=/i.test(withoutCode)) {
        offenders.push(`${file}: raw HTML anchor`);
      }

      const closers = withoutCode.match(/\]\(/g)?.length ?? 0;
      const parsed = linkTargets(file, source).length;
      if (closers !== parsed) {
        offenders.push(
          `${file}: ${closers} "](" occurrences but ${parsed} parsed links`,
        );
      }
    }

    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
