import { describe, expect, it } from "vitest";

import {
  STYLESHEET_PAPI_NAMES,
  describeFunction,
  describeValue,
  findStyleRelatedGlobals,
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