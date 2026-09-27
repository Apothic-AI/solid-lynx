const lynxEventPattern = /^(?:(main-thread|background):)?(global-bind|bind|catch|capture-bind|capture-catch)([A-Za-z]+)$/;

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
