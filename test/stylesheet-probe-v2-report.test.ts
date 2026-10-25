import { describe, expect, it } from "vitest";

import {
  STYLESHEET_V2_GLOBALS,
  STYLESHEET_V2_MARKER,
  STYLESHEET_V2_PROBE,
  STYLESHEET_V2_READBACK_GLOBALS,
  STYLESHEET_V2_STAGES,
  adoptStyleSheetCases,
  captureHandles,
  describeGlobal,
  LOAD_STAGE_BYTES,
  describeGlobalInventory,
  firstArrayHandle,
  fitToBudget,
  internError,
  firstHandle,
  groupOutcomes,
  isOpaqueHandle,
  loadStyleSheetCases,
  replaceStyleSheetsCases,
  runCases,
  styleGlobalNames,
  v2ReportLine,
} from "../examples/lynx-for-native/src/stylesheet-probe-v2-report.js";

/**
 * The device run is the real evidence. These tests cover the recorder and the
 * argument tables, because two failures there would silently destroy a capture:
 * a recorder that throws on a native value kills the card and loses every earlier
 * stage, and an argument table that quietly drops a case answers a narrower
 * question than the card claims.
 */

/** Named so `String(fn)` and `fn.name` are what a reader expects. */
function __LoadStyleSheet(url: string, format: string) {
  return [url, format];
}

/** One shared function, so four globals intern to a single source string. */
function notNative() {
  return undefined;
}

function firstBinding() {
  return 1;
}

function secondBinding() {
  return 2;
}

const URL_1 = "http://127.0.0.1:8099/probe.css";
const URL_2 = "http://127.0.0.1:8099/probe-2.css";

describe("stylesheet probe v2: the bounded argument lists", () => {
  it("attempts exactly the eight __LoadStyleSheet cases, in order", () => {
    const cases = loadStyleSheetCases(URL_1, URL_2);

    expect(cases).toHaveLength(8);
    expect(cases.map(one => one.args.length)).toEqual([1, 2, 2, 2, 2, 2, 2, 2]);

    // The first case is the one v1 already measured as throwing: it is the
    // control, so the capture can say whether the engine still behaves the same.
    expect(cases[0].args).toEqual([URL_1]);
    expect(cases[1].args).toEqual([URL_1, null]);
    expect(cases[2].args).toEqual([URL_1, 0]);
    expect(cases[3].args).toEqual([URL_1, {}]);
    expect(cases[4].args).toEqual([URL_1, "utf-8"]);
    // The function case is checked by type below; its identity is fresh per call.
    expect(typeof cases[5].args[1]).toBe("function");
    expect(cases[6].args).toEqual([URL_1, []]);
    expect(cases[7].args).toEqual([URL_1, URL_2]);

    // Labels stay short because the line budget is shared by all eight attempts.
    // Each one still names its own argument list.
    expect(cases.map(one => one.label)).toEqual([
      "[url]",
      "[url, null]",
      "[url, 0]",
      "[url, {}]",
      "[url, \"utf-8\"]",
      "[url, function(){}]",
      "[url, []]",
      "[url, url2]",
    ]);
  });

  it("distinguishes a function second parameter from every other object", () => {
    const cases = loadStyleSheetCases(URL_1, URL_2);
    const fnCase = cases.find(one => typeof one.args[1] === "function");
    expect(fnCase).toBeDefined();
    expect(fnCase?.args[0]).toBe(URL_1);
    // A fresh function per call list: a binding that compared its second
    // argument against a previous one must not see the same object twice.
    const again = loadStyleSheetCases(URL_1, URL_2);
    const againFn = again.find(one => typeof one.args[1] === "function");
    expect(againFn?.args[1]).not.toBe(fnCase?.args[1]);
  });

  it("gives each object case its own fresh object", () => {
    const first = loadStyleSheetCases(URL_1, URL_2);
    const second = loadStyleSheetCases(URL_1, URL_2);
    expect(first[3].args[1]).not.toBe(second[3].args[1]);
    expect(first[5].args[1]).not.toBe(second[5].args[1]);
  });

  it("uses a different URL for the second-URL case, so it is not the same test twice", () => {
    const [, , , , , , , last] = loadStyleSheetCases(URL_1, URL_2);
    expect(last.args[0]).toBe(URL_1);
    expect(last.args[1]).toBe(URL_2);
    expect(last.args[1]).not.toBe(last.args[0]);
  });

  it("attempts the adopt and replace cases, including the ones v1 skipped", () => {
    expect(adoptStyleSheetCases().map(one => one.args.length)).toEqual([0, 1, 1]);
    // The handle case exists only when the card has a real handle.
    const withHandle = adoptStyleSheetCases({ handle: true });
    expect(withHandle).toHaveLength(4);
    expect(withHandle[3].args).toHaveLength(1);

    expect(replaceStyleSheetsCases().map(one => one.args.length)).toEqual([0, 1, 1]);
    // v1 measured "no arguments" returning null; "an empty array" is a different
    // contract and is a separate case here.
    expect(replaceStyleSheetsCases()[0].args).toEqual([]);
    expect(replaceStyleSheetsCases()[2].args).toEqual([[]]);
    expect(replaceStyleSheetsCases().map(one => one.label)).toEqual(["[]", "[null]", "[[]]"]);
    expect(replaceStyleSheetsCases(["a"])).toHaveLength(4);
  });

  it("labels every case distinctly, because the label is what identifies an attempt", () => {
    for (const cases of [
      loadStyleSheetCases(URL_1, URL_2),
      adoptStyleSheetCases({}),
      replaceStyleSheetsCases([]),
    ]) {
      const labels = cases.map(one => one.label);
      expect(new Set(labels).size).toBe(labels.length);
      expect(labels.every(label => label.trim() !== "")).toBe(true);
    }
  });
});

describe("stylesheet probe v2: running a bounded list", () => {
  it("records a throw and a return without letting either end the list", () => {
    const calls: unknown[][] = [];
    const fn = (...args: unknown[]) => {
      calls.push(args);
      if (args.length < 2) throw new Error("param size should >= 2");
      return { sheet: args[0] };
    };

    const run = runCases(fn, loadStyleSheetCases(URL_1, URL_2));

    expect(run.attempts).toHaveLength(8);
    // Every case reached the binding, including the seven after the first one threw.
    expect(calls).toHaveLength(8);
    expect(run.attempts[0].outcome).toBe("threw");
    expect(run.attempts[0].call.threw?.message).toBe("param size should >= 2");
    expect(run.attempts[1].outcome).toBe("returned");
    expect(run.attempts[1].call.returned?.kind).toBe("object");
  });

  it("calls the binding exactly once per case, not twice to recover a handle", () => {
    let count = 0;
    const fn = () => {
      count += 1;
      return {};
    };
    runCases(fn, [
      { label: "once", args: [] },
      { label: "twice", args: [] },
    ]);
    expect(count).toBe(2);
  });

  it("keeps the handle a case returned and offers nothing for a case that threw", () => {
    const fn = (...args: unknown[]) => {
      if (args.length === 0) return { opaque: true };
      throw new Error("nope");
    };

    const run = runCases(fn, [
      { label: "returns a handle", args: [] },
      { label: "throws", args: [1] },
    ]);

    expect(run.handles).toHaveLength(1);
    expect(run.handles[0].label).toBe("returns a handle");
    expect(run.handles[0].value).toBe(run.raw[0]);
    expect(run.raw[1]).toBeUndefined();
  });

  it("does not offer a primitive or null as a handle", () => {
    const run = runCases((...args: unknown[]) => args.length, [
      { label: "number", args: [] },
      { label: "null", args: [] },
    ]);
    // `undefined` and numbers are not opaque handles even though the calls
    // returned; treating one as a handle would be the fabrication the card refuses.
    expect(run.attempts.every(one => one.outcome === "returned")).toBe(true);
    expect(run.handles).toEqual([]);
  });

  it("survives a binding that is not a function at all", () => {
    const run = runCases(undefined, [{ label: "no binding", args: [1] }]);
    expect(run.attempts[0].outcome).toBe("threw");
    expect(run.attempts[0].call.threw?.message).toBe("not a function");
    expect(run.handles).toEqual([]);
  });

  it("describes what it passed, so a capture says which shapes were tried", () => {
    const run = runCases(() => undefined, loadStyleSheetCases(URL_1, URL_2));
    expect(run.attempts[0].args).toEqual([{ kind: "string", value: URL_1 }]);
    expect(run.attempts[1].args[1]).toEqual({ kind: "null" });
    expect(run.attempts[7].args[1]).toEqual({ kind: "string", value: URL_2 });
  });
});

describe("stylesheet probe v2: reading the outcomes back", () => {
  it("groups identical answers, so an all-threw run is visible at a glance", () => {
    const fn = () => {
      throw new Error("param size should >= 2");
    };
    const groups = groupOutcomes(runCases(fn, loadStyleSheetCases(URL_1, URL_2)).attempts);

    expect(groups).toHaveLength(1);
    expect(groups[0].outcome).toBe("threw");
    expect(groups[0].detail).toBe("param size should >= 2");
    expect(groups[0].labels).toHaveLength(8);
  });

  it("groups different answers apart, so a separation is not hidden", () => {
    const fn = (...args: unknown[]) => {
      if (args.length < 2) throw new Error("needs two");
      return { sheet: args[0] };
    };
    const groups = groupOutcomes(runCases(fn, loadStyleSheetCases(URL_1, URL_2)).attempts);

    expect(groups.map(group => group.outcome)).toEqual(["threw", "returned"]);
    expect(groups[1].detail).toBe("object");
    expect(groups[1].labels).toHaveLength(7);
  });

  it("picks the first handle, and the first array-shaped handle, without inventing one", () => {
    expect(firstHandle([])).toBeUndefined();
    expect(firstArrayHandle([{ label: "object", value: {} }])).toBeUndefined();

    const object = {};
    const list = ["a"];
    const handles = [{ label: "object", value: object }, { label: "list", value: list }];
    expect(firstHandle(handles)).toBe(object);
    expect(firstArrayHandle(handles)).toBe(list);
  });

  it("decides what may be passed back as a handle without calling anything", () => {
    expect(isOpaqueHandle({})).toBe(true);
    expect(isOpaqueHandle(() => undefined)).toBe(true);
    expect(isOpaqueHandle(null)).toBe(false);
    expect(isOpaqueHandle(undefined)).toBe(false);
    expect(isOpaqueHandle(0)).toBe(false);
    expect(isOpaqueHandle("css")).toBe(false);
    expect(isOpaqueHandle([])).toBe(true);
  });
});

describe("stylesheet probe v2: describing the globals", () => {
  it("finds style-named globals and always includes the fourteen v1 recorded", () => {
    const names = styleGlobalNames({ __LoadStyleSheet: () => undefined, other: 1 });

    for (const known of STYLESHEET_V2_GLOBALS) {
      expect(names).toContain(known);
    }
    expect(names).toContain("__LoadStyleSheet");
    expect(names).not.toContain("other");
    // Sorted, so two captures of the same host compare line for line.
    expect(names).toEqual([...names].sort());
  });

  it("does not throw when the scope cannot be enumerated", () => {
    const hostile = new Proxy({}, {
      ownKeys() {
        throw new Error("no own keys");
      },
    });
    // The known names still come back: the fallback list is not conditional on
    // being able to read the scope.
    expect(styleGlobalNames(hostile)).toEqual([...STYLESHEET_V2_GLOBALS].sort());
  });

  it("records typeof and arity without turning the arity into a signature", () => {
    const sources: Record<string, string> = {};
    const declared = __LoadStyleSheet;
    const described = describeGlobal("__LoadStyleSheet", declared, sources);

    expect(described.typeof).toBe("function");
    // Declared parameter count, recorded as evidence about the binding.
    expect(described.arity).toBe(2);
    // The name and own-property set are interned into `shapes`, not written per
    // global: fourteen copies of them is what puts the line over budget.
    expect(described.shape).toBe("p0");
    expect(sources.__shape).toBeUndefined();
    // Interning happens for any function, hostile native bindings included.
    expect(Object.values(sources)).toEqual([String(declared)]);
  });

  it("describes a non-function by its typeof and nothing else", () => {
    const described = describeGlobal("__SetParsedStyles", 7, {});
    expect(described).toEqual({ name: "__SetParsedStyles", typeof: "number" });
  });

  it("interns identical source text so the inventory line stays small", () => {
    const inventory = describeGlobalInventory({
      __LoadStyleSheet: notNative,
      __AdoptStyleSheet: notNative,
      __CreateStyleObject: notNative,
      __SetParsedStyles: notNative,
    });

    expect(Object.keys(inventory.sources)).toHaveLength(1);
    const functions = inventory.globals.filter(entry => entry.typeof === "function");
    expect(functions).toHaveLength(4);
    for (const entry of functions) {
      expect(entry.source).toBe("s0");
    }
  });

  it("keeps distinct source text apart", () => {
    const inventory = describeGlobalInventory({
      __LoadStyleSheet: firstBinding,
      __CreateStyleObject: secondBinding,
    });
    expect(Object.keys(inventory.sources)).toHaveLength(2);
    const keys = inventory.globals
      .filter(entry => entry.name === "__LoadStyleSheet" || entry.name === "__CreateStyleObject")
      .map(entry => entry.source);
    expect(new Set(keys).size).toBe(2);
  });

  it("describes every global even when one of them throws when read", () => {
    const scope = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(scope, "__LoadStyleSheet", {
      enumerable: true,
      get() {
        throw new Error("cannot read this binding");
      },
    });
    scope.__CreateStyleObject = () => undefined;

    // Reading the throwing global is the recorder's problem, not the card's: the
    // inventory describes what it can and never propagates the throw, and the
    // binding it could not read is recorded as evidence rather than omitted.
    const inventory = describeGlobalInventory(scope);
    expect(inventory.globals.some(entry => entry.name === "__CreateStyleObject")).toBe(true);

    const unreadable = inventory.globals.find(entry => entry.name === "__LoadStyleSheet");
    expect(unreadable?.typeof).toBe("unreadable");
    expect(unreadable?.error).toContain("cannot read this binding");
  });

  it("names only read-only bindings for the lifecycle readback", () => {
    for (const name of STYLESHEET_V2_READBACK_GLOBALS) {
      // A setter in this list would let the lifecycle stage write to the card
      // after every other stage had collected its evidence.
      expect(name.startsWith("__Get")).toBe(true);
    }
  });
});

describe("stylesheet probe v2: the delivered-line budget", () => {
  it("keeps the stage that holds every case under the delivered-line budget", () => {
    // v1's capture contains a complete, parseable 2,040-byte line and nothing
    // longer, so that is the largest line the bridge is known to deliver.
    expect(LOAD_STAGE_BYTES).toBe(2040);

    const message = "\nerror code: 111101\nerror message: LoadStyleSheet param size should >= 2";
    const run = runCases(() => {
      throw new Error(message);
    }, loadStyleSheetCases(URL_1, URL_2));

    const errors: Record<string, string> = {};
    const candidates = [
      {
        form: "full",
        payload: {
          attempts: run.attempts.map(one => ({
            label: one.label,
            args: one.args,
            outcome: one.outcome,
            threw: { name: "Error", message: internError(errors, message) },
          })),
          errors,
        },
      },
    ];

    const fitted = fitToBudget("loadstyle-arity", candidates);
    expect(fitted.form).toBe("full");
    expect(fitted.bytes).toBeLessThanOrEqual(LOAD_STAGE_BYTES);
  });

  it("falls through to the leanest form when the host returns distinct long errors", () => {
    // The case interning cannot save: eight different messages, each long enough
    // that even the full payload cannot fit. The ladder must still produce a line
    // that fits rather than one that may arrive truncated.
    const long = (index: number) =>
      `\nerror code: 111101\nerror message: LoadStyleSheet case ${index}: param size`
      + " should >= 2 and the handle must be owned by this instance";

    const errors: Record<string, string> = {};
    const attempts = loadStyleSheetCases(URL_1, URL_2).map((one, index) => ({
      label: one.label,
      args: one.args,
      outcome: "threw" as const,
      threw: { name: "Error", message: internError(errors, long(index)) },
    }));

    const fitted = fitToBudget("loadstyle-arity", [
      { form: "full", payload: { attempts, errors, groups: [{ detail: "e0", labels: [] }] } },
      {
        form: "terse",
        payload: {
          attempts: attempts.map(({ args: _args, ...rest }) => rest),
          errors,
          groups: [{ detail: "e0", labels: [] }],
          argumentsOmitted: attempts.map(one => one.label),
        },
      },
      {
        form: "lean",
        payload: {
          attempts: attempts.map(({ args: _args, ...rest }) => rest),
          errors,
          argumentsOmitted: attempts.map(one => one.label),
        },
      },
    ]);

    expect(fitted.bytes).toBeLessThanOrEqual(LOAD_STAGE_BYTES);
    // Whichever rung fits, it is never the full form and it says which one it is:
    // the arguments were dropped because the labels already name them.
    expect(["terse", "lean"]).toContain(fitted.form);
    expect(fitted.payload.fitForm).toBe(fitted.form);
    expect(fitted.payload.argumentsOmitted).toHaveLength(8);
    // Every attempt survives, so the capture still says all eight were tried.
    expect((fitted.payload.attempts as unknown[]).length).toBe(8);
  });

  it("says so explicitly when nothing fits, rather than emitting a line that may truncate", () => {
    const huge = "x".repeat(LOAD_STAGE_BYTES * 2);
    const fitted = fitToBudget("loadstyle-arity", [
      { form: "full", payload: { detail: huge } },
    ]);

    expect(fitted.form).toBe("over-budget");
    expect(fitted.payload.overBudget).toBe(true);
  });

  it("reports the chosen form only when it is not the full one", () => {
    const short = fitToBudget("loadstyle-arity", [
      { form: "full", payload: { detail: "ok" } },
      { form: "terse", payload: { detail: "ok" } },
    ]);
    expect(short.form).toBe("full");
    expect(short.payload.fitForm).toBeUndefined();

    const narrow = fitToBudget("loadstyle-arity", [
      { form: "full", payload: { detail: "x".repeat(LOAD_STAGE_BYTES) } },
      { form: "lean", payload: { detail: "ok" } },
    ]);
    expect(narrow.form).toBe("lean");
    expect(narrow.payload.fitForm).toBe("lean");
  });
});

describe("stylesheet probe v2: interning error text", () => {
  it("writes an identical message once and reuses its key", () => {
    const errors: Record<string, string> = {};
    expect(internError(errors, "boom")).toBe("e0");
    expect(internError(errors, "boom")).toBe("e0");
    expect(internError(errors, "other")).toBe("e1");
    expect(Object.keys(errors)).toEqual(["e0", "e1"]);
  });

  it("keeps the message verbatim, including its newlines", () => {
    const errors: Record<string, string> = {};
    const message = "\nerror code: 111101\nerror message: LoadStyleSheet param size should >= 2";
    const key = internError(errors, message);
    expect(errors[key]).toBe(message);
  });
});

describe("stylesheet probe v2: the capture line", () => {
  it("emits one line per stage, with its own marker and probe name", () => {
    const line = v2ReportLine("inventory-v2", { globals: [] });

    expect(line.startsWith(`${STYLESHEET_V2_MARKER} `)).toBe(true);
    expect(line).not.toContain("\n");
    expect(JSON.parse(line.slice(STYLESHEET_V2_MARKER.length + 1))).toEqual({
      probe: STYLESHEET_V2_PROBE,
      stage: "inventory-v2",
      globals: [],
    });
  });

  it("uses a marker no other card's capture can be mistaken for", () => {
    // Deliberately not a prefix of, or prefixed by, the v1 marker: a capture from
    // one card must never be extractable as the other card's stages.
    expect(STYLESHEET_V2_MARKER).not.toBe("[solid-lynx ss]");
    expect(STYLESHEET_V2_MARKER.startsWith("[solid-lynx ss]")).toBe(false);
    expect("[solid-lynx ss]".startsWith(STYLESHEET_V2_MARKER)).toBe(false);
  });

  it("lists the stages in the order the card emits them", () => {
    expect(STYLESHEET_V2_STAGES).toEqual([
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
});
