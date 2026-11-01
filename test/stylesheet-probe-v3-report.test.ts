import { describe, expect, it } from "vitest";

import {
  LOAD_STAGE_BYTES,
  RELEASE_VERB,
  STYLESHEET_V3_MARKER,
  STYLESHEET_V3_PROBE,
  STYLESHEET_V3_READBACK_GLOBALS,
  STYLESHEET_V3_STAGES,
  STYLE_OBJECT_SETTERS,
  adoptRetryCases,
  candidatesFrom,
  createStyleObjectCases,
  deriveHandleVerdict,
  fitStage,
  isObjectish,
  loadRetryCases,
  observeStyleObject,
  offerCategory,
  offersFrom,
  presentObservation,
  releaseScopedNames,
  replaceRetryCases,
  runWithArguments,
  splitOffers,
  styleObjectSetterCases,
  v3ReportLine,
} from "../examples/lynx-for-native/src/stylesheet-probe-v3-report.js";

/**
 * The device run is the evidence; these tests cover the recorder and the argument
 * tables, because a failure there is silent. A recorder that throws on a native
 * value kills the card and loses every earlier stage. An argument table that
 * quietly stops passing the value the host returned turns the handle question into
 * a question about the probe — which is exactly the mistake v2's capture made when
 * it recorded zero handles for a value its own predicate accepts.
 */

const URL_1 = "http://127.0.0.1:8099/probe.css";
const URL_2 = "http://127.0.0.1:8099/probe-2.css";

describe("stylesheet probe v3: the card's identity", () => {
  it("logs under its own marker and probe name, neither of which is v2's", () => {
    expect(STYLESHEET_V3_MARKER).toBe("[solid-lynx ss3]");
    expect(STYLESHEET_V3_PROBE).toBe("native-stylesheet-papi-v3");

    const line = v3ReportLine("done", { status: "all stages logged" });
    expect(line.startsWith(`${STYLESHEET_V3_MARKER} `)).toBe(true);

    const payload = JSON.parse(line.slice(STYLESHEET_V3_MARKER.length + 1));
    expect(payload.probe).toBe(STYLESHEET_V3_PROBE);
    expect(payload.stage).toBe("done");
    expect(payload.status).toBe("all stages logged");
  });

  it("names every stage once, in the order the card emits them", () => {
    expect(STYLESHEET_V3_STAGES).toEqual([
      "inventory-v3",
      "create-style-object",
      "style-object-setters",
      "load-retry",
      "adopt-retry",
      "replace-retry",
      "handle-verdict",
      "lifecycle",
      "summary",
      "done",
    ]);
    expect(new Set(STYLESHEET_V3_STAGES).size).toBe(STYLESHEET_V3_STAGES.length);
  });

  it("reads its card back through the same read-only bindings v2 used", () => {
    expect(STYLESHEET_V3_READBACK_GLOBALS).toEqual([
      "__GetInlineStyles",
      "__GetInlineStyle",
      "__GetComputedStyles",
      "__GetComputedStyleByKey",
    ]);
  });
});

describe("stylesheet probe v3: the __CreateStyleObject argument table", () => {
  it("attempts eight cases, with a label for each", () => {
    const cases = createStyleObjectCases();

    expect(cases).toHaveLength(8);
    expect(new Set(cases.map(one => one.label)).size).toBe(cases.length);
  });

  it("repeats v2's two cases verbatim, so the two captures are comparable", () => {
    const cases = createStyleObjectCases();
    const labels = cases.map(one => one.label);

    expect(labels[0]).toBe("no arguments");
    expect(cases[0].args).toEqual([]);
    expect(labels[1]).toBe("[{}]");
    expect(cases[1].args).toEqual([{}]);
  });

  it("passes a fresh object, array and function per case, never a shared one", () => {
    const first = createStyleObjectCases();
    const second = createStyleObjectCases();

    for (const index of [1, 2, 3, 4, 7]) {
      expect(first[index].args[0]).not.toBe(second[index].args[0]);
    }
  });

  it("marks the arguments that can carry a marker, so an echo is visible", () => {
    const cases = createStyleObjectCases();
    const marked = cases.find(one => one.label === "[{probe-marker}]");
    const parsed = cases.find(one => one.label === "[parsed style array]");

    expect(marked?.args[0]).toEqual({ "probe-marker": "v3" });
    expect(JSON.stringify(parsed?.args[0])).toContain("probe-marker");
  });

  it("includes primitives, because a binding that accepts one is a fact about it", () => {
    const labels = createStyleObjectCases().map(one => one.label);

    expect(labels).toContain("[\"probe-key\"]");
    expect(labels).toContain("[0]");
    expect(labels).toContain("[function(){}]");
  });
});

describe("stylesheet probe v3: the setter tables", () => {
  it("offers a returned value to each of the three safe bindings, in order", () => {
    const value = { returnedBy: "the host" };
    const tables = styleObjectSetterCases(value);

    expect(tables.map(table => table.name)).toEqual([...STYLE_OBJECT_SETTERS]);
    // __GetComputedStyleByKey is deliberately absent: it returned "" once and
    // killed Explorer in four later runs of the same build, and a stored capture
    // has to come from a run that reached done.
    expect(STYLE_OBJECT_SETTERS).toEqual([
      "__SetParsedStyles",
      "__UpdateStyleObject",
      "__SetStyleObject",
    ]);
  });

  it("passes only the value it was given as the first argument", () => {
    const value = { returnedBy: "the host" };
    for (const table of styleObjectSetterCases(value)) {
      for (const one of table.cases) {
        expect(one.args[0]).toBe(value);
      }
    }
  });

  it("gives __SetStyleObject the two-argument shape that the engine accepted", () => {
    // One-argument calls measured "param size should >= 2", so the two-argument
    // shape is what can answer about the value instead of about the arity.
    const table = styleObjectSetterCases({}).find(entry => entry.name === "__SetStyleObject");
    expect(table?.cases).toHaveLength(2);
    expect(table?.cases[1].args).toHaveLength(2);
  });

  it("never offers the value to the binding that killed the engine", () => {
    const names = styleObjectSetterCases({}).map(table => table.name);
    expect(names).not.toContain("__GetComputedStyleByKey");
    // It is still evidence the verdict understands, when another run records it.
    expect(offerCategory("__GetComputedStyleByKey")).toBe("style-object");
  });
});

describe("stylesheet probe v3: the retry tables", () => {
  it("repeats the two load shapes v2 measured as returning", () => {
    const cases = loadRetryCases(URL_1, URL_2);

    expect(cases[0]).toEqual({ label: "[url, \"utf-8\"]", args: [URL_1, "utf-8"] });
    expect(cases[1]).toEqual({ label: "[url, url2]", args: [URL_1, URL_2] });
    expect(cases).toHaveLength(2);
  });

  it("adds the candidate shapes only when there is a value to offer", () => {
    const value = {};
    const withCandidate = loadRetryCases(URL_1, URL_2, value);

    expect(withCandidate).toHaveLength(4);
    expect(withCandidate[2].args).toEqual([URL_1, value]);
    expect(withCandidate[3].args).toEqual([URL_1, "utf-8", value]);
    // Every case is still pointed at a stylesheet the card really serves.
    for (const one of withCandidate) expect(one.args[0]).toBe(URL_1);
  });

  it("offers the candidate to adopt as the only argument, and inside an array", () => {
    const value = {};
    const cases = adoptRetryCases(value);

    expect(cases[0]).toEqual({ label: "[]", args: [] });
    expect(cases[1]).toEqual({ label: "[null]", args: [null] });
    expect(cases[2].args).toEqual([value]);
    expect(cases[3].args).toEqual([[value]]);
  });

  it("offers the candidate to replace as a member and as the argument itself", () => {
    const value = {};
    const cases = replaceRetryCases(value);

    expect(cases.slice(0, 3).map(one => one.label)).toEqual(["[]", "[null]", "[[]]"]);
    expect(cases[3].args).toEqual([[value]]);
    expect(cases[4].args).toEqual([value]);
  });

  it("leaves the candidate cases out rather than passing undefined", () => {
    for (const cases of [loadRetryCases(URL_1, URL_2), adoptRetryCases(), replaceRetryCases()]) {
      for (const one of cases) {
        expect(one.args).not.toContain(undefined);
      }
    }
  });
});

describe("stylesheet probe v3: describing a returned value", () => {
  it("records a plain object as one, without inferring that it is not a handle", () => {
    const observation = observeStyleObject({});

    expect(observation.typeofValue).toBe("object");
    expect(observation.tag).toBe("[object Object]");
    expect(observation.protoIsObjectPrototype).toBe(true);
    expect(observation.ownNames).toEqual([]);
  });

  it("does not write to a value that is about to be offered back", () => {
    // The token write is opt-in because the first API 33 runs crashed after an
    // offered value had been written to. A probe must not cause what it measures.
    const value = {};
    const observation = observeStyleObject(value);

    expect(observation.tokenRoundTrip).toBeUndefined();
    expect(Object.getOwnPropertyNames(value)).toEqual([]);

    // Asked for explicitly, the round-trip is still measured.
    expect(observeStyleObject({}, undefined, true).tokenRoundTrip).toBe(true);
  });

  it("says whether the host returned the very object it was given", () => {
    const argument = { "probe-marker": "v3" };
    const same = observeStyleObject(argument, argument);
    const different = observeStyleObject({}, argument);

    expect(same.sameAsArgument).toBe(true);
    expect(same.echoesArgument).toBe(true);
    expect(different.sameAsArgument).toBe(false);
    expect(different.echoesArgument).toBe(false);
  });

  it("leaves the echo field absent when the argument has no key to come back", () => {
    // `[].every(...)` is true, and a vacuous true in a capture reads as evidence.
    const observation = observeStyleObject({}, {});
    expect(observation.argumentKeys).toEqual([]);
    expect(observation.echoesArgument).toBeUndefined();
  });

  it("records the marker coming back when the host echoes its input", () => {
    const argument = { "probe-marker": "v3" };
    const observation = observeStyleObject({ ...argument }, argument);

    expect(observation.argumentKeys).toEqual(["probe-marker"]);
    expect(observation.echoesArgument).toBe(true);
  });

  it("does not throw on a value whose own names cannot be read", () => {
    const hostile = new Proxy({}, {
      ownKeys() {
        throw new Error("no own keys");
      },
      getOwnPropertyDescriptor() {
        throw new Error("no descriptor");
      },
    });

    const observation = observeStyleObject(hostile);
    expect(observation.typeofValue).toBe("object");
    expect(observation.ownNames).toBeUndefined();
  });

  it("records a failed token write as false rather than throwing", () => {
    const frozen = Object.freeze({ locked: true });
    const observation = observeStyleObject(frozen, undefined, true);

    expect(observation.tokenRoundTrip).toBe(false);
    // The failure is recorded with its own reason; the stage still runs.
    expect(typeof observation.error).toBe("string");
  });

  it("keeps absent fields absent, so an unreadable field is not read as false", () => {
    const presented = presentObservation({ typeofValue: "object" });

    expect(presented).toEqual({ typeofValue: "object" });
    expect("tokenRoundTrip" in presented).toBe(false);
  });
});

describe("stylesheet probe v3: carrying returned values forward", () => {
  it("offers back a plain object, which is the case v2 recorded as zero handles", () => {
    const returned = { tag: "[object Object]" };
    const run = runWithArguments((_value: unknown) => returned, [
      { label: "one argument an empty object", args: [{}] },
    ]);
    const candidates = candidatesFrom(run);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].value).toBe(returned);
    expect(candidates[0].label).toBe("one argument an empty object");
    expect(candidates[0].observation.sameAsArgument).toBe(false);
  });

  it("keeps a primitive return too, because offering it back is a measurement", () => {
    const run = runWithArguments(() => 7, [{ label: "[0]", args: [0] }]);
    const candidates = candidatesFrom(run);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].observation.typeofValue).toBe("number");
  });

  it("does not offer a null or undefined return, because there is nothing to pass", () => {
    const run = runWithArguments((value: unknown) => value, [
      { label: "[]", args: [null] },
      { label: "[[]]", args: [[]] },
    ]);
    const candidates = candidatesFrom(run);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].label).toBe("[[]]");
  });

  it("omits a returning case that came after a throw, without inventing a value", () => {
    const run = runWithArguments((value: unknown) => {
      if (value === undefined) throw new Error("param size should >= 1");
      return value;
    }, [
      { label: "no arguments", args: [] },
      { label: "[{}]", args: [{}] },
    ]);

    expect(run.attempts[0].outcome).toBe("threw");
    expect(candidatesFrom(run)).toHaveLength(1);
  });
});

describe("stylesheet probe v3: the two verdicts", () => {
  const candidate = { label: "[{}]", value: {}, observation: { typeofValue: "unknown" } };

  it("reports the style-object answer separately from the stylesheet-handle answer", () => {
    // The measured asymmetry: the style bindings accepted the value while adopt
    // rejected it by naming RefCounted. One field for both would have hidden it.
    const verdict = deriveHandleVerdict({
      candidates: [candidate],
      offers: [
        {
          binding: "__GetComputedStyleByKey",
          label: "the value and the key",
          outcome: "returned",
          direct: true,
        },
        {
          binding: "__AdoptStyleSheet",
          label: "[candidate]",
          outcome: "threw",
          message: "AdoptStyleSheet param 0 should be RefCounted",
          direct: true,
        },
      ],
      loadReturnedObject: false,
    });

    expect(verdict.styleObjectVerdict).toBe("style-binding-accepted-the-value");
    expect(verdict.styleObjectAcceptedBy).toEqual(["__GetComputedStyleByKey"]);
    expect(verdict.stylesheetHandleVerdict).toBe("no-adopt-accepted-the-value");
    expect(verdict.stylesheetHandleAcceptedBy).toEqual([]);
    expect(verdict.refCountedDemandRecorded).toBe(true);
  });

  it("says neither was observed when no binding accepted the value", () => {
    const verdict = deriveHandleVerdict({
      candidates: [candidate],
      offers: [
        {
          binding: "__SetStyleObject",
          label: "one argument",
          outcome: "threw",
          message: "SetStyleObject param size should >= 2",
          direct: true,
        },
      ],
      loadReturnedObject: false,
    });

    expect(verdict.styleObjectVerdict).toBe("no-style-binding-accepted-the-value");
    expect(verdict.stylesheetHandleVerdict).toBe("no-adopt-accepted-the-value");
    expect(verdict.candidatesReturned).toBe(1);
  });

  it("reports a stylesheet handle only when __AdoptStyleSheet accepted the value", () => {
    const verdict = deriveHandleVerdict({
      candidates: [candidate],
      offers: [
        { binding: "__AdoptStyleSheet", label: "[candidate]", outcome: "returned", direct: true },
      ],
      loadReturnedObject: false,
    });

    expect(verdict.stylesheetHandleVerdict).toBe("adopt-accepted-the-value");
    expect(verdict.stylesheetHandleAcceptedBy).toEqual(["__AdoptStyleSheet"]);
    // Adopt accepting says nothing about whether the style bindings would.
    expect(verdict.styleObjectVerdict).toBe("no-style-binding-accepted-the-value");
  });

  it("records the engine's own native-type demand rather than paraphrasing it", () => {
    const message = "\nerror code: 111101\nerror message: AdoptStyleSheet param 0 should be"
      + " RefCounted";
    const verdict = deriveHandleVerdict({
      candidates: [],
      offers: [
        { binding: "__AdoptStyleSheet", label: "[candidate]", outcome: "threw", message, direct: true },
      ],
      loadReturnedObject: false,
    });

    expect(verdict.refCountedDemandRecorded).toBe(true);
    expect(verdict.stylesheetHandleRejectedBy[0].message).toBe(message);
  });

  it("does not count an array holding the value as a stylesheet handle", () => {
    // The measured false positive: __AdoptStyleSheet([value]) returned while
    // __AdoptStyleSheet(value) threw RefCounted. Only the direct offer is evidence.
    const verdict = deriveHandleVerdict({
      candidates: [candidate],
      offers: [
        {
          binding: "__AdoptStyleSheet",
          label: "[candidate]",
          outcome: "threw",
          message: "AdoptStyleSheet param 0 should be RefCounted",
          direct: true,
        },
        {
          binding: "__AdoptStyleSheet",
          label: "[[candidate]]",
          outcome: "returned",
          direct: false,
        },
      ],
      loadReturnedObject: false,
    });

    expect(verdict.stylesheetHandleVerdict).toBe("no-adopt-accepted-the-value");
    expect(verdict.stylesheetHandleAcceptedBy).toEqual([]);
    expect(verdict.nonDirectHandleOffers).toEqual([
      { binding: "__AdoptStyleSheet", label: "[[candidate]]", outcome: "returned" },
    ]);
  });

  it("does not let a returned __ReplaceStyleSheets count for either answer", () => {
    // v2 measured replace returning null for an empty set, so a return from it
    // says nothing about the value it was given.
    const verdict = deriveHandleVerdict({
      candidates: [candidate],
      offers: [
        { binding: "__ReplaceStyleSheets", label: "[[candidate]]", outcome: "returned", direct: false },
      ],
      loadReturnedObject: false,
    });

    expect(verdict.excludedBindings).toEqual(["__ReplaceStyleSheets"]);
    expect(verdict.styleObjectVerdict).toBe("no-style-binding-accepted-the-value");
    expect(verdict.stylesheetHandleVerdict).toBe("no-adopt-accepted-the-value");
  });

  it("states the rule it was computed by, so a reader does not re-derive it", () => {
    const verdict = deriveHandleVerdict({
      candidates: [], offers: [], loadReturnedObject: false,
    });

    expect(verdict.rule).toContain("__AdoptStyleSheet");
    expect(verdict.rule).toContain("RefCounted");
    expect(verdict.rule).toContain("separate answers");
  });

  it("carries the load answer through instead of folding it into a verdict", () => {
    const verdict = deriveHandleVerdict({
      candidates: [], offers: [], loadReturnedObject: true,
    });

    expect(verdict.loadReturnedObject).toBe(true);
    expect(verdict.stylesheetHandleVerdict).toBe("no-adopt-accepted-the-value");
  });

  it("counts a QuickJS host object as an object even though typeof says unknown", () => {
    // The host object __CreateStyleObject returns reports typeof "unknown". Treating
    // that as a primitive is what made the previous card record zero handles.
    expect(isObjectish({})).toBe(true);
    expect(isObjectish(() => undefined)).toBe(true);
    expect(isObjectish(null)).toBe(false);
    expect(isObjectish(undefined)).toBe(false);
    expect(isObjectish(0)).toBe(false);
    expect(isObjectish("null")).toBe(false);
  });

  it("splits offers into accepted and rejected without dropping either", () => {
    const offers = offersFrom([
      {
        name: "__SetStyleObject",
        run: runWithArguments((value: unknown) => {
          if (value === "reject-me") throw new Error("param 0 should be Object");
          return null;
        }, [
          { label: "accepted", args: ["ok"] },
          { label: "rejected", args: ["reject-me"] },
        ]),
      },
    ]);
    const split = splitOffers(offers);

    expect(offers).toHaveLength(2);
    expect(split.accepted.map(offer => offer.label)).toEqual(["accepted"]);
    expect(split.rejected.map(offer => offer.label)).toEqual(["rejected"]);
    expect(split.rejected[0].message).toBe("param 0 should be Object");
  });
});

describe("stylesheet probe v3: the cleanup surface", () => {
  it("finds a release verb when the host exposes one", () => {
    const scope = {
      __ReleaseStyleSheet: () => undefined,
      __DestroyStyleObject: () => undefined,
      __LoadStyleSheet: () => undefined,
      __CreatePage: () => undefined,
    };

    expect(releaseScopedNames(scope)).toEqual(["__DestroyStyleObject", "__ReleaseStyleSheet"]);
  });

  it("finds none in the fourteen style globals v1 recorded", () => {
    const scope: Record<string, unknown> = {};
    for (const name of [
      "__AddInlineStyle", "__AdoptStyleSheet", "__CreateStyleObject",
      "__GetComputedStyleByKey", "__GetComputedStyles", "__GetInlineStyle",
      "__GetInlineStyles", "__LoadStyleSheet", "__ReplaceStyleSheets", "__SetCSSId",
      "__SetInlineStyles", "__SetParsedStyles", "__SetStyleObject", "__UpdateStyleObject",
    ]) {
      scope[name] = () => undefined;
    }

    expect(releaseScopedNames(scope)).toEqual([]);
  });

  it("tests the verb list against cleanup words and not against load or set", () => {
    expect(RELEASE_VERB.test("__ReleaseStyleSheet")).toBe(true);
    expect(RELEASE_VERB.test("__UnloadStyleSheet")).toBe(true);
    expect(RELEASE_VERB.test("__SetStyleObject")).toBe(false);
    expect(RELEASE_VERB.test("__LoadStyleSheet")).toBe(false);
  });
});

describe("stylesheet probe v3: the delivered-line budget", () => {
  it("keeps a full create stage inside the largest line the bridge has delivered", () => {
    const run = runWithArguments((value: unknown) => value, createStyleObjectCases());
    const described = run.attempts.map(attempt => ({
      label: attempt.label,
      args: attempt.args,
      outcome: attempt.outcome,
      returned: attempt.call.returned,
    }));
    const payload = fitStage(
      "create-style-object",
      { attempts: described, candidatesReturned: 1, stageBytes: LOAD_STAGE_BYTES },
      { attempts: described, candidatesReturned: 1, stageBytes: LOAD_STAGE_BYTES },
    );
    const line = v3ReportLine("create-style-object", payload);

    expect(line.length).toBeLessThanOrEqual(LOAD_STAGE_BYTES);
    expect(line.startsWith(STYLESHEET_V3_MARKER)).toBe(true);
  });

  it("falls back to the lean form and says which form it used", () => {
    const filler = "x".repeat(LOAD_STAGE_BYTES);
    const payload = fitStage("load-retry", { note: filler }, { note: "short" });

    expect(payload.fitForm).toBe("lean");
    expect(payload.note).toBe("short");
    expect(v3ReportLine("load-retry", payload).length).toBeLessThanOrEqual(LOAD_STAGE_BYTES);
  });

  it("says it is over budget rather than emitting a line that may arrive cut", () => {
    const filler = "x".repeat(LOAD_STAGE_BYTES);
    const payload = fitStage("load-retry", { note: filler }, { note: filler });

    expect(payload.overBudget).toBe(true);
    expect(payload.fitForm).toBe("over-budget");
  });
});