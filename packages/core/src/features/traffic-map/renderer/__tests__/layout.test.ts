/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { describe, expect, it } from "vitest";
import {
  cardHeight,
  cardWidth,
  columnGap,
  edgeAnchors,
  edgeLanes,
  edgeRoute,
  fitTransform,
  labelRect,
  layoutColumns,
  placeLabels,
  rowGap,
  spreadAnchors,
  subColumnGap,
} from "../layout";

import type { LayoutPoint, RouteSegment } from "../layout";

const columnsOf = (points: ReturnType<typeof layoutColumns>) =>
  Object.fromEntries([...points].map(([id, point]) => [id, point.column]));

const clients = Array.from({ length: 32 }, (_, index) => `client-${String(index).padStart(2, "0")}`);

/** 32 clients of one API, which calls a database and a cache; the database writes to a disk. */
const tall = {
  nodes: [...clients, "api", "db", "cache", "disk"],
  edges: [
    ...clients.map((source) => ({ source, target: "api" })),
    { source: "api", target: "db" },
    { source: "api", target: "cache" },
    { source: "db", target: "disk" },
  ],
};

/** One web front calling 32 services, which wraps the column of its targets. */
const services = Array.from({ length: 32 }, (_, index) => `service-${String(index).padStart(2, "0")}`);
const fanOut = {
  nodes: ["web", ...services],
  edges: services.map((target) => ({ source: "web", target })),
};

const aspectOf = (points: Iterable<LayoutPoint>) => {
  const all = [...points];
  const width = Math.max(...all.map((point) => point.blockRight)) - Math.min(...all.map((point) => point.blockLeft));
  const height =
    Math.max(...all.map((point) => point.y + cardHeight / 2)) -
    Math.min(...all.map((point) => point.y - cardHeight / 2));

  return width / height;
};

const inColumn = (points: ReturnType<typeof layoutColumns>, column: number) =>
  [...points.values()].filter((point) => point.column === column);

/** The lane of a route is clear of every card of a block when it is not within the vertical span of any of them. */
const clearOfCards = (laneY: number, cards: readonly LayoutPoint[]) =>
  cards.every((card) => laneY <= card.y - cardHeight / 2 || laneY >= card.y + cardHeight / 2);

const lineAt = (segments: readonly RouteSegment[], index: number) => {
  const segment = segments[index];

  expect(segment.type).toBe("line");

  return segment;
};

describe("layoutColumns", () => {
  it("puts callers left of what they call", () => {
    const points = layoutColumns(
      ["db", "api", "web", "Internet"],
      [
        { source: "Internet", target: "web" },
        { source: "web", target: "api" },
        { source: "api", target: "db" },
      ],
    );

    expect(columnsOf(points)).toEqual({ Internet: 0, web: 1, api: 2, db: 3 });
    expect(points.get("web")!.x).toBeLessThan(points.get("api")!.x);
  });

  it("puts a node one column right of its furthest caller", () => {
    const points = layoutColumns(
      ["web", "api", "cache"],
      [
        { source: "web", target: "api" },
        { source: "web", target: "cache" },
        { source: "api", target: "cache" },
      ],
    );

    expect(columnsOf(points)).toEqual({ web: 0, api: 1, cache: 2 });
  });

  it("pulls a client next to the nearest of what it calls", () => {
    const points = layoutColumns(
      ["web", "api", "db", "job"],
      [
        { source: "web", target: "api" },
        { source: "api", target: "db" },
        { source: "job", target: "db" },
      ],
    );

    expect(columnsOf(points).job).toBe(1);
  });

  it("breaks a cycle instead of looping", () => {
    const points = layoutColumns(
      ["a", "b", "c"],
      [
        { source: "a", target: "b" },
        { source: "b", target: "c" },
        { source: "c", target: "a" },
      ],
    );

    expect(new Set(Object.values(columnsOf(points)))).toEqual(new Set([0, 1, 2]));
  });

  it("does not order the columns by an edge of unknown direction", () => {
    const points = layoutColumns(["a", "b"], [{ source: "a", target: "b", undirected: true }]);

    expect(columnsOf(points)).toEqual({ a: 0, b: 0 });
  });

  it("stacks a column around the middle without overlap", () => {
    const points = layoutColumns(
      ["web", "a", "b", "c"],
      ["a", "b", "c"].map((target) => ({ source: "web", target })),
    );
    const rows = ["a", "b", "c"].map((id) => points.get(id)!.y).sort((x, y) => x - y);

    expect(rows[1] - rows[0]).toBe(cardHeight + rowGap);
    expect(rows[0] + rows[2]).toBeCloseTo(0);
    expect(points.get("web")!.y).toBeCloseTo(0);
  });

  it("is the same for the same traffic", () => {
    const edges = [
      { source: "web", target: "api" },
      { source: "web", target: "auth" },
      { source: "api", target: "db" },
    ];

    expect(layoutColumns(["db", "web", "auth", "api"], edges)).toEqual(
      layoutColumns(["api", "auth", "web", "db"], edges),
    );
  });

  it("places a small graph in plain columns, each its own block", () => {
    const points = layoutColumns(
      ["Internet", "web", "api"],
      [
        { source: "Internet", target: "web" },
        { source: "web", target: "api" },
      ],
    );
    const step = cardWidth + columnGap;

    expect(points.get("web")).toEqual({
      column: 1,
      x: step,
      y: 0,
      blockLeft: step - cardWidth / 2,
      blockRight: step + cardWidth / 2,
    });
    expect(points.get("api")!.x).toBe(2 * step);
  });
});

describe("layoutColumns of a tall column", () => {
  const points = layoutColumns(tall.nodes, tall.edges);
  const first = inColumn(points, 0);

  it("wraps the column into sub-columns of balanced rows", () => {
    const subColumns = new Set(first.map((point) => point.x));
    const rows = new Set(first.map((point) => point.y));

    expect(first).toHaveLength(32);
    expect(subColumns.size).toBeGreaterThan(1);
    expect(rows.size).toBe(Math.ceil(32 / subColumns.size));
    expect(columnsOf(points)).toMatchObject({ api: 1, db: 2, cache: 2, disk: 3 });
  });

  it("does not overlap two cards", () => {
    const all = [...points.values()];

    for (const [index, a] of all.entries()) {
      for (const b of all.slice(index + 1)) {
        expect(Math.abs(a.x - b.x) >= cardWidth || Math.abs(a.y - b.y) >= cardHeight).toBe(true);
      }
    }
  });

  it("keeps every column right of the blocks of the columns before it", () => {
    const all = [...points.values()];

    for (const point of all) {
      for (const earlier of all.filter((other) => other.column < point.column)) {
        expect(point.x - cardWidth / 2).toBeGreaterThan(earlier.blockRight);
      }
    }
  });

  it("gives every card of a column the block that encloses the column", () => {
    for (const column of [0, 1, 2, 3]) {
      const cards = inColumn(points, column);
      const [{ blockLeft, blockRight }] = cards;

      for (const card of cards) {
        expect(card.blockLeft).toBe(blockLeft);
        expect(card.blockRight).toBe(blockRight);
        expect(card.x - cardWidth / 2).toBeGreaterThanOrEqual(blockLeft);
        expect(card.x + cardWidth / 2).toBeLessThanOrEqual(blockRight);
      }

      expect(Math.min(...cards.map((card) => card.x - cardWidth / 2))).toBe(blockLeft);
      expect(Math.max(...cards.map((card) => card.x + cardWidth / 2))).toBe(blockRight);
    }
  });

  it("brings the layout closer to twice as wide as it is tall", () => {
    const unwrapped = {
      width: 4 * cardWidth + 3 * columnGap,
      height: 32 * cardHeight + 31 * rowGap,
    };
    const distance = (aspect: number) => Math.abs(Math.log(aspect / 2));

    expect(distance(aspectOf(points.values()))).toBeLessThan(distance(unwrapped.width / unwrapped.height));
  });

  it("is the same for the same traffic in another order", () => {
    expect(layoutColumns([...tall.nodes].reverse(), [...tall.edges].reverse())).toEqual(points);
  });
});

describe("edgeRoute", () => {
  it("joins the outer sides of two plain columns with the single curve it always drew", () => {
    const points = layoutColumns(["web", "api"], [{ source: "web", target: "api" }]);
    const web = points.get("web")!;
    const api = points.get("api")!;
    const route = edgeRoute(web, api, 5, -5);
    const start = { x: web.x + cardWidth / 2, y: web.y + 5 };
    const end = { x: api.x - cardWidth / 2, y: api.y - 5 };
    const bend = Math.max(40, (end.x - start.x) / 2);

    expect(route.start).toEqual(start);
    expect(route.segments).toEqual([
      { type: "curve", c1: { x: start.x + bend, y: start.y }, c2: { x: end.x - bend, y: end.y }, to: end },
    ]);
    expect(route.arrowFrom).toEqual({ x: end.x - bend, y: end.y });
    expect(route.end).toEqual(end);
  });

  it("offers places for the label near each end of the curve between the blocks", () => {
    const points = layoutColumns(["web", "api"], [{ source: "web", target: "api" }]);
    const route = edgeRoute(points.get("web")!, points.get("api")!);

    expect(route.labelNearSource.x).toBeLessThan(route.labelAt.x);
    expect(route.labelAt.x).toBeLessThan(route.labelNearTarget.x);
    expect(route.labelNearSource.x).toBeGreaterThan(route.start.x);
    expect(route.labelNearTarget.x).toBeLessThan(route.end.x);
  });

  it("leads an edge of an inner sub-column through a lane between the rows to the right of its block", () => {
    const points = layoutColumns(tall.nodes, tall.edges);
    const block = inColumn(points, 0);
    const inner = block.find((point) => point.x + cardWidth / 2 < point.blockRight)!;
    const route = edgeRoute(inner, points.get("api")!);
    const [toLane] = route.segments;
    const lane = lineAt(route.segments, 1);

    expect(toLane.type).toBe("curve");
    expect(toLane.to.x).toBe(inner.x + cardWidth / 2 + subColumnGap);
    expect(lane.to).toEqual({ x: inner.blockRight, y: toLane.to.y });
    expect(clearOfCards(lane.to.y, block)).toBe(true);
    expect(route.segments[2].type).toBe("curve");
  });

  it("leads an edge into an inner sub-column from the left of its block through a lane", () => {
    const points = layoutColumns(fanOut.nodes, fanOut.edges);
    const block = inColumn(points, 1);
    const inner = block.find((point) => point.x - cardWidth / 2 > point.blockLeft)!;
    const route = edgeRoute(points.get("web")!, inner, 0, 4);
    const [between] = route.segments;
    const lane = lineAt(route.segments, 1);

    expect(between.to).toEqual({ x: inner.blockLeft, y: between.to.y });
    expect(lane.to).toEqual({ x: inner.x - cardWidth / 2 - subColumnGap, y: between.to.y });
    expect(clearOfCards(lane.to.y, block)).toBe(true);
    expect(route.end).toEqual({ x: inner.x - cardWidth / 2, y: inner.y + 4 });
    expect(route.arrowFrom.y).toBe(route.end.y);
  });

  it("brings an edge that runs back into the right side of its target", () => {
    const plain = layoutColumns(["a", "b"], [{ source: "a", target: "b" }]);
    const back = edgeRoute(plain.get("b")!, plain.get("a")!);

    expect(back.segments).toHaveLength(1);
    expect(back.end.x).toBe(plain.get("a")!.x + cardWidth / 2);

    const points = layoutColumns(tall.nodes, tall.edges);
    const block = inColumn(points, 0);
    const inner = block.find((point) => point.x + cardWidth / 2 < point.blockRight)!;
    const route = edgeRoute(points.get("api")!, inner);
    const [between] = route.segments;
    const lane = lineAt(route.segments, 1);

    expect(between.to.x).toBe(inner.blockRight);
    expect(lane.to.x).toBe(inner.x + cardWidth / 2 + subColumnGap);
    expect(clearOfCards(lane.to.y, block)).toBe(true);
    expect(route.end.x).toBe(inner.x + cardWidth / 2);
  });
});

describe("edgeLanes", () => {
  const points = layoutColumns(tall.nodes, tall.edges);
  const ends = tall.edges.map((edge) => ({ id: `${edge.source}->${edge.target}`, ...edge }));
  const anchors = edgeAnchors(points, ends);
  const lanes = edgeLanes(points, ends, anchors);
  const block = inColumn(points, 0);
  const api = points.get("api")!;
  const top = Math.min(...block.map((point) => point.y));
  const bottom = Math.max(...block.map((point) => point.y));

  /** The wires of the inner clients, by the centre line of the lane each runs in. */
  const wiresByLane = () => {
    const byLane = new Map<number, { id: string; point: LayoutPoint; offset: number; run: number }[]>();

    for (const id of clients) {
      const point = points.get(id)!;

      if (point.x + cardWidth / 2 === point.blockRight) continue;

      const centre = point.y + (api.y >= point.y ? 1 : -1) * (cardHeight / 2 + rowGap / 2);
      const run = point.blockRight - (point.x + cardWidth / 2 + subColumnGap);

      byLane.set(centre, [...(byLane.get(centre) ?? []), { id, point, offset: lanes.get(`${id}->api`)!.source, run }]);
    }

    return byLane;
  };

  it("gives each wire of a lane between two rows its own line, within the gap", () => {
    const byLane = wiresByLane();

    expect(byLane.size).toBeGreaterThan(1);

    for (const [centre, wires] of byLane) {
      const ys = wires.map((wire) => centre + wire.offset).sort((a, b) => a - b);

      expect(centre).toBeGreaterThan(top);
      expect(centre).toBeLessThan(bottom);

      for (let index = 1; index < ys.length; index++) {
        expect(ys[index] - ys[index - 1]).toBeGreaterThanOrEqual(1);
      }

      for (const y of ys) {
        expect(Math.abs(y - centre)).toBeLessThanOrEqual((rowGap - 8) / 2);
        expect(clearOfCards(y, block)).toBe(true);
      }
    }
  });

  it("orders a lane: the row above first, shorter run on top, then the row below, longer run first", () => {
    const byLane = wiresByLane();
    const shared = [...byLane.entries()].find(([, wires]) => new Set(wires.map((wire) => wire.point.y)).size === 2);

    expect(new Set(block.map((point) => point.x)).size).toBe(3);
    expect(shared).toBeDefined();

    for (const [centre, wires] of byLane) {
      const ordered = [...wires].sort((a, b) => a.offset - b.offset);
      const above = ordered.filter((wire) => wire.point.y < centre);
      const below = ordered.filter((wire) => wire.point.y > centre);

      expect(ordered).toEqual([...above, ...below]);
      expect(above.map((wire) => wire.run)).toEqual(above.map((wire) => wire.run).sort((a, b) => a - b));
      expect(below.map((wire) => wire.run)).toEqual(below.map((wire) => wire.run).sort((a, b) => b - a));
    }
  });

  it("puts a route on its wire, and gives an end in no lane none", () => {
    const [centre, [wire]] = [...wiresByLane().entries()][0];
    const route = edgeRoute(wire.point, api, anchors.get(`${wire.id}->api`)!.source, 0, wire.offset, 0);
    const [toLane, lane] = route.segments;

    expect(toLane.to.y).toBe(centre + wire.offset);
    expect(lane.to).toEqual({ x: wire.point.blockRight, y: centre + wire.offset });
    expect(lanes.get("api->db")).toEqual({ source: 0, target: 0 });
    expect(
      lanes.get(`${clients.find((id) => points.get(id)!.x + cardWidth / 2 === points.get(id)!.blockRight)}->api`),
    ).toEqual({
      source: 0,
      target: 0,
    });
  });

  it("grows the wires above the first row away from the block", () => {
    const blockOf = {
      column: 0,
      blockLeft: -cardWidth / 2,
      blockRight: -cardWidth / 2 + 3 * cardWidth + 2 * subColumnGap,
    };
    const manual = new Map<string, LayoutPoint>([
      ["a", { ...blockOf, x: 0, y: 0 }],
      ["b", { ...blockOf, x: cardWidth + subColumnGap, y: 0 }],
      ["c", { ...blockOf, x: 2 * (cardWidth + subColumnGap), y: 0 }],
      ["up", { column: 1, x: 1000, y: -500, blockLeft: 900, blockRight: 1100 }],
    ]);
    const edges = ["a", "b", "c"].map((source) => ({ id: source, source, target: "up" }));
    const offsets = edgeLanes(manual, edges);
    const route = edgeRoute(manual.get("a")!, manual.get("up")!, 0, 0, offsets.get("a")!.source, 0);

    // a runs further in the lane than b, so it lies further from the row; c, in the outer sub-column, uses none.
    expect(edges.map((edge) => offsets.get(edge.id)!.source)).toEqual([-5, 0, 0]);
    expect(route.segments[1].to.y).toBe(-(cardHeight / 2 + rowGap / 2) - 5);
  });
});

describe("labelRect", () => {
  const at = { x: 100, y: 50 };

  it("starts a label near the source at its point, ends one near the target there, and centres one in the middle", () => {
    expect(labelRect(at, 40, 16, "start")).toEqual({ x: 100, y: 42, width: 40, height: 16 });
    expect(labelRect(at, 40, 16, "end")).toEqual({ x: 60, y: 42, width: 40, height: 16 });
    expect(labelRect(at, 40, 16, "centre")).toEqual({ x: 80, y: 42, width: 40, height: 16 });
  });
});

describe("placeLabels", () => {
  const label = (id: string, volume: number, x: number) => ({ id, volume, x, y: 0, width: 50, height: 16 });

  it("keeps the busiest of overlapping labels", () => {
    expect(placeLabels([label("small", 1, 0), label("big", 9, 20)]).map((kept) => kept.id)).toEqual(["big"]);
  });

  it("keeps every label that overlaps none", () => {
    expect(placeLabels([label("a", 1, 0), label("b", 2, 60), label("c", 3, 120)]).map((kept) => kept.id)).toEqual([
      "c",
      "b",
      "a",
    ]);
  });

  it("does not depend on the order of the candidates", () => {
    const candidates = [label("a", 5, 0), label("b", 5, 30), label("c", 7, 60), label("d", 1, 200)];
    const ids = (kept: { id: string }[]) => kept.map((one) => one.id).sort();

    expect(ids(placeLabels([...candidates].reverse()))).toEqual(ids(placeLabels(candidates)));
    expect(ids(placeLabels(candidates))).toEqual(["a", "c", "d"]);
  });
});

describe("fitTransform", () => {
  const viewport = { width: 1000, height: 500 };
  const options = { padding: 48, minZoom: 0.1, maxZoom: 1.25 };

  /** Every card, drawn at the zoom about the centre, lies inside the viewport but for the padding. */
  const expectCardsInside = (points: readonly LayoutPoint[]) => {
    const { x, y, k } = fitTransform(points, viewport, options);
    const toScreen = (graphX: number, graphY: number) => ({
      x: (graphX - x) * k + viewport.width / 2,
      y: (graphY - y) * k + viewport.height / 2,
    });

    for (const point of points) {
      const topLeft = toScreen(point.x - cardWidth / 2, point.y - cardHeight / 2);
      const bottomRight = toScreen(point.x + cardWidth / 2, point.y + cardHeight / 2);

      expect(topLeft.x).toBeGreaterThanOrEqual(options.padding - 1e-6);
      expect(topLeft.y).toBeGreaterThanOrEqual(options.padding - 1e-6);
      expect(bottomRight.x).toBeLessThanOrEqual(viewport.width - options.padding + 1e-6);
      expect(bottomRight.y).toBeLessThanOrEqual(viewport.height - options.padding + 1e-6);
    }

    return k;
  };

  it("fits the whole cards of a wide wrapped layout, the outer ones included", () => {
    const k = expectCardsInside([...layoutColumns(tall.nodes, tall.edges).values()]);

    expect(k).toBeGreaterThan(options.minZoom);
    expect(k).toBeLessThan(options.maxZoom);
  });

  it("does not blow a single card up past the most a fit zooms in", () => {
    const k = expectCardsInside([...layoutColumns(["web"], []).values()]);

    expect(k).toBe(options.maxZoom);
  });
});

describe("edgeAnchors", () => {
  it("spreads the ends on one side of a card in the order of the cards at the other end", () => {
    const edges = ["a", "b", "c"].map((source) => ({ id: `${source}->sink`, source, target: "sink" }));
    const points = layoutColumns(["a", "b", "c", "sink"], edges);
    const anchors = edgeAnchors(points, edges);
    const bySourceRow = [...edges].sort((x, y) => points.get(x.source)!.y - points.get(y.source)!.y);

    expect(bySourceRow.map((edge) => anchors.get(edge.id)!.target)).toEqual(spreadAnchors(3));
    expect(edges.map((edge) => anchors.get(edge.id)!.source)).toEqual([0, 0, 0]);
  });

  it("keeps the ends within the card, closer together on a busy side", () => {
    expect(spreadAnchors(1)).toEqual([0]);
    expect(spreadAnchors(3)).toEqual([-10, 0, 10]);

    const busy = spreadAnchors(40);

    expect(busy[0]).toBeGreaterThanOrEqual(-cardHeight / 2);
    expect(busy.at(-1)).toBeLessThanOrEqual(cardHeight / 2);
  });

  it("brings an edge that runs back to the left to the right side of its target", () => {
    const edges = [
      { id: "a->b", source: "a", target: "b" },
      { id: "b->a", source: "b", target: "a" },
    ];
    const points = layoutColumns(["a", "b"], edges);
    const anchors = edgeAnchors(points, edges);

    // a's right side holds its own edge out and the edge back from b.
    expect([anchors.get("a->b")!.source, anchors.get("b->a")!.target].sort((x, y) => x - y)).toEqual([-5, 5]);
  });

  it("brings an edge between two cards of one wrapped column to the right side of its target", () => {
    const points = layoutColumns(tall.nodes, tall.edges);
    // The top row of a wrapped column is full.
    const topRow = Math.min(...inColumn(points, 0).map((point) => point.y));
    const [left, right] = clients
      .map((id) => [id, points.get(id)!] as const)
      .filter(([, point]) => point.y === topRow)
      .sort((a, b) => a[1].x - b[1].x)
      .map(([id]) => id);
    const edges = [
      { id: "beside", source: left, target: right },
      { id: "out", source: right, target: "api" },
    ];
    const anchors = edgeAnchors(points, edges);

    // The right side of the target holds its own edge out and the edge from its neighbour.
    expect(points.get(left)!.x).toBeLessThan(points.get(right)!.x);
    expect([anchors.get("beside")!.target, anchors.get("out")!.source].sort((x, y) => x - y)).toEqual([-5, 5]);
  });
});
