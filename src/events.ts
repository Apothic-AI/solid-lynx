const lynxEventPattern = /^(?:(main-thread|background):)?(global-bind|bind|catch|capture-bind|capture-catch):?([A-Za-z]+)$/;

const eventTypes: Record<string, string> = {
  bind: "bindEvent",
  catch: "catchEvent",
  "capture-bind": "capture-bind",
  "capture-catch": "capture-catch",
  "global-bind": "global-bindEvent",
};

export interface ParsedEventProp {
  type: string;
  name: string;
  namespace?: string;
}

export function parseEventProp(
  property: string,
  transformEventNames: boolean,
): ParsedEventProp | undefined {
  if (property.startsWith("on:")) {
    return {
      type: "bindEvent",
      name: property.slice(3).toLowerCase(),
    };
  }

  let name = property;
  if (transformEventNames && /^on[A-Za-z][A-Za-z]*$/.test(property)) {
    const event = property.slice(2);
    if (event === "Click") name = "bindtap";
    else if (event === "CatchTap") name = "catchtap";
    else name = `bind${event.toLowerCase()}`;
  }

  const match = lynxEventPattern.exec(name);
  if (!match) return undefined;

  const [, namespace, bindingType, eventName] = match;
  return {
    type: eventTypes[bindingType]!,
    name: eventName.toLowerCase(),
    ...(namespace ? { namespace } : {}),
  };
}

export function eventBindType(type: string): number {
  switch (type) {
    case "bindEvent": return 1;
    case "catchEvent": return 4;
    case "capture-bind": return 2;
    case "capture-catch": return 3;
    case "global-bindEvent": return 5;
    default: return 1;
  }
}

export function isCaptureEvent(type: string): boolean {
  return type === "capture-bind" || type === "capture-catch";
}

export interface EventListenerOptions {
  bind_type: number;
  capture?: boolean;
  closure_type?: number;
}

/**
 * Options for `__AddEventListener` and `__RemoveEventListener`.
 *
 * Both operations must receive the same options because hosts file a listener
 * in a slot keyed by event name, binding type, and pass, and removal clears
 * the slot computed from these options. The capture pass is requested both
 * through `bind_type` and through `capture`, because a host that keys the pass
 * off `capture` for plain callbacks would otherwise register a capture
 * binding as a bubble one.
 */
export function eventListenerOptions(
  type: string,
  namespace?: string,
): EventListenerOptions {
  const bindType = eventBindType(type);
  return {
    bind_type: bindType,
    ...(isCaptureEvent(type) ? { capture: true } : {}),
    ...(namespace === "main-thread" ? { closure_type: 2 } : {}),
  };
}
