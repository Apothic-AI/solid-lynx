import { createSignal, type Accessor } from "solid-js";

import type { LynxHost, LynxListCallbacks, LynxNode } from "./host.js";
import type { LynxRenderer } from "./renderer.js";

/**
 * One materialized row.
 *
 * `index` is an accessor rather than a number because a row that keeps its key
 * while moving to another index stays the same row, exactly as Solid's `For`
 * behaves. Reading it inside the row's own render scope updates the row in
 * place instead of tearing it down and rebuilding it.
 */
export interface LynxListRow<T> {
  /** Identity this row is filed under, from `getKey`. */
  readonly key: unknown;
  readonly index: Accessor<number>;
  readonly item: T;
  /** The node this row rendered, a direct child of the list element. */
  readonly node: LynxNode;
}

export interface LynxListOptions<T> {
  /**
   * Element that receives the list element. Defaults to the page the root owns,
   * which puts the list under the root's CSS-id assignment and disposal.
   */
  parent?: LynxNode;
  /**
   * The current rows.
   *
   * Read lazily inside every row callback, so a host that asks for a cell at
   * any time sees the current model instead of a captured snapshot.
   */
  items: () => readonly T[];
  /**
   * Builds one row.
   *
   * Called once per key: the same key never rebuilds a row, and a row is
   * rebuilt only when the item behind its key is replaced. `index` is the
   * accessor described on {@link LynxListRow}.
   */
  children: (item: T, index: Accessor<number>) => LynxNode;
  /**
   * Stable identity for a row. Defaults to the item itself, which is the
   * identity Solid's `For` uses.
   */
  getKey?: (item: T, index: number) => unknown;
}

export interface LynxList<T> {
  /** The list element created through `__CreateList`. */
  readonly list: LynxNode;
  /** Materialized rows, in list order. */
  readonly rows: readonly LynxListRow<T>[];
  /**
   * Materializes the row at `index` and returns its node, or `undefined` when
   * the index is not in the model.
   *
   * This is the work `componentAtIndex` performs, exposed so a host that never
   * calls its own callback can still be driven. A row whose key is already
   * materialized keeps its node, so materializing the same key twice creates
   * nothing the second time.
   *
   * @throws if the index is not a non-negative integer, or the list is disposed.
   */
  materialize(index: number): LynxNode | undefined;
  /**
   * Reconciles materialized rows with the model and re-installs the row
   * callbacks through `__UpdateListCallbacks`.
   *
   * Call it when the model changes. A row whose key left the model is released
   * here; because the callbacks read the model lazily they never serve a stale
   * row even without this call.
   */
  update(): void;
  /**
   * Releases every row and detaches the callbacks, in that order.
   *
   * Idempotent. After it returns, a host still holding the list cannot
   * materialize rows into the disposed model.
   */
  dispose(): void;
  readonly disposed: boolean;
}

interface RowState<T> extends LynxListRow<T> {
  setIndex: (value: number) => void;
  dispose: () => void;
}

/**
 * Creates a list wired to the Lynx list PAPI.
 *
 * The list element comes from `__CreateList(parentComponentUniqueId,
 * componentAtIndex, enqueueComponent)`, and every model change re-installs the
 * pair through `__UpdateListCallbacks`.
 *
 * Row selection stays the host's: the host decides which `cellIndex` to ask
 * for, and when. This model answers exactly one request — materialize the row
 * at an index — and does not claim to recycle cells itself.
 *
 * `componentAtIndex` answers with the row's unique id, because that is how the
 * host finds the element it should position. `enqueueComponent` names the
 * element the host is removing, so it releases that row's scope and leaves the
 * removal to the host. `operationId` and `enableReuseNotification` are host
 * bookkeeping this model gives no meaning to.
 *
 * Create a list through `LynxRoot.createList()` rather than calling this
 * directly: the root owns the host, the page, and the disposal that releases
 * the list along with everything else it rendered.
 */
export function createLynxList<T>(
  host: LynxHost<LynxNode>,
  renderer: LynxRenderer<LynxNode>,
  defaultParent: LynxNode,
  options: LynxListOptions<T>,
): LynxList<T> {
  if (!host.createList || !host.updateListCallbacks) {
    throw new Error(
      "solid-lynx cannot virtualize a list: this Lynx host does not implement Element PAPI"
        + " __CreateList() and __UpdateListCallbacks(). Render the rows with <For> instead.",
    );
  }

  const rows = new Map<unknown, RowState<T>>();
  const getKey = options.getKey ?? ((item: T) => item as unknown);
  let generation = 0;
  let disposed = false;

  const requireLive = (): void => {
    if (disposed) throw new Error("solid-lynx: this list has been disposed");
  };

  const releaseRow = (key: unknown, options: { removeNode: boolean }): void => {
    const row = rows.get(key);
    if (!row) return;
    rows.delete(key);
    // Disposing the row's scope runs its cleanups, then the node itself has to
    // go: `solid-js/universal` mounts a plain node with `insertNode` and
    // registers no cleanup for it, so a disposed row would otherwise stay in
    // the list as a dead cell. This is the same reason a root removes the nodes
    // it owns after its renderer is disposed.
    row.dispose();
    // A host removing the element itself removes the node right after calling
    // `enqueueComponent`, so removing it here too would make that second
    // removal throw.
    if (options.removeNode && host.getParentNode(row.node) === list) {
      host.removeNode(list, row.node);
    }
  };

  /**
   * Releases a row's scope for a removal the host performs itself.
   *
   * The host's own `removeChild` never reaches this host's `removeNode`, so the
   * event registrations the row filed would stay attached to the element it
   * just orphaned. Releasing them here is what makes that disposal complete.
   */
  const forgetRow = (row: RowState<T>): void => {
    rows.delete(row.key);
    host.detachListeners?.(row.node);
    row.dispose();
  };

  const ordered = (): RowState<T>[] =>
    [...rows.values()].sort((a, b) => a.index() - b.index());

  /**
   * Places a row so the list's children run in ascending index order.
   *
   * The anchor is the first materialized row whose own index is greater, not
   * "the row at position `index`": the positions a host asks for are model
   * indices, and while rows are missing the position among materialized rows is
   * not the index they hold. Asking for cell 5 and then cell 3 has to leave the
   * list as 3, 5.
   */
  const placeRow = (row: RowState<T>, index: number): void => {
    const anchor = ordered().find(entry => entry !== row && entry.index() > index)?.node;
    // Already in place when the row sits directly before its anchor, or last
    // when it has none, which is compared against the host's sibling order
    // rather than against the row map.
    const next = host.getNextSibling(row.node);
    if (anchor === undefined ? next === undefined : next === anchor) return;
    host.insertNode(list, row.node, anchor);
  };

  const materialize = (index: number): LynxNode | undefined => {
    requireLive();
    if (!Number.isInteger(index) || index < 0) {
      throw new RangeError(
        `solid-lynx: a list row index must be a non-negative integer, got ${String(index)}`,
      );
    }

    const items = options.items();
    if (index >= items.length) {
      // The host asked for a cell the model no longer covers. Release the row
      // that was there if its key left the model entirely, and report that
      // nothing was materialized rather than throwing inside a host callback.
      const stale = ordered().find(row => row.index() === index);
      if (stale && !items.some((entry, at) => getKey(entry, at) === stale.key)) {
        releaseRow(stale.key, { removeNode: true });
      }
      return undefined;
    }

    const item = items[index];
    const key = getKey(item, index);
    const existing = rows.get(key);
    if (existing && existing.item === item) {
      existing.setIndex(index);
      placeRow(existing, index);
      return existing.node;
    }
    // The key survived but its item did not, so the row content is stale and is
    // rebuilt under the same key.
    if (existing) releaseRow(key, { removeNode: true });

    const [index_, setIndex] = createSignal(index);
    let node: LynxNode | undefined;
    const dispose = renderer.render(() => {
      node = options.children(item, index_);
      return node;
    }, list);
    if (!node) {
      // Nothing was returned, so there is nothing to file or to release later.
      dispose();
      return undefined;
    }
    const row: RowState<T> = { key, item, index: index_, node, setIndex, dispose };
    rows.set(key, row);
    // A fresh row is mounted at the end of the list, so it still has to be
    // placed at the index it was asked for.
    placeRow(row, index);
    return node;
  };

  /**
   * Builds the callback pair for one model generation.
   *
   * A callback from a superseded generation does nothing, so a host still
   * holding an old pair cannot materialize rows the current model does not have.
   */
  const callbacksFor = (at: number): LynxListCallbacks<LynxNode> => ({
    componentAtIndex(_list, _listId, cellIndex, _operationId, _enableReuseNotification) {
      if (disposed || at !== generation) return undefined;
      const node = materialize(cellIndex);
      // The host places the row itself, looking the element up through this id,
      // so returning it is part of answering the request.
      return node === undefined ? undefined : host.getUniqueId?.(node);
    },
    enqueueComponent(_list, _listId, sign) {
      if (disposed || at !== generation) return;
      // `sign` is the unique id of the element the host is removing, so this
      // releases the row's scope and leaves the node removal to the host.
      if (!host.getUniqueId) return;
      const row = ordered().find(entry => host.getUniqueId!(entry.node) === sign);
      if (row) forgetRow(row);
    },
  });

  const update = (): void => {
    requireLive();
    const items = options.items();
    const indexByKey = new Map<unknown, number>();
    items.forEach((item, index) => indexByKey.set(getKey(item, index), index));

    for (const key of [...rows.keys()]) {
      if (!indexByKey.has(key)) releaseRow(key, { removeNode: true });
    }

    // A surviving key moves to its new index, and the list is reordered to
    // match, without another host request: the row keeps its node and its Solid
    // scope, and `children` is not called again. A key whose item was replaced
    // is the one case that cannot be moved, because its content came from the
    // old item, so it is rebuilt under the same key.
    for (const [key, index] of [...indexByKey].sort((a, b) => a[1] - b[1])) {
      const row = rows.get(key);
      if (!row) continue;
      if (row.item !== items[index]) {
        releaseRow(key, { removeNode: true });
        materialize(index);
        continue;
      }
      if (row.index() !== index) row.setIndex(index);
      placeRow(row, index);
    }

    // A new generation, so the pair the host holds is replaced instead of
    // being mutated behind its back.
    generation += 1;
    host.updateListCallbacks!(list, callbacksFor(generation));
  };

  const dispose = (): void => {
    if (disposed) return;
    // Invalidate every generation before releasing rows, so a callback running
    // mid-teardown cannot repopulate the list.
    disposed = true;
    for (const key of [...rows.keys()]) releaseRow(key, { removeNode: true });
    host.updateListCallbacks!(list, callbacksFor(generation));
    host.flush();
  };

  const list = host.createList!(callbacksFor(generation));
  host.insertNode(options.parent ?? defaultParent, list);

  return {
    list,
    get rows() {
      return ordered();
    },
    materialize,
    update,
    dispose,
    get disposed() {
      return disposed;
    },
  };
}