import { getOwner } from "solid-js";

const rendererByOwner = new WeakMap<object, object>();

export function registerLynxRendererForCurrentOwner(renderer: object): void {
  const owner = getOwner();
  if (!owner) {
    throw new Error("Solid Lynx rendering requires an active Solid root");
  }
  rendererByOwner.set(owner, renderer);
}

export function getLynxRendererForCurrentOwner(): object | undefined {
  let owner = getOwner();
  while (owner) {
    const renderer = rendererByOwner.get(owner);
    if (renderer) return renderer;
    owner = owner.owner;
  }
  return undefined;
}
