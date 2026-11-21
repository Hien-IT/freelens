/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Stand-ins for the canvas of a map, which jsdom does not have: a context that
// records what a map draws for a node, and the methods of force-graph that a
// map fits its graph to the canvas with.
import { vi } from "vitest";

import type { ChartDataSeries } from "../helpers/types";

type DrawNode = (node: ChartDataSeries, ctx: CanvasRenderingContext2D, globalScale: number) => void;
type DrawFrame = (ctx: CanvasRenderingContext2D, globalScale: number) => void;

/** A context that draws nothing, with what a map draws, and a width of 0.6 em for every character. */
function recordingContext(record: { arc?(r: number): void; fillText?(text: string, x: number, y: number): void }) {
  const ctx = {
    font: "",
    globalAlpha: 1,
    save() {},
    restore() {},
    beginPath() {},
    closePath() {},
    fill() {},
    stroke() {},
    drawImage() {},
    strokeText() {},
    measureText: (text: string) => ({ width: text.length * 0.6 * Number.parseFloat(ctx.font) }),
    arc(_x: number, _y: number, r: number) {
      record.arc?.(r);
    },
    fillText(text: string, x: number, y: number) {
      record.fillText?.(text, x, y);
    },
  };
  return ctx;
}

/**
 * How far below its circle, in px on the screen, a map draws the name of
 * `node` at the zoom `zoom`. The circle is the last arc that `drawNode`, the
 * `nodeCanvasObject` of the map, draws for the node, after its rings. The name
 * is the one that `drawLabels`, the `onRenderFramePost` of the map, draws at
 * the point of the node, with the other `nodes` of the map moved out of its
 * way. It is centered on its point (`textBaseline` "middle"), and a descender
 * reaches about 0.6 em below it.
 */
export function nameBelowCircle(
  drawNode: DrawNode,
  drawLabels: DrawFrame,
  nodes: readonly ChartDataSeries[],
  node: ChartDataSeries,
  zoom: number,
): number {
  let radius = 0;
  drawNode({ ...node, x: 0, y: 0 }, recordingContext({ arc: (r) => (radius = r) }) as never, zoom);

  let nameY: number | undefined;
  const ctx = recordingContext({
    fillText: (_text, x, y) => {
      if (x === 0) nameY = y;
    },
  });
  const points = nodes.map(({ x, y }) => ({ x, y }));
  nodes.forEach((other, index) => Object.assign(other, { x: other === node ? 0 : (index + 1) * 10_000, y: 0 }));
  try {
    drawLabels(ctx as never, zoom);
  } finally {
    nodes.forEach((other, index) => Object.assign(other, points[index]));
  }
  if (nameY === undefined) throw new Error(`the map draws no name for ${node.id} at the zoom ${zoom}`);
  return (nameY + 0.6 * Number.parseFloat(ctx.font) - radius) * zoom;
}

/** A box in the coordinates of a graph, as force-graph's `getGraphBbox` gives it. */
export interface GraphBox {
  x: [number, number];
  y: [number, number];
}

/**
 * The methods of force-graph that a map fits its graph with, for a graph whose
 * nodes have the box `box()`, that of their circles, on a canvas of
 * `canvas()`. `centerAt` and `zoom` record their calls, `zoom()` without a
 * scale gives the last one set, 1 before any, and `zoomToFit` centers and
 * zooms as force-graph's does, with a margin of 10 px unless it is given one.
 */
export function fakeFitMethods(box: () => GraphBox, canvas: () => { width: number; height: number }) {
  let current = 1;
  const centerAt = vi.fn((_x: number, _y: number, _durationMs?: number) => {});
  const zoom = vi.fn((scale?: number, _durationMs?: number): number | undefined => {
    if (scale === undefined) return current;
    current = scale;
    return undefined;
  });
  const zoomToFit = vi.fn((durationMs?: number, padding = 10) => {
    const [left, right] = box().x;
    const [top, bottom] = box().y;
    const { width, height } = canvas();
    centerAt((left + right) / 2, (top + bottom) / 2, durationMs);
    zoom(Math.min((width - 2 * padding) / (right - left), (height - 2 * padding) / (bottom - top)), durationMs);
  });
  return { centerAt, zoom, zoomToFit, getGraphBbox: vi.fn(() => box()) };
}

/**
 * Where `box` lands on a canvas of `width` by `height` px, in px, with the
 * center and the zoom that the map last gave the graph through `methods`.
 * force-graph keeps the zoom within its `maxZoom`, and starts with the origin
 * of the graph at the center of the canvas.
 */
export function boxOnCanvas(
  methods: ReturnType<typeof fakeFitMethods>,
  box: GraphBox,
  { width, height, maxZoom }: { width: number; height: number; maxZoom: number },
) {
  const [x, y] = methods.centerAt.mock.lastCall ?? [0, 0];
  const zoom = Math.min(maxZoom, methods.zoom() ?? 1);
  return {
    zoom,
    left: width / 2 + (box.x[0] - x) * zoom,
    right: width / 2 + (box.x[1] - x) * zoom,
    top: height / 2 + (box.y[0] - y) * zoom,
    bottom: height / 2 + (box.y[1] - y) * zoom,
  };
}
