/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import {
  cardHeight,
  cardWidth,
  edgeAnchors,
  edgeLanes,
  edgeRoute,
  fitTransform,
  layoutColumns,
} from "../../../traffic-map/renderer/layout";
import { cardColumnNames, releaseKey } from "./card-graph";

import type { EdgeRoute, FitOptions, LayoutPoint, RoutePoint } from "../../../traffic-map/renderer/layout";
import type { MapCard, MapEdge, MapRelease } from "./card-graph";

/** The colours of the Helm releases, by the place of a release in the sorted list of releases. */
export const releasePalette = [
  "#2563eb",
  "#16a34a",
  "#9333ea",
  "#ea580c",
  "#0891b2",
  "#c026d3",
  "#65a30d",
  "#e11d48",
] as const;

/** The colour of every release, by its key. */
export function releaseColors(releases: readonly MapRelease[]): Map<string, string> {
  return new Map(
    releases.map((release, index) => [releaseKey(release), releasePalette[index % releasePalette.length]]),
  );
}

/**
 * The order of the cards of a column before the layout orders them by their
 * neighbours: the linked ones first, then by namespace, release (the cards
 * without one last) and name.
 */
export function cardSortKey(card: MapCard): string {
  return [card.linked ? "0" : "1", card.namespace ?? "", card.release ? `0${card.release}` : "1", card.name].join(
    "\u0000",
  );
}

/** The header of a column, at the left of its block, above its top card. */
export interface ColumnHeader {
  column: number;
  label: string;
  x: number;
  y: number;
}

export interface CardLayout {
  points: Map<string, LayoutPoint>;
  routes: Map<string, EdgeRoute>;
  headers: ColumnHeader[];
  /** What a fit takes in: the cards, and the headers above them. */
  fitPoints: RoutePoint[];
}

// The baseline of a header above the top of the cards, and the height of its text.
const headerGap = 14;
const headerHeight = 12;

/**
 * Lays the cards out in the columns of their kinds, with their tops aligned
 * under a header per column, and routes their edges.
 */
export function layoutCards(cards: readonly MapCard[], edges: readonly MapEdge[]): CardLayout {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const kept = edges.filter((edge) => byId.has(edge.source) && byId.has(edge.target));
  const cardOf = (id: string) => byId.get(id) as MapCard;
  const points = layoutColumns(
    cards.map((card) => card.id),
    kept,
    (id) => cardSortKey(cardOf(id)),
    { columnOf: (id) => cardOf(id).column },
  );

  const columns = new Map<number, LayoutPoint[]>();
  for (const point of points.values()) {
    columns.set(point.column, [...(columns.get(point.column) ?? []), point]);
  }
  const topOf = (column: readonly LayoutPoint[]) => Math.min(...column.map((point) => point.y));
  const top = Math.min(...[...columns.values()].map(topOf));
  for (const column of columns.values()) {
    const shift = top - topOf(column);
    for (const point of column) point.y += shift;
  }

  const anchors = edgeAnchors(points, kept);
  const lanes = edgeLanes(points, kept, anchors);
  const routes = new Map<string, EdgeRoute>();
  for (const edge of kept) {
    const anchor = anchors.get(edge.id);
    const lane = lanes.get(edge.id);
    routes.set(
      edge.id,
      edgeRoute(
        points.get(edge.source) as LayoutPoint,
        points.get(edge.target) as LayoutPoint,
        anchor?.source,
        anchor?.target,
        lane?.source,
        lane?.target,
      ),
    );
  }

  const headerY = top - cardHeight / 2 - headerGap;
  const headers = [...columns]
    .sort(([a], [b]) => a - b)
    .map(([column, members]) => ({
      column,
      label: `${cardColumnNames[column] ?? ""} · ${members.length}`,
      x: members[0].blockLeft,
      y: headerY,
    }));

  return {
    points,
    routes,
    headers,
    fitPoints: [
      ...points.values(),
      ...headers.map((header) => ({ x: header.x + cardWidth / 2, y: header.y - headerHeight + cardHeight / 2 })),
    ],
  };
}

/** The least zoom at which the text of a card reads well. */
export const readableZoom = 0.8;

/**
 * A fit of the cards centred at `points` that keeps them readable: the zoom
 * of a fit of them all, but `readableZoom` at least, up to the most a fit
 * zooms in. A fit raised that way shows the top left corner of the map, the
 * first column and its header, `padding` from the top left of the viewport,
 * in place of the middle.
 */
export function readableFit(
  points: readonly RoutePoint[],
  viewport: { width: number; height: number },
  { readableZoom: floor = readableZoom, ...options }: FitOptions & { readableZoom?: number },
): { x: number; y: number; k: number } {
  const fit = fitTransform(points, viewport, options);
  const k = Math.min(options.maxZoom, Math.max(fit.k, floor));
  if (k <= fit.k || points.length === 0) return fit;
  const left = Math.min(...points.map((point) => point.x)) - cardWidth / 2;
  const top = Math.min(...points.map((point) => point.y)) - cardHeight / 2;
  return {
    x: left + (viewport.width / 2 - options.padding) / k,
    y: top + (viewport.height / 2 - options.padding) / k,
    k,
  };
}
