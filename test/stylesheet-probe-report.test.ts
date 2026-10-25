import { describe, expect, it } from "vitest";

import {
  STYLESHEET_PAPI_NAMES,
  describeFunction,
  describeValue,
  findStyleRelatedGlobals,
  loadRealUrlCases,
  reportLine,
  safeCall,
} from "../examples/lynx-for-native/src/stylesheet-probe-report.js";

/**
 * The device run is the real evidence. These tests cover the recorder, because a
 * recorder that throws on some native value would kill the probe card and lose
 * whatever it had already measured.
 */
describe("native stylesheet probe recorder", () => {
  it("records the three probed operations", () => {
    expect(STYLESHEET_PAPI_NAMES).toEqual([
      "__LoadStyleSheet",
      "__AdoptStyleSheet",
      "__ReplaceStyleSheets",
    ]);
  });

  it("describes callability without interpreting a name", () => {
    expect(describeFunction(undefined)).toEqual({ typeof: "undefined" });
    expect(describeFunction({})).toEqual({ typeof: "object" });
    expect(describeFunction("nope")).toEqual({ typeof: "string" });

    const fn = function __LoadStyleSheet(url: string, id: number) { return url; };
    const described = describeFunction(fn);
    expect(described.typeof).toBe("function");
    // Declared parameter count, recorded as evidence about the binding.
    expect(described.arity).toBe(2);
    expect(described.name).toBe("__LoadStyleSheet");
    expect(described.source).toContain("__LoadStyleSheet");
  });

  it("describes values without throwing on opaque or hostile handles", () => {
    expect(describeValue(undefined)).toEqual({ kind: "undefined" });
    expect(describeValue(null)).toEqual({ kind: "null" });
    expect(describeValue(7)).toEqual({ kind: "number", value: 7 });
    expect(describeValue("css")).toEqual({ kind: "string", value: "css" });

    // A native handle whose property access throws must still be described.
    const hostile = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(hostile, "boom", {
      enumerable: true,
      get() {
        throw new Error("no such property");
      },
    });
    const described = describeValue(hostile);
    expect(described.kind).toBe("object");
    expect(described.tag).toContain("Object");

    const unprintable = { get toStringTag() { throw new Error("nope"); } };
    expect(describeValue(unprintable).kind).toBe("object");
  });

  it("records both a returned value and a throw", () => {
    expect(safeCall(() => "sheet", []).returned).toEqual({ kind: "string", value: "sheet" });

    const threw = safeCall(() => {
      throw new TypeError("__LoadStyleSheet: missing argument");
    }, []);
    expect(threw.threw).toEqual({
      name: "TypeError",
      message: "__LoadStyleSheet: missing argument",
    });
    expect(threw.returned).toBeUndefined();

    // A non-callable binding is an outcome too, not a reason to stop the probe.
    expect(safeCall(undefined, []).threw?.message).toBe("not a function");
  });

  it("records what was passed as well as what came back", () => {
    const call = safeCall((...args: unknown[]) => args.length, ["a.css", 2]);
    expect(call.input).toHaveLength(2);
    expect(call.input[0]).toEqual({ kind: "string", value: "a.css" });
    expect(call.input[1]).toEqual({ kind: "number", value: 2 });
    expect(call.returned).toEqual({ kind: "number", value: 2 });
  });

  it("finds style-related globals and ignores the rest", () => {
    const scope = {
      __LoadStyleSheet: () => undefined,
      __SetInlineStyles: () => undefined,
      __CreatePage: () => undefined,
      unrelated: 1,
    };
    expect(findStyleRelatedGlobals(scope)).toEqual([
      "__LoadStyleSheet",
      "__SetInlineStyles",
    ]);
  });

  it("emits one line per stage, because the native console drops the rest", () => {
    const line = reportLine("inventory", { operations: [] });
    expect(line.startsWith("[solid-lynx ss] ")).toBe(true);
    expect(line).not.toContain("\n");
    expect(JSON.parse(line.slice("[solid-lynx ss] ".length))).toEqual({
      probe: "native-stylesheet-papi",
      stage: "inventory",
      operations: [],
    });
  });
});

/**
 * The two loads the `load-real-url` stage makes, and their order.
 *
 * This is the fix for the one defect a real capture found: v1 called
 * `__LoadStyleSheet(url)` with one argument, the engine threw "LoadStyleSheet
 * param size should >= 2", and the stage therefore never recorded a load that
 * reached the served stylesheet. The v2 card then measured what the second
 * parameter is, and these tests pin the resulting contract on the v1 card:
 *
 *   [url]            -> threw   (the measured negative result, kept as evidence)
 *   [url, "utf-8"]   -> returned (the load, and the *last* call in the stage)
 *
 * The order is asserted, not just the set: `scripts/verify-native-probe.mjs`
 * judges `load-real-url` on the last call recorded on the operation, because the
 * card's calls accumulate across stages. A stage that made the two-argument call
 * first and the one-argument call second would fail the verifier — correctly,
 * since its last call would be the rejected one.
 */
describe("native stylesheet probe real load", () => {
  const URL = "http://127.0.0.1:8099/probe.css";

  /** The measured engine: one argument throws, two with a String returns null. */
  const measuredEngine = () => (...args: unknown[]): unknown => {
    if (args.length < 2) throw new Error("LoadStyleSheet param size should >= 2");
    if (typeof args[1] !== "string") throw new Error("LoadStyleSheet param 1 should be String");
    return null;
  };

  it("records the one-argument attempt first, as a measured negative result", () => {
    const { calls, cases } = loadRealUrlCases(measuredEngine(), URL, "utf-8");

    expect(calls).toHaveLength(2);
    expect(cases.map(entry => entry.label)).toEqual(["[url]", "[url, \"utf-8\"]"]);
    expect(cases.map(entry => entry.outcome)).toEqual(["threw", "returned"]);

    // The engine's own words, recorded rather than summarised.
    expect(cases[0]?.threw?.message).toContain("param size should >= 2");
    expect(calls[0]?.input).toHaveLength(1);
    expect(calls[0]?.input[0]).toEqual({ kind: "string", value: URL });
  });

  it("records the two-argument load last, and that it did not throw", () => {
    const { calls, cases } = loadRealUrlCases(measuredEngine(), URL, "utf-8");

    // The verifier reads the last call, so this is the load-bearing assertion.
    const last = calls[calls.length - 1];
    expect(last?.threw).toBeUndefined();
    expect(last?.returned).toEqual({ kind: "null" });
    expect(last?.input).toEqual([
      { kind: "string", value: URL },
      { kind: "string", value: "utf-8" },
    ]);

    // No handle either way: `null` is not an ownership contract.
    expect(cases[1]?.returned?.kind).toBe("null");
    expect(cases[1]?.threw).toBeUndefined();
  });

  it("records a rejected second argument instead of pretending it worked", () => {
    // A host that requires a String there must show up as a throw in the second
    // case, with the first case's outcome unchanged.
    const strictEngine = (...args: unknown[]): unknown => {
      if (args.length < 2) throw new Error("LoadStyleSheet param size should >= 2");
      throw new Error("LoadStyleSheet param 1 should be String");
    };
    const { cases } = loadRealUrlCases(strictEngine, URL, "utf-8");
    expect(cases.map(entry => entry.outcome)).toEqual(["threw", "threw"]);
    expect(cases[1]?.threw?.message).toContain("param 1 should be String");
  });

  it("records a missing binding as a throw, not as a reason to skip the stage", () => {
    const { cases } = loadRealUrlCases(undefined, URL, "utf-8");
    expect(cases.map(entry => entry.outcome)).toEqual(["threw", "threw"]);
    for (const entry of cases) expect(entry.threw?.message).toBe("not a function");
  });

  it("serializes both cases onto the stage line the verifier reads", () => {
    const { calls, cases } = loadRealUrlCases(measuredEngine(), URL, "utf-8");
    const line = reportLine("load-real-url", {
      url: URL,
      encoding: "utf-8",
      operations: [{ name: "__LoadStyleSheet", function: describeFunction(undefined), calls }],
      cases,
    });

    expect(line.startsWith("[solid-lynx ss] ")).toBe(true);
    expect(line).not.toContain("\n");

    const parsed = JSON.parse(line.slice("[solid-lynx ss] ".length)) as {
      stage: string;
      operations: { name: string; calls: { input: unknown[]; threw?: unknown }[] }[];
      cases: { label: string; outcome: string }[];
    };
    expect(parsed.stage).toBe("load-real-url");
    expect(parsed.cases.map(entry => entry.label)).toEqual(["[url]", "[url, \"utf-8\"]"]);

    const lastCall = parsed.operations[0]?.calls.at(-1);
    expect(lastCall?.threw).toBeUndefined();
    expect(lastCall?.input).toHaveLength(2);
  });

  it("keeps the stage inside the line the console bridge delivers intact", () => {
    // The bridge delivered a 2,040-byte line intact and truncated longer ones, so
    // this stage — which carries two calls and their argument descriptions — is
    // measured against that, with the engine's error text in the first case.
    const { calls, cases } = loadRealUrlCases(measuredEngine(), URL, "utf-8");
    const line = reportLine("load-real-url", {
      url: URL,
      encoding: "utf-8",
      operations: [{ name: "__LoadStyleSheet", function: describeFunction(undefined), calls }],
      cases,
    });
    expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(2040);
  });
});