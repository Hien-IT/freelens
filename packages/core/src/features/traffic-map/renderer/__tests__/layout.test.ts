/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { describe, expect, it } from "vitest";
import { cardHeight, layoutColumns, rowGap } from "../layout";

const columnsOf = (points: ReturnType<typeof layoutColumns>) =>
  Object.fromEntries([...points].map(([id, point]) => [id, point.column]));

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
});
