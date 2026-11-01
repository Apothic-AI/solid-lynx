import { describe, expect, it } from "vitest";

import {
  LIST_RECYCLE_MARKER,
  LIST_RECYCLE_PROBE,
  LIST_RECYCLE_STAGES,
  SCROLL_CANDIDATE_NAMES,
  callDirectScroll,
  copyCounts,
  deltaCounts,
  describeListRecycleInventory,
  describeScrollCandidates,
  emptyHostCallCounts,
  invokeUiMethod,
  lrReportLine,
  recyclingAnswer,
  scrollAttemptCases,
  scrollTarget,
  withinRange,
} from "../examples/lynx-for-native/src/list-recycle-probe-report.js";

/**
 * The device run is the evidence; these tests cover the recorder and the two
 * rules that make the run readable:
 *
 * - a zero release count keeps a `reason` that says what the zero does and does
 *   not mean, so the capture cannot be quoted as "the host cannot recycle";
 * - a scroll attempt records the binding it used, its outcome, and whether this
 *   card's callback was actually invoked — never a fabricated success.
 */

describe("list recycle probe: the card's identity", () => {
  it("logs under its own marker and probe name, distinct from the list probe", () => {
    expect(LIST_RECYCLE_MARKER).toBe("[solid-lynx lr]");
    expect(LIST_RECYCLE_PROBE).toBe("native-list-recycle");

    const line = lrReportLine("done", { status: "all stages logged" });
    expect(line.startsWith(`${LIST_RECYCLE_MARKER} `)).toBe(true);
    const payload = JSON.parse(line.slice(LIST_RECYCLE_MARKER.length + 1));
    expect(payload.probe).toBe(LIST_RECYCLE_PROBE);
    expect(payload.stage).toBe("done");
  });

  it("names every stage once, in the order the card emits them", () => {
    expect(LIST_RECYCLE_STAGES).toEqual([
      "inventory",
      "create",
      "viewport",
      "scroll",
      "recycle",
      "reorder",
      "summary",
      "done",
    ]);
    expect(new Set(LIST_RECYCLE_STAGES).size).toBe(LIST_RECYCLE_STAGES.length);
  });
});

describe("list recycle probe: the scroll attempts", () => {
  it("tries a bounded list of card-built methods, each labelled", () => {
    const cases = scrollAttemptCases();

    expect(cases.length).toBeGreaterThanOrEqual(3);
    expect(new Set(cases.map(one => one.label)).size).toBe(cases.length);
    for (const one of cases) {
      expect(one.method.length).toBeGreaterThan(0);
      expect(typeof one.params).toBe("object");
    }
  });

  it("reads the coordinate an attempt names, so a range check does not parse labels", () => {
    const cases = scrollAttemptCases();
    expect(scrollTarget(cases[1])).toEqual({ field: "offset", value: 900 });
    expect(scrollTarget(cases[2])).toEqual({ field: "index", value: 20 });
    expect(scrollTarget(cases[3])).toEqual({ field: "position", value: 20 });
  });

  it("says whether an attempt points inside a forty-row list", () => {
    const cases = scrollAttemptCases();
    const content = 4000;
    const maxOffset = 3800;

    for (const one of cases) {
      expect(withinRange(one, content, maxOffset, 40)).toBe(true);
    }
    // The same offset on the four-row list the first version of this card left
    // behind is out of range, which is why its zero proved nothing.
    expect(withinRange(cases[1], 400, 200, 4)).toBe(false);
    expect(withinRange(cases[2], 400, 200, 4)).toBe(false);
  });

  it("tries an offset, a cell index and a position, not one shape three times", () => {
    const methods = scrollAttemptCases().map(one => one.method);
    expect(methods).toContain("scrollTo");
    expect(methods).toContain("scrollToIndex");
    expect(methods).toContain("scrollToPosition");
  });

  it("records a binding it does not have as absent, not as a call", () => {
    const attempt = scrollAttemptCases()[0];
    const record = invokeUiMethod(undefined, {}, attempt, () => undefined);

    expect(record.exposed).toBe(false);
    expect(record.outcome).toBe("absent");
    expect(record.callbackFired).toBe(false);
  });

  it("counts a callback only when the host invoked it", () => {
    const attempt = scrollAttemptCases()[0];
    const record = invokeUiMethod(
      (_element: unknown, _method: unknown, _params: unknown, callback: unknown) => {
        (callback as (result: unknown) => void)({ code: 0 });
      },
      {},
      attempt,
      () => undefined,
    );

    expect(record.exposed).toBe(true);
    expect(record.outcome).toBe("returned");
    expect(record.callbackFired).toBe(true);
    expect(record.callbackCode).toBe(0);
  });

  it("records a call that returned without invoking its callback as not fired", () => {
    const attempt = scrollAttemptCases()[0];
    const record = invokeUiMethod(() => null, {}, attempt, () => undefined);

    expect(record.outcome).toBe("returned");
    expect(record.callbackFired).toBe(false);
  });

  it("records the engine's own message when the call throws", () => {
    const attempt = scrollAttemptCases()[0];
    const record = invokeUiMethod(() => {
      throw new Error("InvokeUIMethod param 1 should be String");
    }, {}, attempt, () => undefined);

    expect(record.outcome).toBe("threw");
    expect(record.threw?.message).toBe("InvokeUIMethod param 1 should be String");
    expect(record.callbackFired).toBe(false);
  });

  it("calls a direct scroll binding with that binding's own shape", () => {
    const attempt = scrollAttemptCases()[2];
    const record = callDirectScroll((_element: unknown, params: unknown) => params,
      {}, attempt);

    expect(record.api).toBe("scrollToIndex");
    expect(record.outcome).toBe("returned");
    expect(record.callbackFired).toBe(false);
  });

  it("describes a scroll candidate from the host's binding, absence included", () => {
    const declared = () => undefined;
    Object.defineProperty(declared, "length", { value: 2 });
    const described = describeScrollCandidates({
      __InvokeUIMethod: declared,
    });

    expect(described.map(entry => entry.name)).toEqual([...SCROLL_CANDIDATE_NAMES]);
    const invoke = described.find(entry => entry.name === "__InvokeUIMethod");
    expect(invoke?.typeof).toBe("function");
    expect(invoke?.arity).toBe(2);
    const absent = described.find(entry => entry.name === "__ScrollBy");
    expect(absent?.typeof).toBe("undefined");
  });
});

describe("list recycle probe: counting what the host did", () => {
  it("starts every counter at zero", () => {
    const counts = emptyHostCallCounts();
    expect(counts.componentAtIndex).toBe(0);
    expect(counts.enqueueComponent).toBe(0);
    expect(counts.reuseNotifications).toBe(0);
    expect(counts.cellIndices).toEqual([]);
    expect(counts.releasedSigns).toEqual([]);
  });

  it("copies counters so a before/after pair cannot alias", () => {
    const before = emptyHostCallCounts();
    const copy = copyCounts(before);
    before.componentAtIndex = 3;

    expect(copy.componentAtIndex).toBe(0);
  });

  it("reports only the calls that happened inside the window", () => {
    const before = emptyHostCallCounts();
    before.componentAtIndex = 2;
    before.cellIndices.push(0, 1);
    const after = copyCounts(before);
    after.componentAtIndex = 5;
    after.enqueueComponent = 2;
    after.reuseNotifications = 2;
    after.cellIndices.push(2, 3, 4);
    after.releasedSigns.push(15, 17);

    const delta = deltaCounts(before, after);
    expect(delta.componentAtIndex).toBe(3);
    expect(delta.enqueueComponent).toBe(2);
    expect(delta.reuseNotifications).toBe(2);
    expect(delta.cellIndices).toEqual([2, 3, 4]);
    expect(delta.releasedSigns).toEqual([15, 17]);
  });
});

describe("list recycle probe: the zero rule", () => {
  const delta = (enqueue: number) => ({
    componentAtIndex: enqueue === 0 ? 0 : 3,
    enqueueComponent: enqueue,
    reuseNotifications: enqueue,
    cellIndices: [],
    releasedSigns: [],
  });

  it("says a host recycled only when it called enqueueComponent", () => {
    const answer = recyclingAnswer({
      delta: delta(2),
      releasedRows: 2,
      scrollAttempted: true,
      scrollApiExposed: true,
      rowCount: 40,
    });

    expect(answer.hostRecycled).toBe(true);
    expect(answer.measuredZero).toBe(false);
    expect(answer.reason).toBeNull();
    expect(answer.enqueueComponent).toBe(2);
  });

  it("gives a measured zero a reason that refuses the inability reading", () => {
    const answer = recyclingAnswer({
      delta: delta(0),
      releasedRows: 0,
      scrollAttempted: true,
      scrollApiExposed: true,
      rowCount: 40,
      attempts: 4,
      attemptCodes: [3, 3, 3, 4],
      viewportHeight: 200,
    });

    expect(answer.hostRecycled).toBe(false);
    expect(answer.measuredZero).toBe(true);
    expect(answer.reason).toContain("not evidence");
    expect(answer.reason).toContain("40");
    // What the bytes support: the calls returned and reported codes, not that the
    // viewport moved.
    expect(answer.reason).toContain("3, 3, 3, 4");
    expect(answer.reason).toContain("not that the viewport moved");
    expect(answer.reason).not.toContain("scrolled 4 rows");
  });

  it("distinguishes a zero with no scroll entry point from a zero after scrolling", () => {
    const noEntry = recyclingAnswer({
      delta: delta(0), releasedRows: 0, scrollAttempted: false,
      scrollApiExposed: false, rowCount: 40,
    });
    const noAttempt = recyclingAnswer({
      delta: delta(0), releasedRows: 0, scrollAttempted: false,
      scrollApiExposed: true, rowCount: 40,
    });

    expect(noEntry.reason).toContain("No scroll entry point");
    expect(noAttempt.reason).toContain("no attempt");
    expect(noEntry.reason).not.toBe(noAttempt.reason);
  });
});

describe("list recycle probe: the inventory", () => {
  it("describes all four list bindings and the scroll candidates", () => {
    const described = describeListRecycleInventory({
      __CreateList: () => undefined,
      __UpdateListCallbacks: () => undefined,
    });

    expect(described.operations.map(entry => entry.name)).toEqual([
      "__CreateList",
      "__UpdateListCallbacks",
      "__UpdateListComponents",
      "__GetListComponents",
    ]);
    expect(described.scrollCandidates.map(entry => entry.name))
      .toEqual([...SCROLL_CANDIDATE_NAMES]);
    expect(Array.isArray(described.relatedGlobals)).toBe(true);
  });
});