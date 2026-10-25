import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  LIST_PAPI_NAMES,
} from "../examples/lynx-for-native/src/list-probe-report.js";
import {
  STYLESHEET_PAPI_NAMES,
} from "../examples/lynx-for-native/src/stylesheet-probe-report.js";

/**
 * Host-free tests for `scripts/verify-native-probe.mjs`.
 *
 * The script is what turns a captured probe log into an exit code, so it is
 * driven the way a reviewer drives it: a real process, a real capture file, and
 * the real exit code. No device, no adb, no network — the fixtures under
 * `test/fixtures/native-probe/` are synthetic captures and the README beside
 * them says so.
 *
 * Two of these tests are structural rather than behavioural, and they are the
 * ones that keep the checker honest over time:
 *
 *  - the required stage sets are held to the cards by reading the stage names
 *    out of `stylesheet-probe.ts` and `list-probe.ts`, so a card that grows or
 *    renames a stage fails here instead of quietly verifying a capture that no
 *    longer matches the card;
 *  - the binding lists are held to the recorders by importing
 *    `STYLESHEET_PAPI_NAMES` and `LIST_PAPI_NAMES`, so the checker and the card
 *    cannot disagree about what the card inventories.
 *
 * The checker reads only a text file, so it needs no build; unlike the parity
 * tests these do not depend on `dist/`.
 */

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SCRIPT = path.join(REPO_ROOT, "scripts", "verify-native-probe.mjs");
const PARITY_SCRIPT = path.join(REPO_ROOT, "scripts", "verify-native-parity.mjs");
const FIXTURES = path.join(REPO_ROOT, "test", "fixtures", "native-probe");
const SS_SOURCE = path.join(REPO_ROOT, "examples", "lynx-for-native", "src",
  "stylesheet-probe.ts");
const LP_SOURCE = path.join(REPO_ROOT, "examples", "lynx-for-native", "src",
  "list-probe.ts");

const SS = "[solid-lynx ss]";
const LP = "[solid-lynx lp]";

const fixture = (name: string): string => path.join(FIXTURES, name);

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function runVerifier(...args: string[]): Run {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function runParity(...args: string[]): Run {
  const result = spawnSync(process.execPath, [PARITY_SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** A one-off capture file, for inputs that are not worth keeping as fixtures. */
function writeCapture(text: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "solid-lynx-probe-"));
  const file = path.join(dir, "capture.log");
  writeFileSync(file, text);
  return file;
}

const line = (marker: string, payload: Record<string, unknown>): string =>
  `I lynx_console: ${marker} ${JSON.stringify(payload)}\n`;

const capture = (lines: string[]): string => lines.join("");

/* ---------------------------------------------------------------- stage shapes
 *
 * Minimal stage payloads of the right shape, so a test can break exactly one
 * field. They are not fixtures: nothing here is stored, and every value is an
 * input to a single assertion.
 */

const stylesheetStage = (
  stage: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  probe: "native-stylesheet-papi",
  stage,
  ...overrides,
});

const loadOperation = (calls: unknown[]) => ({
  name: "__LoadStyleSheet",
  function: { typeof: "function", arity: 2, name: "__LoadStyleSheet" },
  calls,
});

const stylesheetCalls = {
  noArguments: {
    input: [],
    threw: { name: "TypeError", message: "missing required argument: url" },
  },
  missingUrl: {
    input: [{ kind: "string", value: "http://127.0.0.1:8099/__probe_missing__.css" }],
    threw: { name: "Error", message: "loadStyleSheet failed: 404" },
  },
  realUrl: {
    input: [{ kind: "string", value: "http://127.0.0.1:8099/probe.css" }],
    returned: { kind: "object", tag: "[object Object]", keys: [] },
  },
};

/**
 * A full stylesheet capture, with every stage carrying only the fields the
 * verifier reads. `mutate` can replace or drop a stage.
 */
function stylesheetCapture(
  mutate?: (stages: Record<string, unknown>[]) => Record<string, unknown>[],
): string {
  const operations = STYLESHEET_PAPI_NAMES.map(name => ({
    name,
    function: { typeof: "function", arity: 1, name },
    calls: [],
  }));
  const stages: Record<string, unknown>[] = [
    stylesheetStage("inventory", {
      relatedGlobals: ["__LoadStyleSheet"],
      operations,
    }),
    stylesheetStage("no-arguments", {
      operations: STYLESHEET_PAPI_NAMES.map(name => ({
        name,
        function: { typeof: "function", arity: 1, name },
        calls: [stylesheetCalls.noArguments],
      })),
    }),
    stylesheetStage("load-missing-url", {
      operations: [loadOperation([stylesheetCalls.missingUrl])],
    }),
    stylesheetStage("load-real-url", {
      operations: [loadOperation([stylesheetCalls.realUrl])],
    }),
    stylesheetStage("summary", {
      operations,
      unmeasured: [
        { operation: "__AdoptStyleSheet", reason: "no stylesheet handle was produced" },
        { operation: "lifecycle", reason: "no ordering was proven" },
      ],
    }),
    stylesheetStage("done", { status: "all stages logged" }),
  ];
  const final = mutate ? mutate(stages) : stages;
  return capture(final.map(stage => line(SS, stage)));
}

const listStage = (
  stage: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  probe: "native-list-papi",
  stage,
  ...overrides,
});

const listCounters = (componentAtIndex: number, enqueueComponent: number) => ({
  componentAtIndex,
  enqueueComponent,
  updateListCallbacks: 1,
  cellIndices: [],
});

/**
 * A full list capture. `enqueue` is the number of times the host is recorded as
 * having called `enqueueComponent`; `omitRecyclingAnswer` drops both places that
 * record it, which is the defect the card exists to make impossible to hide.
 */
function listCapture(options: {
  enqueue?: number;
  omitRecyclingAnswer?: boolean;
  mutate?: (stages: Record<string, unknown>[]) => Record<string, unknown>[];
} = {}): string {
  const enqueue = options.enqueue ?? 0;
  const omit = options.omitRecyclingAnswer ?? false;
  const stages: Record<string, unknown>[] = [
    listStage("inventory", {
      relatedGlobals: ["__CreateList"],
      operations: LIST_PAPI_NAMES.map((name, index) => ({
        name,
        typeof: "function",
        arity: index + 1,
      })),
      namedPresent: [...LIST_PAPI_NAMES],
      countingInstalled: true,
    }),
    listStage("create", {
      createListExposed: true,
      updateListCallbacksExposed: true,
      returnedHandle: true,
      handleTypeof: "unknown",
      modelItems: ["alpha"],
      rowsAfterCreate: [],
      children: { count: 0, truncated: false },
      hostCallCounts: listCounters(0, 0),
    }),
    listStage("materialize", {
      requested: [0],
      requestedCount: 1,
      materialized: 1,
      children: { count: 1, truncated: false },
      rows: [{ key: "alpha", item: "alpha" }],
      hostAskedAfterUpdate: false,
      hostAskedWhileMaterializing: false,
      hostAskedOnItsOwn: false,
      hostCallCounts: listCounters(0, 0),
    }),
    listStage("reorder", {
      before: ["alpha"],
      after: ["alpha"],
      diff: { kept: ["alpha"], released: [] },
      existingRowsMoved: 0,
      identityMeasured: true,
      keyedIdentityPreserved: true,
      elementOrderChanged: false,
      hostCallsDuring: { componentAtIndex: 0, enqueueComponent: 0 },
    }),
    listStage("shrunk", omit ? {} : {
      diff: { kept: [], released: ["alpha"] },
      releasedRows: ["alpha"],
      keptRows: [],
      hostRecycled: enqueue > 0,
      hostCallsDuring: { componentAtIndex: 0, enqueueComponent: enqueue },
      hostCallCounts: listCounters(0, enqueue),
    }),
    listStage("summary", {
      measured: ["what the host exposes"],
      unmeasured: [
        { operation: "recycling driven by a viewport", reason: "nothing here scrolls" },
      ],
      ...(omit ? {} : { hostCallCounts: listCounters(0, enqueue) }),
    }),
    listStage("done", { status: "all stages logged" }),
  ];
  const final = options.mutate ? options.mutate(stages) : stages;
  return capture(final.map(stage => line(LP, stage)));
}

/** The stage names a card actually emits, read out of its source. */
function emittedStages(sourcePath: string, builder: string): string[] {
  const source = readFileSync(sourcePath, "utf8");
  const pattern = new RegExp(`${builder}\\("([^"]+)"`, "g");
  return [...source.matchAll(pattern)].map(match => match[1]);
}

/* ------------------------------------------------------------------- the tests */

describe("verify-native-probe: the stylesheet card", () => {
  it("verifies a good capture and lists every required stage in card order", () => {
    const run = runVerifier(fixture("stylesheet-good.log"));

    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("verdict: verified");
    expect(run.stdout).toContain("6 required stage(s) present");

    const required = [
      "inventory",
      "no-arguments",
      "load-missing-url",
      "load-real-url",
      "summary",
      "done",
    ];
    for (const stage of required) {
      expect(run.stdout, `${stage} should be in the table`).toContain(`  ${stage} `);
    }
    const positions = required.map(stage => run.stdout.indexOf(`  ${stage} `));
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it("reports a capture that stops before the mutating stage", () => {
    const run = runVerifier(fixture("stylesheet-missing-stage.log"));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("verdict: findings");
    expect(run.stdout).toContain("[missing-stage]");
    expect(run.stdout).toContain("`load-real-url`");
    // Every stage it does hold is well formed, so the verdict must be about the
    // absence and nothing else.
    expect(run.stdout).toContain("1 problem(s)");
  });

  it("cannot evaluate a capture whose stage line was cut short", () => {
    const run = runVerifier(fixture("stylesheet-unparseable.log"));

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("does not parse");
    expect(run.stderr).toContain("truncated");
    expect(run.stdout).toContain("could not evaluate");
    expect(run.stdout).not.toContain("verdict: verified");
  });

  it("requires the load's missing URL to have failed and the real one to have returned", () => {
    // A capture where the "missing" load returned is not a failed load, and the
    // stage exists only because it cannot succeed.
    const swallowed = runVerifier(writeCapture(stylesheetCapture(stages =>
      stages.map(stage => stage.stage === "load-missing-url"
        ? stylesheetStage("load-missing-url", {
          operations: [loadOperation([{
            input: stylesheetCalls.missingUrl.input,
            returned: { kind: "undefined" },
          }])],
        })
        : stage))));

    expect(swallowed.status).toBe(1);
    expect(swallowed.stdout).toContain("[load-did-not-fail]");
    expect(swallowed.stdout).toContain("did not fail");
  });

  it("flags a mutating stage pointed at the same URL the failing stage used", () => {
    // The two stages exist to separate a URL that cannot resolve from one that
    // does; if they agree, the capture does not record that separation.
    const sameTarget = runVerifier(writeCapture(stylesheetCapture(stages =>
      stages.map(stage => stage.stage === "load-real-url"
        ? stylesheetStage("load-real-url", {
          operations: [loadOperation([{
            input: stylesheetCalls.missingUrl.input,
            returned: stylesheetCalls.realUrl.returned,
          }])],
        })
        : stage))));

    expect(sameTarget.status).toBe(1);
    expect(sameTarget.stdout).toContain("[same-target]");
  });

  it("flags a mutating stage that threw, because nothing reached the stylesheet", () => {
    const threw = runVerifier(writeCapture(stylesheetCapture(stages =>
      stages.map(stage => stage.stage === "load-real-url"
        ? stylesheetStage("load-real-url", {
          operations: [loadOperation([{
            input: stylesheetCalls.realUrl.input,
            threw: { name: "Error", message: "loadStyleSheet failed: 404" },
          }])],
        })
        : stage))));

    expect(threw.status).toBe(1);
    expect(threw.stdout).toContain("[load-real-url-threw]");
  });

  it("flags a summary that names nothing as unexercised", () => {
    // The card always emits `unmeasured`; an empty list is a capture that asserts
    // nothing, and a summary that asserts nothing cannot bound the claim. The
    // wording is never checked, only that there is something to read.
    const empty = runVerifier(writeCapture(stylesheetCapture(stages =>
      stages.map(stage => stage.stage === "summary"
        ? stylesheetStage("summary", { operations: [], unmeasured: [] })
        : stage))));

    expect(empty.status).toBe(1);
    expect(empty.stdout).toContain("[empty-unmeasured]");
  });

  it("reports a duplicated stage rather than treating the repeat as a second run", () => {
    const duplicated = runVerifier(writeCapture(stylesheetCapture(stages =>
      [...stages, stages[0]])));

    expect(duplicated.status).toBe(1);
    expect(duplicated.stdout).toContain("[duplicate-stage]");
    expect(duplicated.stdout).toContain("`inventory` appears on more than one line");
  });

  it("reports stages that arrive out of the card's order", () => {
    const reordered = runVerifier(writeCapture(stylesheetCapture(stages => {
      const copy = [...stages];
      [copy[2], copy[3]] = [copy[3], copy[2]];
      return copy;
    })));

    expect(reordered.status).toBe(1);
    expect(reordered.stdout).toContain("[out-of-order-stage]");
  });

  it("accepts a stage this checker does not know as an extra, not a finding", () => {
    // "At least the required set" is the rule: a card that logs a new stage must
    // still verify, or the checker becomes a reason not to improve the card.
    const run = runVerifier(writeCapture(stylesheetCapture(stages => [
      ...stages.slice(0, 4),
      stylesheetStage("adopt-attempt", { note: "a later card version" }),
      ...stages.slice(4),
    ])));

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("adopt-attempt");
    expect(run.stdout).toContain("extra");
  });
});

describe("verify-native-probe: arity is evidence, never a signature", () => {
  /**
   * The rule this suite exists to protect: `fn.length` is the parameter count a
   * binding reports, and a native binding can report any of them regardless of
   * what it requires. So an arity in a capture is checked only for being a
   * number, and no check turns it into an expected parameter count. The three
   * cases below are the whole of the arity contract.
   */
  it("verifies whatever arities the runtime reported, including ones that disagree with each other", () => {
    const run = runVerifier(writeCapture(stylesheetCapture(stages =>
      stages.map(stage => stage.stage === "inventory"
        ? stylesheetStage("inventory", {
          relatedGlobals: [],
          // The same binding, three different reported arities, none of them
          // "right" and none of them wrong: a capture records what the runtime
          // said, so all three verify.
          operations: STYLESHEET_PAPI_NAMES.map((name, index) => ({
            name,
            function: { typeof: "function", arity: index, name },
          })),
        })
        : stage))));

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("verdict: verified");
  });

  it("accepts a binding that reports no arity at all", () => {
    // A host-proxied binding can have no readable `length`. That is an absence in
    // the evidence, not a wrong answer, so it is not a finding.
    const run = runVerifier(writeCapture(stylesheetCapture(stages =>
      stages.map(stage => stage.stage === "inventory"
        ? stylesheetStage("inventory", {
          relatedGlobals: [],
          operations: STYLESHEET_PAPI_NAMES.map(name => ({
            name,
            function: { typeof: "function", name },
          })),
        })
        : stage))));

    expect(run.status).toBe(0);
  });

  it("flags an arity that is not a number, and says nothing about its value", () => {
    const run = runVerifier(writeCapture(stylesheetCapture(stages =>
      stages.map(stage => stage.stage === "inventory"
        ? stylesheetStage("inventory", {
          relatedGlobals: [],
          operations: STYLESHEET_PAPI_NAMES.map(name => ({
            name,
            function: { typeof: "function", arity: "two", name },
          })),
        })
        : stage))));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("[unreadable-arity]");
    expect(run.stdout).toContain("not a signature");
    // The finding is about the type, never about the count.
    expect(run.stdout).not.toContain("expected 2");
    expect(run.stdout).not.toContain("wrong arity");
  });

  it("tests its own source for the inference it forbids", () => {
    // A structural guard: the comment says the inference is forbidden, and this
    // asserts the code has no expected-arity comparison to grow into one.
    const source = readFileSync(SCRIPT, "utf8");
    expect(source).toContain("never a signature");
    expect(source).not.toMatch(/\.length\s*===\s*\d+\s*\)\s*\{\s*\/\/ arity/);
    expect(source).not.toMatch(/arity\s*[!=]==?\s*\d/);
  });
});

describe("verify-native-probe: the list card", () => {
  it("verifies a capture where the host did recycle", () => {
    const run = runVerifier(fixture("list-recycles.log"));

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("verdict: verified");
    expect(run.stdout).toContain("host recycled true");
    expect(run.stdout).toContain("enqueueComponent 2");
    expect(run.stdout).toContain("7 required stage(s) present");
  });

  it("verifies a capture where the host never recycled, because a zero is an answer", () => {
    // The case a naive checker gets wrong: "never asked" is a measurement, and
    // treating it as missing evidence would make the card unable to report the
    // most likely native result.
    const run = runVerifier(fixture("list-never-recycled.log"));

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("verdict: verified");
    expect(run.stdout).toContain("host recycled false");
    expect(run.stdout).toContain("enqueueComponent 0");
  });

  it("reports a capture that never answers whether enqueueComponent was called", () => {
    const run = runVerifier(fixture("list-no-answer.log"));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("verdict: findings");
    expect(run.stdout).toContain("[missing-recycling-answer]");
    expect(run.stdout).toContain("`summary` records no `hostCallCounts`");
    expect(run.stdout).toContain("A recorded 0 is an answer");
  });

  it("reports a shrunk stage that omits the recycling fields", () => {
    const run = runVerifier(writeCapture(listCapture({
      mutate: stages => stages.map(stage => stage.stage === "shrunk"
        ? listStage("shrunk", { diff: { kept: [], released: ["alpha"] } })
        : stage),
    })));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("`shrunk.hostRecycled` must be a boolean");
    expect(run.stdout).toContain("`shrunk.hostCallCounts` must be an object");
  });

  it("keeps 'the host asked' apart from 'the probe materialized'", () => {
    // Both halves have to be present: with only one, the capture cannot say
    // which of them produced the rows.
    const missingHostHalf = runVerifier(writeCapture(listCapture({
      mutate: stages => stages.map(stage => stage.stage === "materialize"
        ? listStage("materialize", {
          requested: [0],
          requestedCount: 1,
          materialized: 1,
          children: { count: 1 },
          rows: [],
          hostCallCounts: listCounters(0, 0),
        })
        : stage),
    })));

    expect(missingHostHalf.status).toBe(1);
    expect(missingHostHalf.stdout).toContain("`materialize.hostAskedOnItsOwn`");
    expect(missingHostHalf.stdout).toContain("must be a boolean");
  });

  it("flags a materialize stage whose derived claim contradicts its own fields", () => {
    const run = runVerifier(writeCapture(listCapture({
      mutate: stages => stages.map(stage => stage.stage === "materialize"
        ? listStage("materialize", {
          requested: [0],
          requestedCount: 1,
          materialized: 1,
          children: { count: 1 },
          rows: [],
          hostAskedAfterUpdate: false,
          hostAskedWhileMaterializing: false,
          hostAskedOnItsOwn: true,
          hostCallCounts: listCounters(0, 0),
        })
        : stage),
    })));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("[derived-field-mismatch]");
    expect(run.stdout).toContain("disagrees with its own fields");
  });

  it("accepts a host that did ask for its own rows", () => {
    // The other branch of the same field: `hostAskedOnItsOwn: true` with the two
    // inputs to match is a complete answer, not a finding.
    const run = runVerifier(writeCapture(listCapture({
      mutate: stages => stages.map(stage => stage.stage === "materialize"
        ? listStage("materialize", {
          requested: [0],
          requestedCount: 1,
          materialized: 1,
          children: { count: 1 },
          rows: [],
          hostAskedAfterUpdate: true,
          hostAskedWhileMaterializing: false,
          hostAskedOnItsOwn: true,
          hostCellIndices: [0],
          hostCallCounts: listCounters(1, 0),
        })
        : stage),
    })));

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("host asked on its own true");
  });

  it("reports a list capture that stops before the shrink stage", () => {
    const run = runVerifier(writeCapture(listCapture({
      mutate: stages => stages.filter(stage => stage.stage !== "shrunk"),
    })));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("[missing-stage]");
    expect(run.stdout).toContain("`shrunk`");
  });
});

describe("verify-native-probe: a capture holding more than one card", () => {
  it("evaluates both cards in one capture and reports each separately", () => {
    const run = runVerifier(writeCapture(
      stylesheetCapture() + listCapture({ enqueue: 1 }),
    ));

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("cards:      2 (stylesheet, list)");
    expect(run.stdout).toContain("card 1 of 2 — stylesheet");
    expect(run.stdout).toContain("card 2 of 2 — list");
    expect(run.stdout).toContain("13 required stage(s) present");
  });

  it("is a finding when either card in the capture is", () => {
    const run = runVerifier(writeCapture(
      stylesheetCapture()
        + listCapture({ omitRecyclingAnswer: true }),
    ));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("card 1 of 2");
    expect(run.stdout).toContain("[missing-recycling-answer]");
  });

  it("does not let one card's stages satisfy the other's", () => {
    // Both cards emit `inventory`, `summary`, and `done`. A checker that keyed
    // stages by name alone would let a stylesheet capture's summary stand in for
    // the list card's, and vice versa.
    const run = runVerifier(writeCapture(listCapture({
      mutate: stages => stages.filter(stage =>
        !["inventory", "summary", "done"].includes(String(stage.stage))),
    })));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("`inventory`");
    expect(run.stdout).toContain("`summary`");
    expect(run.stdout).toContain("`done`");
  });
});

describe("verify-native-probe: what it refuses to guess", () => {
  it("cannot evaluate a capture with no probe marker", () => {
    const run = runVerifier(writeCapture(
      "I lynx_console: [lynx] engine ready, background: false\n"
        + "I lynx_console: [solid-lynx native] card rendered into page with 1 child(ren)\n",
    ));

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("contains no [solid-lynx ss2], [solid-lynx ss], [solid-lynx lp] line");
    expect(run.stdout).toContain("could not evaluate");
  });

  it("cannot evaluate a zero-byte capture", () => {
    const run = runVerifier(writeCapture(""));

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("contains no [solid-lynx ss2], [solid-lynx ss], [solid-lynx lp]");
  });

  it("cannot evaluate a marker with no JSON after it", () => {
    const run = runVerifier(writeCapture(`I lynx_console: ${SS}\n`));

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("no JSON");
  });

  it("cannot evaluate JSON that parses but is not a stage", () => {
    const run = runVerifier(writeCapture(line(SS, { probe: "native-stylesheet-papi" })));

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("is not a probe stage");
  });

  it("cannot evaluate a capture path that does not exist", () => {
    const run = runVerifier(path.join(FIXTURES, "not-a-file.log"));

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("cannot read the capture");
    expect(run.stderr).toContain("Nothing was verified");
  });

  it("treats a missing argument as unusable rather than as a pass", () => {
    const run = runVerifier();

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("no capture file given");
  });

  it("refuses more than one capture at a time", () => {
    const run = runVerifier(fixture("stylesheet-good.log"), fixture("list-recycles.log"));

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("exactly one capture file");
  });

  it("reports a line whose marker and payload disagree about which card wrote it", () => {
    const run = runVerifier(writeCapture(
      stylesheetCapture() + line(SS, stylesheetStage("inventory", {
        probe: "native-list-papi",
        relatedGlobals: [],
        operations: [],
      })),
    ));

    // The extra line is a second `inventory`, so the duplicate is found first;
    // both findings are about the capture being inconsistent with itself.
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("[wrong-probe]");
  });

  it("documents its exit codes, its inputs, and the arity rule in --help", () => {
    const run = runVerifier("--help");

    expect(run.status).toBe(0);
    for (const phrase of [
      "0  verified",
      "1  findings",
      "2  could not evaluate",
      "dagr",
      "[solid-lynx ss]",
      "[solid-lynx lp]",
      "does not infer a signature",
      "verify-native-parity.mjs",
      "test/fixtures/native-probe/",
    ]) {
      expect(run.stdout).toContain(phrase);
    }
  });

  it("reads a text file and nothing else, so it can never need a device", () => {
    const source = readFileSync(SCRIPT, "utf8");
    const imports = [...source.matchAll(/^import .* from "([^"]+)";$/gm)]
      .map(match => match[1]);

    // Only the filesystem and a path helper. No process, no network, no adb, and
    // — unlike the parity verifier — no `dist/` to import, so a missing build
    // can never turn a probe capture into "could not evaluate".
    expect(imports.sort()).toEqual(["node:fs", "node:path"]);
    expect(source).not.toMatch(/\bchild_process\b/);
    expect(source).not.toMatch(/\bexecFile|\bspawn\(|\bfetch\(/);
  });
});

describe("verify-native-probe: the stage sets are the cards' own", () => {
  it("requires exactly the stylesheet stages stylesheet-probe.ts emits", () => {
    // Read out of the card, so a renamed or added stage fails here rather than
    // letting the checker drift into verifying a shape no card produces.
    const emitted = emittedStages(SS_SOURCE, "reportLine");

    expect(emitted).toEqual([
      "inventory",
      "no-arguments",
      "load-missing-url",
      "load-real-url",
      "summary",
      "done",
    ]);
  });

  it("requires exactly the list stages list-probe.ts emits", () => {
    const source = readFileSync(LP_SOURCE, "utf8");
    // `stage(name, ...)` is the card's own throwing-stage wrapper: a stage that
    // throws logs a line under the same name, so those names count too.
    const wrapped = [...source.matchAll(/\bstage\("([^"]+)"/g)].map(match => match[1]);
    const direct = emittedStages(LP_SOURCE, "listReportLine");
    const emitted = [...new Set([...direct, ...wrapped])];

    expect(emitted.sort()).toEqual([
      "create",
      "done",
      "inventory",
      "materialize",
      "reorder",
      "shrunk",
      "summary",
    ]);
  });

  it("names the bindings the recorders define, and no others", () => {
    const source = readFileSync(SCRIPT, "utf8");

    // The checker cannot import the cards at runtime — it is a standalone script
    // by design — so the literals are held to the recorders from here.
    for (const name of [...STYLESHEET_PAPI_NAMES, ...LIST_PAPI_NAMES]) {
      expect(source, `checker should name ${name}`).toContain(`"${name}"`);
    }
    expect(STYLESHEET_PAPI_NAMES).toEqual([
      "__LoadStyleSheet",
      "__AdoptStyleSheet",
      "__ReplaceStyleSheets",
    ]);
    expect(LIST_PAPI_NAMES).toEqual([
      "__CreateList",
      "__UpdateListCallbacks",
      "__UpdateListComponents",
      "__GetListComponents",
    ]);
  });
});

describe("verify-native-parity: unchanged by the probe checker", () => {
  /**
   * The parity verifier kept its own contract. These two cases are the reason the
   * probe checker is a sibling script rather than a `--probe` mode: the parity
   * verifier still exits 2 on a capture carrying only `[solid-lynx ss]` lines,
   * which is the behaviour ROADMAP 0.4 quoted when it said the probe was not
   * verified by a process.
   */
  it("still cannot evaluate a capture carrying only stylesheet stage lines", () => {
    const run = runParity(fixture("stylesheet-good.log"));

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("contains no [solid-lynx parity] line");
  });

  it("still cannot evaluate a capture carrying only list stage lines", () => {
    const run = runParity(fixture("list-recycles.log"));

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("contains no [solid-lynx parity] line");
  });

  it("has no probe option, so the mode did not quietly become the parity path", () => {
    const run = runParity("--probe", fixture("stylesheet-good.log"));

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("expected exactly one capture file");
  });
});

/* -------------------------------------------------------- the second card
 *
 * The v2 card answers a different question from the v1 one: it attempts a bounded
 * list of argument shapes and records each outcome. Its capture is therefore
 * judged on whether the list was really attempted and really recorded, never on
 * whether any case succeeded — an all-threw capture is the finding the card
 * exists to be able to report.
 */

describe("verify-native-probe: the stylesheet v2 card", () => {
  it("verifies a capture where all eight load cases failed, because that is an answer", () => {
    const run = runVerifier(fixture("stylesheet-v2-all-threw.log"));

    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("verdict: verified");
    expect(run.stdout).toContain("8 required stage(s) present");
    expect(run.stdout).toContain("stylesheet-v2");
    expect(run.stdout).toContain("8 attempt(s), 1 distinct answer(s)");
  });

  it("reports a v2 capture that stops before its bounded list", () => {
    const text = readFileSync(fixture("stylesheet-v2-all-threw.log"), "utf8");
    const truncated = text
      .split("\n")
      .filter(line => !line.includes('"stage":"loadstyle-arity"'))
      .join("\n");
    const run = runVerifier(writeCapture(truncated));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("[missing-stage]");
    expect(run.stdout).toContain("`loadstyle-arity`");
  });

  it("flags a bounded list that dropped cases, because it answers a narrower question", () => {
    const text = readFileSync(fixture("stylesheet-v2-all-threw.log"), "utf8");
    const rewritten = text.split("\n").map(line => {
      if (!line.includes('"stage":"loadstyle-arity"')) return line;
      const at = line.indexOf("[solid-lynx ss2] ");
      const payload = JSON.parse(line.slice(at + "[solid-lynx ss2] ".length));
      payload.attempts = payload.attempts.slice(0, 3);
      return line.slice(0, at) + "[solid-lynx ss2] " + JSON.stringify(payload);
    }).join("\n");

    const run = runVerifier(writeCapture(rewritten));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("[wrong-attempt-count]");
    expect(run.stdout).toContain("8");
  });

  it("flags a style-object path that called no setter and does not say why", () => {
    const text = readFileSync(fixture("stylesheet-v2-all-threw.log"), "utf8");
    const rewritten = text.split("\n").map(line => {
      if (!line.includes('"stage":"style-object-path"')) return line;
      const at = line.indexOf("[solid-lynx ss2] ");
      const payload = JSON.parse(line.slice(at + "[solid-lynx ss2] ".length));
      delete payload.followUpsSkipped;
      return line.slice(0, at) + "[solid-lynx ss2] " + JSON.stringify(payload);
    }).join("\n");

    const run = runVerifier(writeCapture(rewritten));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("called no setter and does not say why");
  });

  it("flags a capture that claims a stylesheet lifecycle it did not observe", () => {
    const text = readFileSync(fixture("stylesheet-v2-all-threw.log"), "utf8");
    const rewritten = text.split("\n").map(line => {
      if (!line.includes('"stage":"lifecycle"')) return line;
      const at = line.indexOf("[solid-lynx ss2] ");
      const payload = JSON.parse(line.slice(at + "[solid-lynx ss2] ".length));
      payload.claim = "the loaded stylesheet was applied to the card";
      return line.slice(0, at) + "[solid-lynx ss2] " + JSON.stringify(payload);
    }).join("\n");

    const run = runVerifier(writeCapture(rewritten));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("[lifecycle-claim]");
  });

  it("flags an interned error key the capture does not define", () => {
    // Interning keeps the stage line inside the size the console bridge delivers.
    // The cost is that the engine's words become a reference, so a reference that
    // does not resolve loses the message while the line still looks complete.
    const text = readFileSync(fixture("stylesheet-v2-all-threw.log"), "utf8");
    const rewritten = text.split("\n").map(line => {
      if (!line.includes('"stage":"loadstyle-arity"')) return line;
      const at = line.indexOf("[solid-lynx ss2] ");
      const payload = JSON.parse(line.slice(at + "[solid-lynx ss2] ".length));
      payload.attempts[0].threw.message = "e9";
      return line.slice(0, at) + "[solid-lynx ss2] " + JSON.stringify(payload);
    }).join("\n");

    const run = runVerifier(writeCapture(rewritten));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("[unresolved-error]");
  });

  it("flags a summary whose counters do not add up to the stages it summarises", () => {
    const text = readFileSync(fixture("stylesheet-v2-all-threw.log"), "utf8");
    const rewritten = text.split("\n").map(line => {
      if (!line.includes('"stage":"summary"')) return line;
      const at = line.indexOf("[solid-lynx ss2] ");
      const payload = JSON.parse(line.slice(at + "[solid-lynx ss2] ".length));
      payload.attemptsRecorded = payload.attemptsRecorded + 1;
      return line.slice(0, at) + "[solid-lynx ss2] " + JSON.stringify(payload);
    }).join("\n");

    const run = runVerifier(writeCapture(rewritten));

    expect(run.status).toBe(1);
    expect(run.stdout).toContain("[summary-does-not-add-up]");
  });

  it("keeps the two stylesheet cards from being read as each other", () => {
    // v1 and v2 markers are not prefixes of each other, so a v2 capture carries
    // no v1 stage and a v1 capture carries no v2 stage.
    const v2 = runVerifier(fixture("stylesheet-v2-all-threw.log"));
    expect(v2.stdout).not.toContain("card 1 of 1 — stylesheet —");

    const v1 = runVerifier(fixture("stylesheet-good.log"));
    expect(v1.stdout).toContain("card 1 of 1 — stylesheet —");
    expect(v1.stdout).not.toContain("stylesheet-v2");
  });

  it("requires the v2 stage set the v2 card actually emits", () => {
    const sourcePath = path.join(REPO_ROOT, "examples", "lynx-for-native", "src",
      "stylesheet-probe-v2.ts");
    // Two builders: the guarded `stage(name, …)` wrapper every measured stage goes
    // through, and the bare `v2ReportLine` call the card closes with.
    const wrapped = emittedStages(sourcePath, "stage");
    const direct = emittedStages(sourcePath, "v2ReportLine");

    expect([...wrapped, ...direct]).toEqual([
      "inventory-v2",
      "loadstyle-arity",
      "adopt-arity",
      "replace-arity",
      "style-object-path",
      "lifecycle",
      "summary",
      "done",
    ]);
  });

  it("holds the v2 attempt count to the card's own argument table", async () => {
    const { loadStyleSheetCases } = await import(
      "../examples/lynx-for-native/src/stylesheet-probe-v2-report.js"
    );
    const cases = loadStyleSheetCases("a.css", "b.css");

    const source = readFileSync(SCRIPT, "utf8");
    // The checker cannot import the card, so the literal it carries is held to
    // the card's own table here.
    expect(source).toContain(`const STYLESHEET_V2_LOAD_CASE_COUNT = ${cases.length};`);
  });
});
