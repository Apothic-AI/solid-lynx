import { describe, expect, it } from "vitest";

import {
  LIST_PAPI_NAMES,
  childIds,
  countChildren,
  describeKey,
  describeListInventory,
  diffSnapshots,
  findListRelatedGlobals,
  keyOrder,
  listReportLine,
  observeRows,
  safeTypeof,
  walkChildren,
} from "../examples/lynx-for-native/src/list-probe-report.js";

/**
 * The device run is the real evidence. These tests cover the recorder, because a
 * recorder that throws on some native value would kill the probe card and lose
 * whatever it had already measured.
 */
describe("native list probe recorder", () => {
  it("names the four list operations it inventories", () => {
    expect(LIST_PAPI_NAMES).toEqual([
      "__CreateList",
      "__UpdateListCallbacks",
      "__UpdateListComponents",
      "__GetListComponents",
    ]);
  });

  it("reports the raw typeof, including the native 'unknown' handle case", () => {
    // Recorded rather than interpreted: a PrimJS element handle reports
    // "unknown" and is still a usable handle.
    expect(safeTypeof(undefined)).toBe("undefined");
    expect(safeTypeof({})).toBe("object");
    expect(safeTypeof(() => undefined)).toBe("function");
    expect(safeTypeof("handle")).toBe("string");
  });

  it("finds list-related globals and ignores the rest", () => {
    const scope = {
      __CreateList: () => undefined,
      __GetListComponents: () => undefined,
      __CreatePage: () => undefined,
      unrelated: 1,
    };
    expect(findListRelatedGlobals(scope)).toEqual([
      "__CreateList",
      "__GetListComponents",
    ]);
  });

  it("emits one line per stage, because the native console drops the rest", () => {
    const line = listReportLine("inventory", { relatedGlobals: [] });
    expect(line.startsWith("[solid-lynx lp] ")).toBe(true);
    expect(line).not.toContain("\n");
    expect(JSON.parse(line.slice("[solid-lynx lp] ".length))).toEqual({
      probe: "native-list-papi",
      stage: "inventory",
      relatedGlobals: [],
    });
  });
});

/**
 * The `inventory` stage has to be able to say *which* binding it is describing.
 *
 * These tests exist because a real capture could not: both native bindings
 * report `fn.name === ""`, and the card spread that over the name it had built
 * the row from, so two operations arrived nameless. The verifier was right to
 * call it a finding — an inventory that cannot name the missing binding is not
 * evidence — so the rule is asserted here on both sides of the fix: the name the
 * probe asked about survives, and the name the runtime reports is still recorded
 * separately rather than dropped.
 */
describe("native list probe inventory", () => {
  /** What a native binding looked like in the real capture, byte-shape included. */
  const nativeBinding = () => {
    // `function () { [native code] }` reports arity 3 and an empty name.
    const fn = function () {
      return undefined;
    };
    Object.defineProperty(fn, "length", { value: 3 });
    Object.defineProperty(fn, "name", { value: "" });
    return fn;
  };

  it("names every probed binding, including the ones the host lacks", () => {
    // The measured engine's shape: two present bindings that report no own name
    // and two globals that do not exist at all.
    const scope = {
      __CreateList: nativeBinding(),
      __UpdateListCallbacks: nativeBinding(),
    };

    const entries = describeListInventory(scope);

    expect(entries).toHaveLength(LIST_PAPI_NAMES.length);
    for (const entry of entries) {
      expect(typeof entry.name).toBe("string");
      expect(entry.name).not.toBe("");
    }
    expect(entries.map(entry => entry.name)).toEqual([...LIST_PAPI_NAMES]);

    // The absent ones are present in the report, named, and marked undefined —
    // "asked and not there" is an answer, not an omission.
    const absent = entries.filter(entry => entry.enumeratedAs === "absent");
    expect(absent.map(entry => entry.name)).toEqual([
      "__UpdateListComponents",
      "__GetListComponents",
    ]);
    for (const entry of absent) expect(entry.typeof).toBe("undefined");

    // A present binding keeps both names: the probed one, and the empty one the
    // runtime reports, which is why the probed name has to be written last.
    for (const entry of entries.filter(entry => entry.enumeratedAs === "own")) {
      expect(entry.typeof).toBe("function");
      expect(entry.arity).toBe(3);
      expect(entry.fnName).toBe("");
      expect(entry.name).not.toBe(entry.fnName);
    }
  });

  it("cannot lose a name to a runtime that reports one of its own", () => {
    // A binding whose `fn.name` is set — and deliberately not the probed name —
    // must still be filed under the name the card asked about.
    const alias = function __SomethingElseEntirely() {
      return undefined;
    };
    const [entry] = describeListInventory({ __CreateList: alias }, ["__CreateList"]);
    expect(entry?.name).toBe("__CreateList");
    expect(entry?.fnName).toBe("__SomethingElseEntirely");
  });

  it("round-trips through the stage line the verifier reads", () => {
    // The verifier requires a non-empty string `name` on every entry, so the
    // assertion is made on the serialized payload rather than on the object.
    const line = listReportLine("inventory", {
      relatedGlobals: [],
      operations: describeListInventory({ __CreateList: nativeBinding() }),
      namedPresent: ["__CreateList"],
      countingInstalled: true,
    });
    const parsed = JSON.parse(line.slice("[solid-lynx lp] ".length)) as {
      operations: { name?: unknown }[];
    };
    expect(parsed.operations).toHaveLength(4);
    for (const entry of parsed.operations) {
      expect(typeof entry.name).toBe("string");
      expect((entry.name as string).trim()).not.toBe("");
    }
  });

  it("records a binding it could not read instead of dropping it", () => {
    // A hostile global: reading it throws. The row still has its name, and the
    // throw is recorded rather than thrown.
    const scope = {} as Record<string, unknown>;
    Object.defineProperty(scope, "__CreateList", {
      enumerable: true,
      get() {
        throw new Error("host is gone");
      },
    });

    const entries = describeListInventory(scope, ["__CreateList", "__GetListComponents"]);
    expect(entries.map(entry => entry.name)).toEqual(["__CreateList", "__GetListComponents"]);
    expect(entries[0]?.typeof).toBe("unreadable");
    expect(entries[0]?.error).toContain("host is gone");
    expect(entries[1]?.typeof).toBe("undefined");
  });

  it("reports the enumeration as unreadable when it cannot list own names", () => {
    // A scope whose own-name enumeration throws still yields the probed names;
    // the provenance field says the enumeration was the part that failed.
    const scope = new Proxy({ __CreateList: nativeBinding() }, {
      ownKeys() {
        throw new Error("no own keys for you");
      },
    });

    const entries = describeListInventory(scope, ["__CreateList"]);
    expect(entries[0]?.name).toBe("__CreateList");
    expect(entries[0]?.typeof).toBe("function");
    expect(entries[0]?.enumeratedAs).toBe("unreadable");
  });
});

describe("native list probe child walk", () => {
  /** A fake sibling chain: parent -> a -> b -> c -> null. */
  const chain = (...nodes: object[]) => {
    const byNode = new Map<object | null, object | null>();
    nodes.forEach((node, index) => byNode.set(node, nodes[index + 1] ?? null));
    return {
      first: (parent: unknown) => (parent === "parent" ? nodes[0] ?? null : null),
      next: (node: unknown) => byNode.get(node as object) ?? null,
    };
  };

  it("counts children through the sibling primitives", () => {
    const nodes = [{}, {}, {}];
    const { first, next } = chain(...nodes);
    expect(countChildren("parent", first, next)).toEqual({ count: 3, truncated: false });
    expect(countChildren("empty", first, next)).toEqual({ count: 0, truncated: false });
  });

  it("stops at the limit instead of trusting an endless chain", () => {
    let calls = 0;
    const next = (node: unknown) => {
      calls += 1;
      return calls > 1000 ? null : node;
    };
    const counted = countChildren("parent", () => ({}), next, 5);
    expect(counted).toEqual({ count: 5, truncated: true });
    expect(calls).toBeLessThan(10);
  });

  it("records a throw rather than propagating it", () => {
    expect(countChildren("parent", undefined, undefined).error).toContain("not both callable");
    expect(countChildren("parent", () => {
      throw new Error("host is gone");
    }, () => null).error).toBe("Error: host is gone");

    // A throw mid-walk keeps the count reached so far.
    let seen = 0;
    const partial = countChildren("parent", () => ({}), () => {
      seen += 1;
      if (seen > 1) throw new Error("chain broke");
      return {};
    });
    expect(partial.error).toBe("Error: chain broke");
    expect(partial.count).toBeGreaterThan(0);
  });

  it("walks children in element order and visits each one", () => {
    const a = { id: 1 };
    const b = { id: 2 };
    const { first, next } = chain(a, b);
    const visited: unknown[] = [];
    const walked = walkChildren("parent", first, next, child => visited.push(child), 16);
    expect(walked.count).toBe(2);
    expect(visited).toEqual([a, b]);
  });

  it("reads unique ids in element order, which is what makes a reorder visible", () => {
    const a = { id: 1 };
    const b = { id: 2 };
    const c = { id: 3 };
    const readId = (node: unknown) => (node as { id: number }).id;

    const forward = chain(a, b, c);
    expect(childIds("parent", forward.first, forward.next, readId).ids).toEqual([1, 2, 3]);

    const permuted = chain(c, a, b);
    expect(childIds("parent", permuted.first, permuted.next, readId).ids).toEqual([3, 1, 2]);

    // Without a reader the walk still counts, but reports no ids rather than
    // inventing them.
    const noIds = childIds("parent", forward.first, forward.next, undefined);
    expect(noIds.ids).toEqual([]);
    expect(noIds.count).toBe(3);
  });
});

describe("native list probe row snapshots", () => {
  it("describes any key as a stable printable string", () => {
    expect(describeKey("alpha")).toBe("alpha");
    expect(describeKey(7)).toBe("7");
    expect(describeKey(true)).toBe("true");
    expect(describeKey(null)).toBe("null");
    expect(describeKey(undefined)).toBe("undefined");
    // An object key is described by tag rather than by JSON, which can throw on
    // a cyclic or native value.
    expect(describeKey({})).toBe("[object Object]");
    expect(describeKey(Object.create(null))).toContain("Object");
  });

  it("samples rows without touching the host itself", () => {
    const nodeA = { id: 10 };
    const notes = observeRows(
      [
        { key: "alpha", item: "alpha", node: nodeA },
        { key: "bravo", item: "bravo", node: {} },
      ],
      item => item,
      node => (node as { id?: number }).id,
    );
    expect(notes).toEqual([
      { key: "alpha", item: "alpha", id: 10 },
      { key: "bravo", item: "bravo" },
    ]);
    // No reader means no ids, rather than invented ones.
    expect(observeRows([{ key: 1, item: "x", node: {} }], item => item, undefined))
      .toEqual([{ key: "1", item: "x" }]);
    expect(keyOrder(notes)).toEqual(["alpha", "bravo"]);
  });

  it("compares snapshots by identity, not by position", () => {
    const before = [
      { key: "alpha", item: "alpha", id: 1 },
      { key: "bravo", item: "bravo", id: 2 },
    ];
    // Same elements, new order: a row that moved kept its node.
    const moved = [
      { key: "bravo", item: "bravo", id: 2 },
      { key: "alpha", item: "alpha", id: 1 },
    ];
    const kept = diffSnapshots(before, moved);
    expect(kept.kept).toEqual(["bravo", "alpha"]);
    expect(kept.sameNode).toEqual(["bravo", "alpha"]);
    expect(kept.rebuilt).toEqual([]);
    expect(kept.released).toEqual([]);
    expect(kept.identityMeasured).toBe(true);
  });

  it("reports a rebuilt row and a released row separately", () => {
    const before = [
      { key: "alpha", item: "alpha", id: 1 },
      { key: "bravo", item: "bravo", id: 2 },
    ];
    // Same key, different element: rebuilt under the key.
    const rebuilt = diffSnapshots(before, [{ key: "alpha", item: "alpha", id: 9 }]);
    expect(rebuilt.rebuilt).toEqual(["alpha"]);
    expect(rebuilt.sameNode).toEqual([]);
    expect(rebuilt.released).toEqual(["bravo"]);

    // Nothing survives: every row released, nothing added.
    const emptied = diffSnapshots(before, []);
    expect(emptied.released).toEqual(["alpha", "bravo"]);
    expect(emptied.added).toEqual([]);
  });

  it("leaves identity unmeasured when the host exposes no unique ids", () => {
    const before = [{ key: "alpha", item: "alpha" }];
    const after = [{ key: "alpha", item: "alpha" }];
    const diff = diffSnapshots(before, after);
    // The key survived, but nothing compared the elements: the honest answer is
    // "not measured", not "preserved".
    expect(diff.kept).toEqual(["alpha"]);
    expect(diff.identityMeasured).toBe(false);
    expect(diff.sameNode).toEqual([]);
    expect(diff.rebuilt).toEqual([]);
  });
});
