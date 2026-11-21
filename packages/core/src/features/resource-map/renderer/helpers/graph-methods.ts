/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import * as d3 from "d3-force";

import type React from "react";
import type { ForceGraphMethods } from "react-force-graph-2d";

import type { ChartDataSeries, LinkObject } from "./types";

/** The methods of the graph of a map, which `ForceGraph2D` puts in its ref. */
export type GraphMethods = ForceGraphMethods<ChartDataSeries, LinkObject>;

// The pull of every node towards the origin, which keeps the nodes without a
// link, and the small groups, near the rest.
const gravity = 0.05;

/**
 * Sets the forces of a map on its graph, the links, the charge, the collision
 * and a weak gravity towards the origin in place of force-graph's centering,
 * the last three from `d3-force`, and zooms in on it.
 */
export function applyMapForces(graph: GraphMethods) {
  graph.zoom(1.3, 1000);
  graph
    .d3Force("link")
    ?.strength(1.3)
    .distance(() => 60);
  graph.d3Force("charge", d3.forceManyBody().strength(-60).distanceMax(250));
  graph.d3Force("collide", d3.forceCollide(40));
  graph.d3Force("center", null);
  graph.d3Force("x", d3.forceX(0).strength(gravity));
  graph.d3Force("y", d3.forceY(0).strength(gravity));
}

/**
 * The margin, in px, that a map keeps around its nodes when it fits its graph
 * to the canvas. The box of the nodes that force-graph gives holds their
 * circles, and a map draws the name of a node below its circle, past its rings,
 * in a font of 11 px on the screen: at the largest zoom of the page, the names
 * of the bottom row reach about 31 px past the box.
 */
export const fitPadding = 40;

/** The largest zoom of the fit of a graph of ten nodes or fewer, which would otherwise fill the canvas. */
export const smallGraphZoom = 1.2;

/**
 * Fits a graph to its canvas: centers the view on the box of its nodes, and
 * zooms so that the box, with `fitPadding` around it, fills the canvas, up to
 * `maxZoom`. force-graph's `zoomToFit` keeps 10 px around the box, which cut
 * the names of the bottom row, and takes no largest zoom: on a small graph it
 * zooms in as far as the `maxZoom` of the graph.
 */
export function fitGraph(
  graph: GraphMethods | undefined,
  size: { width: number; height: number },
  maxZoom: number,
  durationMs: number,
) {
  const box = graph?.getGraphBbox();
  if (!graph || !box || size.width <= 2 * fitPadding || size.height <= 2 * fitPadding) return;
  const [left, right] = box.x;
  const [top, bottom] = box.y;
  const zoom = Math.min(
    maxZoom,
    (size.width - 2 * fitPadding) / Math.max(1, right - left),
    (size.height - 2 * fitPadding) / Math.max(1, bottom - top),
  );
  graph.centerAt((left + right) / 2, (top + bottom) / 2, durationMs);
  graph.zoom(zoom, durationMs);
}

/** How far a zoom button zooms in or out. */
export const zoomStep = 1.3;
/** The smallest zoom of the zoom buttons. */
const minButtonZoom = 0.05;

/** The zoom of a graph of force-graph, whatever its nodes. */
interface Zoomable {
  zoom(): number;
  zoom(scale: number, durationMs?: number): unknown;
}

/** Zooms a graph by `factor` around the center of its view, between `minZoom` and `maxZoom`. */
export function zoomGraphBy(
  graph: Zoomable | undefined,
  factor: number,
  maxZoom: number,
  durationMs = 200,
  minZoom = minButtonZoom,
) {
  if (!graph) return;
  const current = graph.zoom() || 1;
  graph.zoom(Math.min(maxZoom, Math.max(minZoom, current * factor)), durationMs);
}

/**
 * A ref object that hands to `onSet` what React puts in it, `null` included:
 * `react-force-graph-2d` takes no callback ref, and a map sets the forces of
 * its graph once the graph has put its methods there.
 */
export function refWithSetter<T>(onSet: (value: T | null | undefined) => void): React.MutableRefObject<T | undefined> {
  let current: T | undefined;
  return {
    get current() {
      return current;
    },
    set current(value) {
      current = value ?? undefined;
      onSet(value);
    },
  };
}

/** A node drawn on the canvas, at the point of the canvas where it settled. */
export interface NodePoint {
  id: string;
  kind: string;
  namespace?: string;
  name: string;
  x: number;
  y: number;
}

/** A node of a map, at its point in the graph. */
type PlacedNode = Pick<NodePoint, "id" | "kind" | "namespace" | "name"> & { x?: number; y?: number };

/** The points of the nodes on the canvas of a graph, from its zoom transform, for the hidden list of its map. */
export function nodePointsOf(
  graph: { graph2ScreenCoords(x: number, y: number): { x: number; y: number } } | undefined,
  nodes: readonly PlacedNode[],
): NodePoint[] {
  return nodes.map(({ id, kind, namespace, name, x = 0, y = 0 }) => {
    const point = graph?.graph2ScreenCoords(x, y) ?? { x: 0, y: 0 };
    return { id, kind, namespace, name, x: Math.round(point.x), y: Math.round(point.y) };
  });
}
