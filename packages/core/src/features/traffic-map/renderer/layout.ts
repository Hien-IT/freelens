/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

/** The size of a node's card, and the gaps between the columns and the rows of cards. */
export const cardWidth = 200;
export const cardHeight = 56;
export const columnGap = 110;
export const rowGap = 22;

export interface LayoutEdge {
  source: string;
  target: string;
  /** An edge without a known direction does not decide which column is left of which. */
  undirected?: boolean;
}

export interface LayoutPoint {
  /** The centre of the card. */
  x: number;
  y: number;
  column: number;
}

/**
 * Places the nodes in columns, left to right in the direction of the traffic:
 * a node that nobody calls is in the first column, and every other node is one
 * column right of the furthest of its callers. A cycle is broken where the
 * walk meets it. Within a column the nodes are ordered by the rows of their
 * neighbours, which keeps edges short and crossing less.
 *
 * `sortKey` orders the nodes before any sweep and breaks ties, which keeps
 * the layout the same across refreshes of the same traffic.
 */
export function layoutColumns(
  nodes: readonly string[],
  edges: readonly LayoutEdge[],
  sortKey: (id: string) => string = (id) => id,
): Map<string, LayoutPoint> {
  const outgoing = new Map<string, string[]>(nodes.map((id) => [id, []]));
  const incomingCount = new Map<string, number>(nodes.map((id) => [id, 0]));

  for (const edge of edges) {
    if (edge.undirected || edge.source === edge.target) continue;
    if (!outgoing.has(edge.source) || !outgoing.has(edge.target)) continue;

    outgoing.get(edge.source)!.push(edge.target);
    incomingCount.set(edge.target, incomingCount.get(edge.target)! + 1);
  }

  // Drop the edges that close a cycle: a depth-first walk from the nodes that
  // nobody calls, then from the rest, removes every edge back to a node on the
  // current path.
  const sorted = [...nodes].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const state = new Map<string, "open" | "done">();
  const forward = new Map<string, string[]>(nodes.map((id) => [id, []]));

  const visit = (start: string) => {
    const stack: { id: string; next: number }[] = [{ id: start, next: 0 }];

    state.set(start, "open");

    while (stack.length) {
      const frame = stack[stack.length - 1];
      const targets = outgoing.get(frame.id)!;

      if (frame.next >= targets.length) {
        state.set(frame.id, "done");
        stack.pop();
        continue;
      }

      const target = targets[frame.next++];
      const targetState = state.get(target);

      if (targetState === "open") continue;

      forward.get(frame.id)!.push(target);

      if (!targetState) {
        state.set(target, "open");
        stack.push({ id: target, next: 0 });
      }
    }
  };

  for (const id of sorted.filter((candidate) => incomingCount.get(candidate) === 0)) {
    if (!state.has(id)) visit(id);
  }

  for (const id of sorted) {
    if (!state.has(id)) visit(id);
  }

  // The column of a node: the longest path to it, in the order of a
  // topological sort of the edges that are left.
  const indegree = new Map<string, number>(nodes.map((id) => [id, 0]));

  for (const targets of forward.values()) {
    for (const target of targets) indegree.set(target, indegree.get(target)! + 1);
  }

  const column = new Map<string, number>(nodes.map((id) => [id, 0]));
  const queue = sorted.filter((id) => indegree.get(id) === 0);

  while (queue.length) {
    const id = queue.shift()!;

    for (const target of forward.get(id)!) {
      column.set(target, Math.max(column.get(target)!, column.get(id)! + 1));
      indegree.set(target, indegree.get(target)! - 1);

      if (indegree.get(target) === 0) queue.push(target);
    }
  }

  // Pull a node that nobody calls next to the nearest of what it calls, so a
  // client does not hang far left of its only target.
  for (const id of sorted) {
    const targets = forward.get(id)!;

    if (targets.length && incomingCount.get(id) === 0) {
      const nearest = Math.min(...targets.map((target) => column.get(target)!));

      column.set(id, Math.max(0, nearest - 1));
    }
  }

  const columns: string[][] = [];

  for (const id of sorted) {
    const index = column.get(id)!;

    (columns[index] ??= []).push(id);
  }

  // Order the columns by the average row of the neighbours, a few sweeps
  // left to right and back.
  const neighbours = new Map<string, string[]>(nodes.map((id) => [id, []]));

  for (const edge of edges) {
    if (!neighbours.has(edge.source) || !neighbours.has(edge.target) || edge.source === edge.target) continue;

    neighbours.get(edge.source)!.push(edge.target);
    neighbours.get(edge.target)!.push(edge.source);
  }

  const row = new Map<string, number>();
  const placeRows = () => columns.forEach((ids) => ids?.forEach((id, index) => row.set(id, index)));
  const sweep = (ids: string[], side: number) => {
    const barycenter = (id: string) => {
      const rows = neighbours
        .get(id)!
        .filter((other) => column.get(other) === column.get(id)! + side)
        .map((other) => row.get(other)!);

      return rows.length ? rows.reduce((sum, value) => sum + value, 0) / rows.length : row.get(id)!;
    };
    const keys = new Map(ids.map((id) => [id, barycenter(id)]));

    ids.sort((a, b) => keys.get(a)! - keys.get(b)! || sortKey(a).localeCompare(sortKey(b)));
  };

  placeRows();

  for (let pass = 0; pass < 8; pass++) {
    for (let index = 1; index < columns.length; index++) {
      if (columns[index]) {
        sweep(columns[index], -1);
        placeRows();
      }
    }

    for (let index = columns.length - 2; index >= 0; index--) {
      if (columns[index]) {
        sweep(columns[index], 1);
        placeRows();
      }
    }
  }

  const points = new Map<string, LayoutPoint>();

  columns.forEach((ids, index) => {
    if (!ids) return;

    const height = ids.length * cardHeight + (ids.length - 1) * rowGap;

    ids.forEach((id, position) => {
      points.set(id, {
        column: index,
        x: index * (cardWidth + columnGap),
        y: -height / 2 + cardHeight / 2 + position * (cardHeight + rowGap),
      });
    });
  });

  return points;
}

/** How far apart, at most, the ends of the edges on one side of a card spread, and the gap between two ends. */
const anchorSpan = cardHeight - 16;
const anchorGap = 10;

/** Offsets from the middle of a card side for `count` edge ends, top to bottom. */
export function spreadAnchors(count: number): number[] {
  if (count <= 1) return [0];

  const step = Math.min(anchorGap, anchorSpan / (count - 1));
  const total = step * (count - 1);

  return Array.from({ length: count }, (_, index) => -total / 2 + index * step);
}

export interface AnchoredEdge {
  id: string;
  source: string;
  target: string;
}

/**
 * Where each edge meets its cards, as offsets from the middle of a card side.
 * An edge leaves from the right side of its source and reaches the left side
 * of its target, or its right side when it runs back to the left. The ends on
 * one side of a card are spread along it in the order of the cards at their
 * other end, so the edges into a busy card do not meet in one point, and
 * cross less.
 */
export function edgeAnchors(
  points: ReadonlyMap<string, LayoutPoint>,
  edges: readonly AnchoredEdge[],
): Map<string, { source: number; target: number }> {
  const yOf = (id: string) => points.get(id)?.y ?? 0;
  const xOf = (id: string) => points.get(id)?.x ?? 0;
  const sides = new Map<string, { edge: string; end: "source" | "target"; otherY: number }[]>();
  const addEnd = (side: string, edge: string, end: "source" | "target", otherY: number) =>
    sides.set(side, [...(sides.get(side) ?? []), { edge, end, otherY }]);

  for (const edge of edges) {
    addEnd(`${edge.source}|right`, edge.id, "source", yOf(edge.target));
    addEnd(
      `${edge.target}|${xOf(edge.target) > xOf(edge.source) ? "left" : "right"}`,
      edge.id,
      "target",
      yOf(edge.source),
    );
  }

  const anchors = new Map<string, { source: number; target: number }>();

  for (const ends of sides.values()) {
    const sorted = [...ends].sort((a, b) => a.otherY - b.otherY || a.edge.localeCompare(b.edge));
    const offsets = spreadAnchors(sorted.length);

    sorted.forEach((end, index) => {
      const anchor = anchors.get(end.edge) ?? { source: 0, target: 0 };

      anchor[end.end] = offsets[index];
      anchors.set(end.edge, anchor);
    });
  }

  return anchors;
}
