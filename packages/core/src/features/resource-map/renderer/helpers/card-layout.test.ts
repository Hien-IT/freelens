/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { describe, expect, it } from "vitest";
import { cardHeight, fitTransform } from "../../../traffic-map/renderer/layout";
import { layoutCards, readableFit, releaseColors, releasePalette } from "./card-layout";

import type { KubeObject } from "@freelensapp/kube-object";

import type { MapCard, MapEdge } from "./card-graph";

const columnOfKind: Record<string, number> = { Service: 1, Deployment: 2, Secret: 3 };

const card = (kind: string, name: string, linked = true): MapCard => ({
  id: `${kind}/shop/${name}`,
  kind,
  name,
  namespace: "shop",
  object: {} as KubeObject,
  column: columnOfKind[kind],
  pods: [],
  consumers: 0,
  linked,
});

const edge = (source: MapCard, target: MapCard): MapEdge => ({
  id: `${source.id}->${target.id}`,
  source: source.id,
  target: target.id,
});

// Two Services of two workloads, a secret both use, and two secrets nothing uses. No Ingress.
const api = card("Service", "api");
const web = card("Service", "web");
const apiWorkload = card("Deployment", "api");
const webWorkload = card("Deployment", "web");
const credentials = card("Secret", "credentials");
const orphan = card("Secret", "aaa-orphan", false);
const spare = card("Secret", "spare", false);
const cards = [api, web, apiWorkload, webWorkload, credentials, orphan, spare];
const edges = [
  edge(api, apiWorkload),
  edge(web, webWorkload),
  edge(apiWorkload, credentials),
  edge(webWorkload, credentials),
];

describe("layoutCards", () => {
  const layout = layoutCards(cards, edges);
  const point = (each: MapCard) => layout.points.get(each.id) as { x: number; y: number; column: number };

  it("puts the columns of the kinds left to right, an empty one taking no room", () => {
    expect(point(api).x).toBe(point(web).x);
    expect(point(api).x).toBeLessThan(point(apiWorkload).x);
    expect(point(apiWorkload).x).toBeLessThan(point(credentials).x);
    // The Services start where the Ingresses would.
    expect(Math.min(...[...layout.points.values()].map((each) => each.blockLeft))).toBe(
      layout.points.get(api.id)?.blockLeft,
    );
  });

  it("puts a card without an edge after the others of its column, and aligns the tops of the columns", () => {
    expect(point(orphan).y).toBeGreaterThan(point(credentials).y);
    expect(point(spare).y).toBeGreaterThan(point(credentials).y);
    const tops = [1, 2, 3].map((column) =>
      Math.min(...[...layout.points.values()].filter((each) => each.column === column).map((each) => each.y)),
    );
    expect(new Set(tops).size).toBe(1);
  });

  it("names every column that has cards, with their count, above its top card", () => {
    expect(layout.headers.map(({ label }) => label)).toEqual(["Services · 2", "Workloads · 2", "Config & storage · 3"]);
    for (const header of layout.headers) {
      expect(header.y).toBeLessThan(point(api).y - cardHeight / 2);
    }
  });

  it("routes every edge from the right side of its source to the left side of its target", () => {
    expect([...layout.routes.keys()].sort()).toEqual(edges.map(({ id }) => id).sort());
    const route = layout.routes.get(edges[0].id);
    expect(route?.start.x).toBeLessThan(route?.end.x ?? 0);
  });

  it("fits the headers too", () => {
    const top = Math.min(...layout.fitPoints.map((each) => each.y - cardHeight / 2));

    expect(top).toBeLessThan(Math.min(...layout.headers.map((header) => header.y)) - 8);
  });
});

describe("readableFit", () => {
  const options = { padding: 48, minZoom: 0.1, maxZoom: 1.25 };
  // A row of cards 200 wide every 300, from x = 0.
  const row = (count: number) => Array.from({ length: count }, (_, index) => ({ x: index * 300, y: 0 }));

  it("fits a map that a readable zoom shows whole, as a plain fit does", () => {
    const points = row(3);
    const viewport = { width: 1600, height: 1000 };

    expect(readableFit(points, viewport, options)).toEqual(
      fitTransform(points, viewport, { padding: 48, minZoom: 0.1, maxZoom: 1.25 }),
    );
  });

  it("raises the zoom of a map too large to read to the readable zoom of 0.8, and shows its top left corner", () => {
    const points = [...row(20), { x: 0, y: 400 }];
    const viewport = { width: 1600, height: 1000 };
    expect(fitTransform(points, viewport, { padding: 48, minZoom: 0.1, maxZoom: 1.25 }).k).toBeLessThan(0.8);

    const { x, y, k } = readableFit(points, viewport, options);

    expect(k).toBe(0.8);
    // The top left corner of the first card lands `padding` from the top left of the viewport.
    expect(viewport.width / 2 + (-100 - x) * k).toBeCloseTo(48);
    expect(viewport.height / 2 + (-cardHeight / 2 - y) * k).toBeCloseTo(48);
  });

  it("never zooms past the most a fit zooms in", () => {
    expect(readableFit(row(1), { width: 300, height: 200 }, { ...options, maxZoom: 0.5 }).k).toBeLessThanOrEqual(0.5);
  });
});

describe("releaseColors", () => {
  it("gives every release the colour of its place in the list, around the palette", () => {
    const releases = Array.from({ length: releasePalette.length + 1 }, (_, index) => ({
      name: `release-${index}`,
      namespace: "shop",
      cards: 1,
    }));

    const colors = releaseColors(releases);

    expect(colors.get("shop/release-0")).toBe(releasePalette[0]);
    expect(colors.get(`shop/release-${releasePalette.length}`)).toBe(releasePalette[0]);
    expect(colors.get("shop/release-1")).toBe(releasePalette[1]);
  });
});
