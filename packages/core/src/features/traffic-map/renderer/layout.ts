/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

/** The size of a node's card, and the gaps between the columns and the rows of cards. */
export const cardWidth = 200;
export const cardHeight = 56;
export const columnGap = 110;
export const rowGap = 22;
/** The gap between the sub-columns that a tall column wraps into. */
export const subColumnGap = 48;

/** The width over the height that a layout aims at, so that a fit to the screen keeps the cards readable. */
const targetAspect = 2;
/** A column is never wrapped into fewer rows than this. */
const minWrapRows = 6;
/** Below this, two coordinates are the same. */
const epsilon = 1e-6;

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
  /** The column of the node in the direction of the traffic, whatever sub-column it is drawn in. */
  column: number;
  /** The left and the right edge of the block of the node's column: its sub-columns, or the column alone. */
  blockLeft: number;
  blockRight: number;
}

/** How a column of `count` cards is drawn with at most `limit` rows: in sub-columns of balanced rows. */
function wrapOf(count: number, limit: number): { subColumns: number; rows: number } {
  const subColumns = Math.max(1, Math.ceil(count / limit));

  return { subColumns, rows: Math.ceil(count / subColumns) };
}

const blockWidthOf = (subColumns: number) => subColumns * cardWidth + (subColumns - 1) * subColumnGap;
const blockHeightOf = (rows: number) => rows * cardHeight + (rows - 1) * rowGap;

/** The size of the layout of columns of these counts with at most `limit` rows; an empty column keeps its place. */
function layoutSize(counts: readonly number[], limit: number): { width: number; height: number } {
  let width = columnGap * Math.max(0, counts.length - 1);
  let height = 0;

  for (const count of counts) {
    const { subColumns, rows } = wrapOf(count, limit);

    width += blockWidthOf(subColumns);
    height = Math.max(height, count ? blockHeightOf(rows) : 0);
  }

  return { width, height };
}

/**
 * The most rows a column may have: unlimited when the layout is wide enough,
 * else the limit whose layout comes closest to the aimed-at aspect, the larger
 * limit on a tie. It depends on the counts alone, not on the screen.
 */
function rowLimitOf(counts: readonly number[]): number {
  const tallest = Math.max(0, ...counts);
  const distance = (limit: number) => {
    const { width, height } = layoutSize(counts, limit);

    return height > 0 ? Math.abs(Math.log(width / height / targetAspect)) : 0;
  };
  const unwrapped = layoutSize(counts, Number.POSITIVE_INFINITY);

  if (tallest <= minWrapRows || unwrapped.width / unwrapped.height >= targetAspect) {
    return Number.POSITIVE_INFINITY;
  }

  // Not wrapping at all is a candidate too, so a wrap is only taken when it brings the layout closer.
  let best = Number.POSITIVE_INFINITY;
  let bestDistance = distance(tallest);

  for (let limit = tallest - 1; limit >= minWrapRows; limit--) {
    const candidate = distance(limit);

    if (candidate < bestDistance - epsilon) {
      best = limit;
      bestDistance = candidate;
    }
  }

  return best;
}

/**
 * Places the nodes in columns, left to right in the direction of the traffic:
 * a node that nobody calls is in the first column, and every other node is one
 * column right of the furthest of its callers. A cycle is broken where the
 * walk meets it. Within a column the nodes are ordered by the rows of their
 * neighbours, which keeps edges short and crossing less.
 *
 * A column too tall for the layout to fit a screen readably wraps into
 * sub-columns, row by row in that order, with its rows aligned: the gaps
 * between the rows are the lanes that edges from and to its inner cards run in.
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
  const counts = Array.from({ length: columns.length }, (_, index) => columns[index]?.length ?? 0);
  const limit = rowLimitOf(counts);
  let blockLeft = -cardWidth / 2;

  for (let index = 0; index < columns.length; index++) {
    const ids = columns[index] ?? [];
    const { subColumns, rows } = wrapOf(ids.length, limit);
    const blockRight = blockLeft + blockWidthOf(subColumns);
    const height = blockHeightOf(rows);

    ids.forEach((id, position) => {
      const subColumn = position % subColumns;
      const rowIndex = Math.floor(position / subColumns);

      points.set(id, {
        column: index,
        x: blockLeft + cardWidth / 2 + subColumn * (cardWidth + subColumnGap),
        y: -height / 2 + cardHeight / 2 + rowIndex * (cardHeight + rowGap),
        blockLeft,
        blockRight,
      });
    });

    blockLeft = blockRight + columnGap;
  }

  return points;
}

export interface RoutePoint {
  x: number;
  y: number;
}

export type RouteSegment =
  | { type: "line"; to: RoutePoint }
  | { type: "curve"; c1: RoutePoint; c2: RoutePoint; to: RoutePoint };

export interface EdgeRoute {
  start: RoutePoint;
  segments: RouteSegment[];
  /** Where the label of the edge goes: the middle of its long curve between the two blocks. */
  labelAt: RoutePoint;
  /** Points of that curve near its source and near its target, where the edges of one card are apart. */
  labelNearSource: RoutePoint;
  labelNearTarget: RoutePoint;
  /** The direction of the last stretch into the target, for the arrow head. */
  arrowFrom: RoutePoint;
  end: RoutePoint;
}

const halfCard = cardWidth / 2;
const isRightmost = (point: LayoutPoint) => Math.abs(point.x + halfCard - point.blockRight) < epsilon;
const isLeftmost = (point: LayoutPoint) => Math.abs(point.x - halfCard - point.blockLeft) < epsilon;

type CurveSegment = Extract<RouteSegment, { type: "curve" }>;
type Side = "left" | "right";

/** The lane an end of an edge runs in, as {@link laneOfEnd} finds it. */
interface LaneOfEnd {
  /** The centre line of the lane. */
  y: number;
  /** The lane is below the card: in the gap after its row, toward an other end lower down. */
  below: boolean;
  /** How far the end runs in the lane: between the gap beside its card and the side of the block. */
  run: number;
}

/**
 * The lane that an end of an edge runs in, on the side of its card that the
 * end meets: none when the card is in the outer sub-column on that side, else
 * the gap between the rows below the card when the other end is not higher,
 * else the gap above it. {@link edgeRoute} and {@link edgeLanes} both decide
 * by it, so that they cannot disagree.
 */
function laneOfEnd(point: LayoutPoint, other: LayoutPoint, side: Side): LaneOfEnd | undefined {
  if (side === "left" ? isLeftmost(point) : isRightmost(point)) {
    return undefined;
  }

  const below = other.y >= point.y;

  return {
    y: point.y + (below ? 1 : -1) * (cardHeight / 2 + rowGap / 2),
    below,
    run:
      side === "left"
        ? point.x - halfCard - subColumnGap - point.blockLeft
        : point.blockRight - (point.x + halfCard + subColumnGap),
  };
}

/** The side of the target that an edge reaches: the left of a target further right, else the right. */
const targetSideOf = (source: LayoutPoint, target: LayoutPoint): Side =>
  target.column > source.column ? "left" : "right";

/** An S-curve from one point to another, with horizontal tangents at both, turning halfway across. */
function sCurve(from: RoutePoint, to: RoutePoint): CurveSegment {
  const middle = (from.x + to.x) / 2;

  return { type: "curve", c1: { x: middle, y: from.y }, c2: { x: middle, y: to.y }, to };
}

/** The point at `t` of a cubic curve. */
function curveAt(from: RoutePoint, { c1, c2, to }: CurveSegment, t: number): RoutePoint {
  const u = 1 - t;
  const at = (a: number, b: number, c: number, d: number) =>
    u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;

  return { x: at(from.x, c1.x, c2.x, to.x), y: at(from.y, c1.y, c2.y, to.y) };
}

/**
 * Where an edge leaves its block on the right: the right side of the card in
 * the outer sub-column, else the end of the lane it reaches from the card
 * through the gap after it, on its own wire `laneOffset` from the lane's
 * centre, and the segments that get it there.
 */
function outPort(point: LayoutPoint, other: LayoutPoint, offset: number, laneOffset: number) {
  const side = { x: point.x + halfCard, y: point.y + offset };
  const lane = laneOfEnd(point, other, "right");

  if (!lane) {
    return { start: side, port: side, segments: [] as RouteSegment[] };
  }

  const wire = lane.y + laneOffset;
  const inGap = { x: side.x + subColumnGap, y: wire };
  const port = { x: point.blockRight, y: wire };

  return { start: side, port, segments: [sCurve(side, inGap), { type: "line", to: port }] as RouteSegment[] };
}

/**
 * Where an edge reaches the block of its card on one side: that side of the
 * card when it is in the outer sub-column there, else the end of the lane it
 * follows, on its own wire, to the gap beside the card, and the segments from
 * there into the card, the last of which is the curve into it.
 */
function inPort(point: LayoutPoint, other: LayoutPoint, offset: number, laneOffset: number, onSide: Side) {
  const direction = onSide === "left" ? -1 : 1;
  const side = { x: point.x + direction * halfCard, y: point.y + offset };
  const lane = laneOfEnd(point, other, onSide);

  if (!lane) {
    return { port: side, segments: [] as RouteSegment[], last: undefined };
  }

  const wire = lane.y + laneOffset;
  const inGap = { x: side.x + direction * subColumnGap, y: wire };
  const last = sCurve(inGap, side);

  return {
    port: { x: onSide === "left" ? point.blockLeft : point.blockRight, y: wire },
    segments: [{ type: "line", to: inGap }, last] as RouteSegment[],
    last,
  };
}

/**
 * The path of an edge: out of the right side of its source to the left side
 * of its target further right, or around the right sides when the target is
 * not further right, as in a cycle. An edge of a card in an inner sub-column
 * runs in the gap between the rows to the side of its block, on the wire that
 * {@link edgeLanes} gives it there.
 */
export function edgeRoute(
  source: LayoutPoint,
  target: LayoutPoint,
  sourceOffset = 0,
  targetOffset = 0,
  sourceLane = 0,
  targetLane = 0,
): EdgeRoute {
  const targetSide = targetSideOf(source, target);
  const forward = targetSide === "left";
  const out = outPort(source, target, sourceOffset, sourceLane);
  const into = inPort(target, source, targetOffset, targetLane, targetSide);
  const from = out.port;
  const to = into.port;
  // Between the blocks: one curve with horizontal tangents, bulging right for an edge that runs back.
  const bend = forward ? Math.max(40, (to.x - from.x) / 2) : 60 + Math.abs(from.x - to.x) / 4;
  const main: CurveSegment = {
    type: "curve",
    c1: { x: from.x + bend, y: from.y },
    c2: { x: forward ? to.x - bend : to.x + bend, y: to.y },
    to,
  };
  // The curve into the card: the S-curve from the lane, else the curve between the blocks.
  const last = into.last ?? main;

  return {
    start: out.start,
    segments: [...out.segments, main, ...into.segments],
    labelAt: {
      x: (from.x + 3 * main.c1.x + 3 * main.c2.x + to.x) / 8,
      y: (from.y + 3 * main.c1.y + 3 * main.c2.y + to.y) / 8,
    },
    labelNearSource: curveAt(from, main, 0.18),
    labelNearTarget: curveAt(from, main, 0.82),
    arrowFrom: last.c2,
    end: last.to,
  };
}

/** The distance between two wires of a lane, at most; a crowded lane between two rows packs them closer. */
const laneStep = 5;
/** What a lane between two rows keeps free next to each row. */
const laneMargin = 4;

/**
 * The wire of each end of an edge that runs in a lane, as an offset from the
 * centre line of that lane, by edge id; 0 for an end that runs in none. The
 * wires of one lane, in one block between two rows, are ordered top to
 * bottom: those of the row above first, the shorter run on top, then those of
 * the row below, the longer run first. A wire that runs further in the lane
 * lies further from its row, so a wire that joins or leaves the lane crosses
 * none of those that stay. Ends of one card with the same run follow the
 * order of their anchors on the card side, so their curves do not cross.
 *
 * Between two rows the wires spread around the centre line, within the gap;
 * above the first row and below the last they start at the centre line and
 * grow away from the block.
 */
export function edgeLanes(
  points: ReadonlyMap<string, LayoutPoint>,
  edges: readonly AnchoredEdge[],
  anchors?: ReadonlyMap<string, { source: number; target: number }>,
): Map<string, { source: number; target: number }> {
  interface Wire extends LaneOfEnd {
    edge: string;
    end: "source" | "target";
    anchor: number;
  }

  const lanes = new Map<string, Wire[]>();
  const rowsOf = new Map<number, { top: number; bottom: number }>();

  for (const point of points.values()) {
    const rows = rowsOf.get(point.column);

    rowsOf.set(point.column, {
      top: Math.min(rows?.top ?? point.y, point.y),
      bottom: Math.max(rows?.bottom ?? point.y, point.y),
    });
  }

  const addWire = (point: LayoutPoint, lane: LaneOfEnd | undefined, wire: Omit<Wire, keyof LaneOfEnd>) => {
    if (!lane) return;

    const key = `${point.column}|${Math.round(lane.y)}`;
    const group = lanes.get(key);

    if (group) {
      group.push({ ...lane, ...wire });
    } else {
      lanes.set(key, [{ ...lane, ...wire }]);
    }
  };

  for (const edge of edges) {
    const source = points.get(edge.source);
    const target = points.get(edge.target);

    if (!source || !target) continue;

    const anchor = anchors?.get(edge.id);

    addWire(source, laneOfEnd(source, target, "right"), {
      edge: edge.id,
      end: "source",
      anchor: anchor?.source ?? 0,
    });
    addWire(target, laneOfEnd(target, source, targetSideOf(source, target)), {
      edge: edge.id,
      end: "target",
      anchor: anchor?.target ?? 0,
    });
  }

  const offsets = new Map<string, { source: number; target: number }>(
    edges.map((edge) => [edge.id, { source: 0, target: 0 }]),
  );

  for (const [key, wires] of lanes) {
    const rows = rowsOf.get(Number(key.slice(0, key.indexOf("|"))))!;
    const sorted = [...wires].sort(
      (a, b) =>
        Number(b.below) - Number(a.below) ||
        (a.below ? a.run - b.run : b.run - a.run) ||
        a.anchor - b.anchor ||
        a.edge.localeCompare(b.edge) ||
        a.end.localeCompare(b.end),
    );
    const count = sorted.length;
    const laneY = sorted[0].y;
    const outside = laneY < rows.top || laneY > rows.bottom;
    const step = outside || count === 1 ? laneStep : Math.min(laneStep, (rowGap - 2 * laneMargin) / (count - 1));

    sorted.forEach((wire, index) => {
      const offset = !outside
        ? -((count - 1) * step) / 2 + index * step
        : laneY < rows.top
          ? (index - (count - 1)) * step
          : index * step;
      const entry = offsets.get(wire.edge) ?? { source: 0, target: 0 };

      entry[wire.end] = offset;
      offsets.set(wire.edge, entry);
    });
  }

  return offsets;
}

/** A label that may be drawn: its rectangle in graph coordinates, and the volume of its edge. */
export interface LabelCandidate {
  id: string;
  volume: number;
  /** The top left corner of the rectangle. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where a label sits on its point: starting there, ending there, or centred on it. */
export type LabelAnchor = "start" | "end" | "centre";

/**
 * The rectangle of a label of this size at a point, centred vertically: a
 * label near the source of an edge starts at the point and extends right, one
 * near the target ends at it and extends left, so that neither covers the card
 * beside it; a label in the middle of an edge is centred on it.
 */
export function labelRect(
  at: RoutePoint,
  width: number,
  height: number,
  anchor: LabelAnchor,
): { x: number; y: number; width: number; height: number } {
  const x = anchor === "start" ? at.x : anchor === "end" ? at.x - width : at.x - width / 2;

  return { x, y: at.y - height / 2, width, height };
}

const overlap = (a: LabelCandidate, b: LabelCandidate) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * The labels to draw: the busiest first, ties by id, each one kept unless it
 * overlaps one kept before it. The order of the candidates does not matter.
 */
export function placeLabels<Candidate extends LabelCandidate>(candidates: readonly Candidate[]): Candidate[] {
  const placed: Candidate[] = [];
  const sorted = [...candidates].sort((a, b) => b.volume - a.volume || a.id.localeCompare(b.id));

  for (const candidate of sorted) {
    if (!placed.some((other) => overlap(other, candidate))) {
      placed.push(candidate);
    }
  }

  return placed;
}

export interface FitOptions {
  /** The room left free on each side of the viewport, in screen pixels. */
  padding: number;
  minZoom: number;
  maxZoom: number;
}

/**
 * The centre and the zoom that fit the cards centred at `points` into a
 * viewport: their whole rectangles, not only their centres, with `padding`
 * free on every side, the zoom clamped so that a small graph is not blown up.
 */
export function fitTransform(
  points: Iterable<RoutePoint>,
  viewport: { width: number; height: number },
  { padding, minZoom, maxZoom }: FitOptions,
): { x: number; y: number; k: number } {
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (const { x, y } of points) {
    left = Math.min(left, x - cardWidth / 2);
    right = Math.max(right, x + cardWidth / 2);
    top = Math.min(top, y - cardHeight / 2);
    bottom = Math.max(bottom, y + cardHeight / 2);
  }

  if (left > right) {
    return { x: 0, y: 0, k: Math.min(maxZoom, Math.max(minZoom, 1)) };
  }

  const scale = Math.min(
    (viewport.width - 2 * padding) / (right - left),
    (viewport.height - 2 * padding) / (bottom - top),
  );

  return {
    x: (left + right) / 2,
    y: (top + bottom) / 2,
    k: Math.min(maxZoom, Math.max(minZoom, scale)),
  };
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
  // By column, not by x: two cards of one wrapped column are side by side, and an edge between them runs back.
  const columnOf = (id: string) => points.get(id)?.column ?? 0;
  const sides = new Map<string, { edge: string; end: "source" | "target"; otherY: number }[]>();
  const addEnd = (side: string, edge: string, end: "source" | "target", otherY: number) =>
    sides.set(side, [...(sides.get(side) ?? []), { edge, end, otherY }]);

  for (const edge of edges) {
    addEnd(`${edge.source}|right`, edge.id, "source", yOf(edge.target));
    addEnd(
      `${edge.target}|${columnOf(edge.target) > columnOf(edge.source) ? "left" : "right"}`,
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
