/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { helmReleaseKind } from "./helm";

import type { CanvasColors } from "../dependencies";
import type { ChartDataSeries, LinkObject } from "./types";

/** How a node is painted: as usual, raised above the others, or faded behind them. */
export type Emphasis = "normal" | "highlight" | "dim";

/**
 * What the map brings forward: the hovered or dragged node, with its
 * neighbours and its links. While a node is hovered, the rest of the map fades.
 */
export interface MapFocus {
  readonly hovered?: ChartDataSeries;
  readonly neighbours: ReadonlySet<ChartDataSeries>;
  readonly links: ReadonlySet<LinkObject>;
}

export const noFocus: MapFocus = { neighbours: new Set(), links: new Set() };

/** The node of an end of a link, once force-graph has turned its id into the node. */
const endNode = (end: LinkObject["source"]) => (typeof end === "object" ? end : undefined);

/** The focus of a hovered node: the node, the nodes linked to it and the links between them. */
export function hoverFocus(node: ChartDataSeries | undefined, links: readonly LinkObject[]): MapFocus {
  const neighbours = new Set<ChartDataSeries>();
  const focusLinks = new Set<LinkObject>();
  if (node) {
    for (const link of links) {
      const source = endNode(link.source);
      const target = endNode(link.target);
      if (source !== node && target !== node) continue;
      focusLinks.add(link);
      if (source && source !== node) neighbours.add(source);
      if (target && target !== node) neighbours.add(target);
    }
  }
  return { hovered: node, neighbours, links: focusLinks };
}

/** Whether the map fades what is out of focus. */
export const isFocused = (focus: MapFocus) => focus.hovered !== undefined;

export function nodeEmphasis(node: ChartDataSeries, focus: MapFocus): Emphasis {
  if (!isFocused(focus)) return "normal";
  if (node === focus.hovered || focus.neighbours.has(node)) return "highlight";
  return "dim";
}

/** Whether a link stands out: one of the hovered node. */
export const linkHighlighted = (link: LinkObject, focus: MapFocus) => focus.links.has(link);

// The colour of a node without one of its own.
const fallbackColor = "#1f78b4";

/** A colour `#rgb` or `#rrggbb` with an alpha, as `rgba()`; any other colour as it is. */
export function hexToRgba(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (!match) return color;
  const hex = match[1].length === 3 ? [...match[1]].map((digit) => digit + digit).join("") : match[1];
  const value = Number.parseInt(hex, 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

/** The colour of a link: that of its source, faint at rest, fainter out of focus, opaque when it stands out. */
export function linkColor(link: LinkObject, focus: MapFocus): string {
  const color = endNode(link.source)?.color || fallbackColor;
  if (linkHighlighted(link, focus)) return hexToRgba(color, 1);
  return hexToRgba(color, isFocused(focus) ? 0.08 : 0.35);
}

export const linkWidth = (link: LinkObject, focus: MapFocus) => (linkHighlighted(link, focus) ? 2 : 1);

/** The radius of the circle of a node, in the units of the graph. */
export function nodeRadius(node: ChartDataSeries): number {
  return Math.sqrt(Math.max(0, node.value || 10)) * 4;
}

const dimAlpha = 0.15;
const iconSize = 30;

export interface PaintNodeOptions {
  emphasis: Emphasis;
  /** The outer ring: of a workload on the page, of the object of the panel in a details map. */
  ring: boolean;
  colors: CanvasColors;
  onIconError(error: unknown): void;
}

/** Paints a node: its ring, its circle in the colour of its kind or status, and the icon of its kind. */
export function paintNode(
  ctx: CanvasRenderingContext2D,
  node: ChartDataSeries,
  { emphasis, ring, colors, onIconError }: PaintNodeOptions,
) {
  const x = node.x ?? 0;
  const y = node.y ?? 0;
  const r = nodeRadius(node);
  const color = node.color || fallbackColor;
  const alpha = ctx.globalAlpha;
  ctx.globalAlpha = emphasis === "dim" ? alpha * dimAlpha : alpha;
  try {
    if (ring) {
      ctx.beginPath();
      ctx.lineWidth = 2;
      ctx.arc(x, y, r + 3, 0, 2 * Math.PI, false);
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.fillStyle = colors.background;
      ctx.fill();
      ctx.closePath();
    }

    const size = emphasis === "highlight" ? r + 2 : r;
    // the ring of a node that stands out, around the outer ring if it has one,
    // drawn first, so the circle stays the last arc
    if (emphasis === "highlight") {
      ctx.beginPath();
      ctx.lineWidth = 1.5;
      ctx.arc(x, y, (ring ? r + 4 : size) + 3, 0, 2 * Math.PI, false);
      ctx.strokeStyle = colors.text;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(x, y, size, 0, 2 * Math.PI, false);
    ctx.fillStyle = color;
    ctx.fill();

    if (node.image) {
      try {
        ctx.drawImage(node.image, x - iconSize / 2, y - iconSize / 2, iconSize, iconSize);
      } catch (error) {
        onIconError(error);
      }
    }
  } finally {
    ctx.globalAlpha = alpha;
  }
}

/** The size of a name on the screen, in px, at every zoom. */
export const labelFontSize = 11;
/** The longest name drawn whole; a longer one loses its middle, and the tooltip has it whole. */
export const maxLabelLength = 28;
/** Below this zoom only the names that matter most are drawn. */
export const labelZoomThreshold = 0.75;
// The room between the circle of a node and its name, past the rings of
// `paintNode`: in the units of the graph, then in px on the screen.
const labelGraphGap = 7;
const labelScreenGap = 3;

/** A name of at most `max` characters, its middle replaced by an ellipsis. */
export function middleEllipsis(text: string, max = maxLabelLength): string {
  if (text.length <= max) return text;
  const keep = max - 1;
  const head = Math.ceil(keep / 2);
  return `${text.slice(0, head)}…${text.slice(text.length - (keep - head))}`;
}

/** A box on the screen, in px. */
export interface LabelBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const boxesOverlap = (a: LabelBox, b: LabelBox) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** The candidates kept, in their order, each unless its box overlaps one kept before it. */
export function placeLabels<T extends { box: LabelBox }>(candidates: readonly T[]): T[] {
  const placed: T[] = [];
  for (const candidate of candidates) {
    if (!placed.some((other) => boxesOverlap(other.box, candidate.box))) placed.push(candidate);
  }
  return placed;
}

const workloadKinds = new Set(["Deployment", "StatefulSet", "DaemonSet"]);
// The rank from which a name is drawn only at a zoom of `labelZoomThreshold` or more.
const minorRank = 4;

/**
 * The rank of the name of a node, the lower placed first: the hovered node,
 * its neighbours, a Helm release, a workload, an Ingress, a Service, the rest.
 */
export function labelRank(node: ChartDataSeries, focus: MapFocus): number {
  if (node === focus.hovered) return 0;
  if (focus.neighbours.has(node)) return 1;
  if (node.kind === helmReleaseKind) return 2;
  if (workloadKinds.has(node.kind)) return 3;
  if (node.kind === "Ingress") return minorRank;
  if (node.kind === "Service") return minorRank + 1;
  return minorRank + 2;
}

/** The nodes whose names may be drawn at the zoom `globalScale`, in the order they are placed. */
export function labelCandidates(
  nodes: readonly ChartDataSeries[],
  focus: MapFocus,
  globalScale: number,
): ChartDataSeries[] {
  const all = globalScale >= labelZoomThreshold;
  return nodes
    .filter((node) => nodeEmphasis(node, focus) !== "dim")
    .map((node) => ({ node, rank: labelRank(node, focus) }))
    .filter(({ rank }) => all || rank < minorRank)
    .sort((a, b) => a.rank - b.rank || a.node.id.localeCompare(b.node.id))
    .map(({ node }) => node);
}

export interface DrawLabelsOptions {
  nodes: readonly ChartDataSeries[];
  focus: MapFocus;
  colors: CanvasColors;
  fontFamily: string;
  /** The widths of the names at `labelFontSize`, which the pass measures once. */
  widths: Map<string, number>;
}

/**
 * Draws the names of the nodes, after the nodes and in the units of the
 * graph, at a size that stays the same on the screen: below the circle of
 * each node, on a halo of the colour of the canvas, and none over another.
 */
export function drawLabels(
  ctx: CanvasRenderingContext2D,
  globalScale: number,
  { nodes, focus, colors, fontFamily, widths }: DrawLabelsOptions,
) {
  const k = globalScale;
  const height = labelFontSize * 1.3;
  ctx.save();
  ctx.font = `${labelFontSize}px ${fontFamily}`;
  const placed = placeLabels(
    labelCandidates(nodes, focus, k).map((node) => {
      const text = middleEllipsis(node.name);
      let width = widths.get(text);
      if (width === undefined) {
        width = ctx.measureText(text).width;
        widths.set(text, width);
      }
      const x = (node.x ?? 0) * k;
      const y = ((node.y ?? 0) + nodeRadius(node) + labelGraphGap) * k + labelScreenGap + height / 2;
      const box = { left: x - width / 2 - 2, right: x + width / 2 + 2, top: y - height / 2, bottom: y + height / 2 };
      return { text, x, y, box };
    }),
  );

  ctx.globalAlpha = 1;
  ctx.font = `${labelFontSize / k}px ${fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 3 / k;
  ctx.strokeStyle = colors.background;
  ctx.fillStyle = colors.text;
  for (const { text, x, y } of placed) {
    ctx.strokeText(text, x / k, y / k);
    ctx.fillText(text, x / k, y / k);
  }
  ctx.restore();
}

/** The font family of an element, for the canvas, which does not inherit it. */
export function fontFamilyOf(element: Element): string {
  return getComputedStyle(element).fontFamily || "sans-serif";
}
