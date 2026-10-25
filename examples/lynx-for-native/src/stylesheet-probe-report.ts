/**
 * Recording helpers for the native stylesheet PAPI probe.
 *
 * Everything here is pure and side-effect free so the probe card can use it at
 * runtime and a host-free unit test can check that it never throws on the
 * values a native runtime hands back. The probe depends on being able to
 * describe anything at all: a helper that threw on some handle shape would kill
 * the card and lose the evidence gathered so far.
 */

/** The stylesheet operations the A03 is reported to expose. */
export const STYLESHEET_PAPI_NAMES = [
  "__LoadStyleSheet",
  "__AdoptStyleSheet",
  "__ReplaceStyleSheets",
] as const;

export type StylesheetPapiName = (typeof STYLESHEET_PAPI_NAMES)[number];

export interface ProbeValue {
  kind: "undefined" | "null" | "boolean" | "number" | "string" | "symbol" | "bigint"
  | "function" | "object";
  /** Present for primitives that are safe to print. */
  value?: string | number | boolean;
  /** `Object.prototype.toString` output, which does not need property access. */
  tag?: string;
  /** Own enumerable keys, when they can be read without throwing. */
  keys?: string[];
  /** Why the value could not be described further. */
  error?: string;
}

export interface ProbeFunction {
  typeof: string;
  /** `fn.length`: the declared parameter count, not a signature. */
  arity?: number;
  name?: string;
  /** `String(fn)`, truncated; native code usually says so. */
  source?: string;
  hasPrototype?: boolean;
  ownPropertyNames?: string[];
  error?: string;
}

export interface ProbeCall {
  /** What was passed, described the same way as a return value. */
  input: ProbeValue[];
  /** The returned value, described. `undefined` when the call threw. */
  returned?: ProbeValue;
  threw?: { name: string; message: string };
}

export interface ProbeOperation {
  name: string;
  function: ProbeFunction;
  calls: ProbeCall[];
}

const MAX_SOURCE = 200;
const MAX_KEYS = 16;

/**
 * Describes a value without ever throwing.
 *
 * A native handle is an opaque object whose property access can fail, so both
 * the tag and the key list are guarded and a failure is recorded rather than
 * propagated.
 */
export function describeValue(value: unknown): ProbeValue {
  if (value === null) return { kind: "null" };
  if (value === undefined) return { kind: "undefined" };

  const type = typeof value;
  if (type === "boolean" || type === "number" || type === "string" || type === "bigint") {
    return { kind: type, value: value as string | number | boolean };
  }
  if (type === "symbol") return { kind: "symbol" };
  if (type === "function") {
    const fn = value as (...args: unknown[]) => unknown;
    return { kind: "function", tag: safe(() => Object.prototype.toString.call(value)) };
  }

  let tag: string | undefined;
  try {
    tag = Object.prototype.toString.call(value);
  } catch (error) {
    return { kind: "object", error: describeError(error) };
  }

  let keys: string[] | undefined;
  try {
    keys = Object.keys(value as object).slice(0, MAX_KEYS);
  } catch (error) {
    return { kind: "object", tag, error: describeError(error) };
  }

  return { kind: "object", tag, ...(keys ? { keys } : {}) };
}

function safe<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/**
 * Describes a global's callability, recording only what the runtime reports.
 *
 * `arity` is `fn.length`, the declared parameter count. It is evidence about the
 * binding, not about the signature: a native binding can report any arity
 * regardless of what it actually requires, so it is recorded rather than
 * interpreted.
 */
export function describeFunction(value: unknown): ProbeFunction {
  if (typeof value !== "function") return { typeof: typeof value };

  const fn = value as (...args: unknown[]) => unknown;
  const description: ProbeFunction = { typeof: "function" };

  const arity = safe(() => fn.length);
  if (typeof arity === "number") description.arity = arity;

  const name = safe(() => fn.name);
  if (typeof name === "string") description.name = name;

  const source = safe(() => String(fn));
  if (typeof source === "string") description.source = source.slice(0, MAX_SOURCE);

  const prototype = safe(() => (fn as { prototype?: unknown }).prototype);
  if (prototype !== undefined) description.hasPrototype = Boolean(prototype);
  else description.hasPrototype = false;

  const own = safe(() => Object.getOwnPropertyNames(fn));
  if (own) description.ownPropertyNames = own.slice(0, MAX_KEYS);

  return description;
}

/**
 * Calls a probed function and records what happened.
 *
 * Both a return value and a throw are outcomes, so neither is lost, and a throw
 * from inside the host is recorded rather than allowed to end the probe.
 */
export function safeCall(
  fn: unknown,
  args: readonly unknown[],
): ProbeCall {
  const call: ProbeCall = { input: args.map(describeValue) };
  if (typeof fn !== "function") {
    call.threw = { name: "TypeError", message: "not a function" };
    return call;
  }
  try {
    call.returned = describeValue(
      (fn as (...rest: unknown[]) => unknown)(...args),
    );
  } catch (error) {
    // The name and the message are kept apart: a host error message often
    // repeats its own type, and prefixing it again would put "TypeError:
    // TypeError: ..." into the recorded evidence.
    const thrown = error as { name?: unknown; message?: unknown } | null;
    const name = safe(() => (typeof thrown?.name === "string" ? thrown.name : "Error"))
      ?? "Error";
    const message = safe(() => (typeof thrown?.message === "string"
      ? thrown.message
      : String(error)))
      ?? String(error);
    call.threw = { name, message };
  }
  return call;
}

/**
 * Every own global name that mentions a style or sheet.
 *
 * Recorded because the three probed names may not be the whole stylesheet
 * surface: a related operation would change what can be probed at all, and this
 * is the only way to see it without inferring anything.
 */
export function findStyleRelatedGlobals(scope: object): string[] {
  const names = safe(() => Object.getOwnPropertyNames(scope)) ?? [];
  return names.filter(name => /style|sheet|css/i.test(name)).sort();
}

/** Builds the report line for one probe stage. */
export function reportLine(stage: string, payload: Record<string, unknown>): string {
  return `[solid-lynx ss] ${JSON.stringify({ probe: "native-stylesheet-papi", stage, ...payload })}`;
}