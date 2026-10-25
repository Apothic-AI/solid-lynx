/**
 * Recording helpers for the native list PAPI probe.
 *
 * Everything here is pure and side-effect free so the probe card can use it at
 * runtime and a host-free unit test can check that it never throws on the values
 * a native runtime hands back. The probe depends on being able to describe
 * anything at all: a helper that threw on some handle shape would kill the card
 * and lose the evidence gathered so far.
 *
 * The value and function describers, the guarded call, and the error text come
 * from the stylesheet probe recorder rather than being copied, so the two cards
 * record a native binding the same way and a later runner can report both.
 */

import {
  describeFunction,
  type ProbeFunction,
} from "./stylesheet-probe-report.js";

export {
  describeFunction,
  describeValue,
  safeCall,
  type ProbeCall,
  type ProbeFunction,
  type ProbeValue,
} from "./stylesheet-probe-report.js";

/**
 * The list operations this probe knows by name.
 *
 * `__GetListComponents` and `__UpdateListComponents` are included because they
 * are part of the native list surface, and an inventory that omitted them would
 * make "absent" and "unasked" look the same. Every name is only ever described,
 * never called: what a binding requires is measured by what the runtime reports
 * about it, not by guessing arguments for it.
 */
export const LIST_PAPI_NAMES = [
  "__CreateList",
  "__UpdateListCallbacks",
  "__UpdateListComponents",
  "__GetListComponents",
] as const;

export type ListPapiName = (typeof LIST_PAPI_NAMES)[number];

/**
 * One row of the list card's `inventory`: the probed name, plus what the
 * runtime reported about the binding under it.
 *
 * `name` is the name this probe asked about, not the name the binding reports.
 * `ProbeFunction.name` is `fn.name`, which for a native binding is the empty
 * string (measured: `fn.length === 3`, `fn.name === ""`, own properties
 * `length`/`name`), so it is kept as `fnName` and can never be mistaken for the
 * probed name. `enumeratedAs` is where the name came from: `own` for one
 * `Object.getOwnPropertyNames` returned, `absent` for one it did not, and
 * `unreadable` when the enumeration itself threw.
 */
export interface ListInventoryEntry extends ProbeFunction {
  name: string;
  /** `fn.name`. Empty for a native binding, which is why it is not `name`. */
  fnName?: string;
  /** Where {@link ListInventoryEntry.name} came from. */
  enumeratedAs: "own" | "absent" | "unreadable";
}

/**
 * Describes every list binding the card records, present or absent.
 *
 * The name is written **last** on purpose. Spreading a function description
 * over the name it was filed under loses the name: `{ name, ...description }`
 * lets `description.name` — `fn.name`, empty for a native binding — overwrite
 * it, which is how a real capture arrived with two nameless operations and could
 * no longer say *which* binding was missing. A capture that cannot name the
 * binding it probed is not evidence, so the probed name always wins.
 *
 * An absent binding is recorded as `{ typeof: "undefined" }` with its name
 * present: the card asked, and "the host does not expose this" is an answer.
 * Nothing here is inferred from a name and no binding is called.
 */
export function describeListInventory(
  scope: object,
  names: readonly string[] = LIST_PAPI_NAMES,
): ListInventoryEntry[] {
  let own: Set<string> | undefined;
  try {
    own = new Set(Object.getOwnPropertyNames(scope));
  } catch {
    own = undefined;
  }

  return names.map(name => {
    let value: unknown;
    let readError: string | undefined;
    try {
      value = (scope as Record<string, unknown>)[name];
    } catch (error) {
      readError = describeError(error);
    }

    const description = readError === undefined
      ? describeFunction(value)
      : ({ typeof: "unreadable", error: readError } satisfies ProbeFunction);
    const { name: fnName, ...rest } = description as ProbeFunction;

    const enumeratedAs: ListInventoryEntry["enumeratedAs"] = own === undefined
      ? "unreadable"
      : own.has(name)
        ? "own"
        : "absent";

    return {
      ...rest,
      ...(typeof fnName === "string" ? { fnName } : {}),
      enumeratedAs,
      name,
    };
  });
}

/**
 * `typeof` of a value, never throwing.
 *
 * A native PrimJS element handle reports `typeof === "unknown"`, which is why the
 * card records this instead of testing the handle against `"object"`. Kept
 * separate from {@link describeValue} because the raw `typeof` is the evidence
 * and the describers are the interpretation.
 */
export function safeTypeof(value: unknown): string {
  try {
    return typeof value;
  } catch {
    return "unreadable";
  }
}

/** How many children could be walked before the walk was cut short. */
export interface ChildCount {
  /**
   * Number of children reached from `__FirstElement`/`__NextElement`, capped at
   * the limit. Absent when the walk could not run at all.
   */
  count?: number;
  /** True when the walk stopped at the limit instead of at the end. */
  truncated?: boolean;
  /** Why the walk produced no count. */
  error?: string;
}

/**
 * Walks a node's children through the PAPI's own sibling primitives.
 *
 * A native list does not expose a children array, so children are reached the
 * way the host reaches them: `__FirstElement` then `__NextElement`. The walk is
 * bounded, because a host in a bad state must not turn a measurement into a
 * hang, and a throw mid-walk is recorded along with the count reached.
 */
export function walkChildren(
  parent: unknown,
  first: unknown,
  next: unknown,
  visit: ((child: unknown, position: number) => void) | undefined,
  limit: number,
): ChildCount {
  if (typeof first !== "function" || typeof next !== "function") {
    return { error: "__FirstElement and __NextElement are not both callable" };
  }

  let child: unknown;
  try {
    child = (first as (node: unknown) => unknown)(parent);
  } catch (error) {
    return { error: describeError(error) };
  }

  let count = 0;
  try {
    while (child !== undefined && child !== null) {
      visit?.(child, count);
      count += 1;
      if (count >= limit) return { count, truncated: true };
      child = (next as (node: unknown) => unknown)(child);
    }
  } catch (error) {
    return { count, error: describeError(error) };
  }
  return { count, truncated: false };
}

/** Counts a node's children, without reading anything about them. */
export function countChildren(
  parent: unknown,
  first: unknown,
  next: unknown,
  limit = 64,
): ChildCount {
  return walkChildren(parent, first, next, undefined, limit);
}

/** The children's element unique ids, in element order. */
export interface ChildIds extends ChildCount {
  ids: number[];
}

/**
 * Reads the children's unique ids in element order.
 *
 * This is what makes a reorder measurable: comparing ids before and after a
 * model change says whether the same elements are still there and in what order,
 * which reading row indices out of the model cannot show, because the model is
 * the thing that was changed.
 */
export function childIds(
  parent: unknown,
  first: unknown,
  next: unknown,
  readId: ((node: unknown) => number | undefined) | undefined,
  limit = 64,
): ChildIds {
  const ids: number[] = [];
  const walked = walkChildren(
    parent,
    first,
    next,
    readId
      ? child => {
        const id = readId(child);
        if (typeof id === "number") ids.push(id);
      }
      : undefined,
    limit,
  );
  return { ids, ...walked };
}

/**
 * One row observation, captured so a later snapshot can be compared against it.
 *
 * The question every later stage asks is "did this row survive", and only a
 * value read before the change can answer it, so key, the model item the row was
 * built from, and element identity are all sampled here.
 */
export interface RowObservation {
  key: string;
  /**
   * The model item the row was built from.
   *
   * Recorded from the model rather than read back out of the element tree: there
   * is no Element PAPI to read a text node's content, and calling one that does
   * not exist would record an absence as a measurement.
   */
  item: string;
  /** Element unique id, when the host exposes `__GetElementUniqueID`. */
  id?: number;
}

/**
 * Samples the model's rows.
 *
 * `readItem` and `readId` are supplied by the caller so this stays free of any
 * host access of its own: it only arranges what the caller could already read.
 */
export function observeRows<T>(
  rows: readonly { key: unknown; item: T; node: unknown }[],
  readItem: (item: T) => string,
  readId: ((node: unknown) => number | undefined) | undefined,
): RowObservation[] {
  return rows.map(row => {
    const note: RowObservation = {
      key: describeKey(row.key),
      item: readItem(row.item),
    };
    const id = readId?.(row.node);
    if (typeof id === "number") note.id = id;
    return note;
  });
}

/** A stable, printable form of a row key, whatever the key is. */
export function describeKey(key: unknown): string {
  if (typeof key === "string") return key;
  if (typeof key === "number" || typeof key === "boolean" || typeof key === "bigint") {
    return String(key);
  }
  if (key === null) return "null";
  if (key === undefined) return "undefined";
  return safeTag(key);
}

function safeTag(value: unknown): string {
  try {
    const tag = Object.prototype.toString.call(value);
    return typeof tag === "string" ? tag : "unknown";
  } catch {
    return "unprintable";
  }
}

/** The order of `key` strings, as a plain array, for comparing two snapshots. */
export function keyOrder(rowNotes: readonly { key: string }[]): string[] {
  return rowNotes.map(row => row.key);
}

/** What comparing a row snapshot taken before a change with one taken after shows. */
export interface SnapshotDiff {
  /** Keys present in both snapshots, in the after order. */
  kept: string[];
  /** Keys that were in the before snapshot and are gone from the after one. */
  released: string[];
  /** Keys that only exist in the after snapshot. */
  added: string[];
  /**
   * Kept keys whose element unique id changed, so the row's node was rebuilt.
   * Empty when the host exposes no unique ids, which leaves the question open.
   */
  rebuilt: string[];
  /** Kept keys whose element unique id is unchanged, so the node survived. */
  sameNode: string[];
  /** Whether any identity comparison could be made at all. */
  identityMeasured: boolean;
}

/**
 * Compares two row snapshots.
 *
 * "Preserved keyed identity" means a key that exists on both sides still points
 * at the same element, so this reports identity through the unique id rather
 * than through position: a row that moved is exactly the interesting case, and
 * comparing positions would call it a rebuild.
 */
export function diffSnapshots(
  before: readonly RowObservation[],
  after: readonly RowObservation[],
): SnapshotDiff {
  const previous = new Map(before.map(row => [row.key, row]));
  const diff: SnapshotDiff = {
    kept: [],
    released: [],
    added: [],
    rebuilt: [],
    sameNode: [],
    identityMeasured: false,
  };

  for (const row of after) {
    const prior = previous.get(row.key);
    if (!prior) {
      diff.added.push(row.key);
      continue;
    }
    previous.delete(row.key);
    diff.kept.push(row.key);
    // Only a comparable pair of ids can say whether the element survived. When
    // the host exposes no unique ids the question stays open rather than being
    // answered from a guess.
    if (prior.id !== undefined && row.id !== undefined) {
      diff.identityMeasured = true;
      if (prior.id === row.id) diff.sameNode.push(row.key);
      else diff.rebuilt.push(row.key);
    }
  }

  diff.released = [...previous.keys()];
  return diff;
}

/**
 * Builds the report line for one list-probe stage.
 *
 * Prefixed `[solid-lynx lp]` so a shared runner can pick list stages out of a
 * console log next to the stylesheet probe's `[solid-lynx ss]` lines. The native
 * console bridge drops everything after the first newline, so the payload is
 * serialized onto one line.
 */
export function listReportLine(
  stage: string,
  payload: Record<string, unknown>,
): string {
  return `[solid-lynx lp] ${JSON.stringify({ probe: "native-list-papi", stage, ...payload })}`;
}

/**
 * Every own global name that mentions a list.
 *
 * Recorded because the probed names may not be the whole surface: a related
 * operation would change what can be measured at all, and this is the only way
 * to see it without inferring anything from a name.
 */
export function findListRelatedGlobals(scope: object): string[] {
  let names: string[];
  try {
    names = Object.getOwnPropertyNames(scope);
  } catch {
    return [];
  }
  return names.filter(name => /list/i.test(name)).sort();
}

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  try {
    return String(error);
  } catch {
    return "unprintable error";
  }
}
