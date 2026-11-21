/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { restingEdgeAlpha } from "../../../traffic-map/renderer/graph";
import { cardHeight, cardWidth } from "../../../traffic-map/renderer/layout";
import { config, kindLabel, podHealthStyles } from "./config";

import type { EdgeRoute } from "../../../traffic-map/renderer/layout";
import type { CanvasColors } from "../dependencies";
import type { CardPod, MapCard } from "./card-graph";
import type { ColumnHeader } from "./card-layout";
import type { PodHealth } from "./config";

/** How a card is painted: as usual, raised, selected, or faded behind the others. */
export type CardEmphasis = "normal" | "highlight" | "selected" | "dim";

/** How an edge is painted: at rest, standing out, or faded. */
export type EdgeEmphasis = "rest" | "highlight" | "dim";

const radius = 8;
const stripeWidth = 4;
const discRadius = 13;
const iconSize = 20;
const maxDots = 6;
const dotRadius = 3;
const dotStep = 8;
const fallbackColor = "#78716c";
// How a card and an edge out of focus fade: enough for the focus to stand out, not so much that the map behind
// it is lost.
const dimCardAlpha = 0.45;
const dimEdgeAlpha = 0.1;

// The order of the dots of the pods: the problems first, so that they show when the dots stop.
const severity: Record<PodHealth, number> = { failed: 0, pending: 1, done: 2, running: 3 };

/** The worst health of the pods of a card, if it is a problem. */
export function cardProblem(card: MapCard): "failed" | "pending" | undefined {
  if (card.pods.some((pod) => pod.status === "failed")) return "failed";
  if (card.pods.some((pod) => pod.status === "pending")) return "pending";
  return undefined;
}

/** How many of the pods of a card run, over all of them: `3/3`. */
export const readyLabel = (card: MapCard) =>
  `${card.pods.filter((pod) => pod.status === "running").length}/${card.pods.length}`;

/** The colour of the kind of a card, as its icon is drawn on it. */
export const kindColor = (kind: string) => config[kind.toLowerCase()]?.color ?? fallbackColor;

export interface PaintCardOptions {
  emphasis: CardEmphasis;
  colors: CanvasColors;
  fontFamily: string;
  /** The colour of the release of the card, for its stripe. */
  releaseColor?: string;
  /** The map shows more than one namespace: the second line names the card's. */
  showNamespace: boolean;
  /** The Services, config and storage folded into the card, which its second line counts. */
  held?: readonly MapCard[];
  /** Texts fitted to a width, by font, width and text, which the painter fills. */
  fitted: Map<string, string>;
  onIconError(error: unknown): void;
}

/**
 * A name fitted to a width by its end, where the names of one application
 * differ: the longest run of its last words, split on `-` and `.`, that fits
 * after an ellipsis, or, when even its last word does not, the end of that
 * word. A name that fits stays whole.
 */
export function fitTail(measure: (text: string) => number, text: string, width: number): string {
  if (measure(text) <= width) return text;
  const starts: number[] = [];
  for (let index = 1; index < text.length; index++) {
    if (text[index - 1] === "-" || text[index - 1] === ".") starts.push(index);
  }
  for (const start of starts) {
    const candidate = `…${text.slice(start)}`;
    if (measure(candidate) <= width) return candidate;
  }
  const last = text.slice(starts.at(-1) ?? 0);
  for (let start = 1; start < last.length; start++) {
    const candidate = `…${last.slice(start)}`;
    if (measure(candidate) <= width) return candidate;
  }
  return "…";
}

/** A name fitted to a width by `fitTail`, once per font, width and name. */
function fit(ctx: CanvasRenderingContext2D, text: string, width: number, fitted: Map<string, string>) {
  const key = `${ctx.font}|${width}|${text}`;
  let result = fitted.get(key);
  if (result === undefined) {
    result = fitTail((candidate) => ctx.measureText(candidate).width, text, width);
    fitted.set(key, result);
  }
  return result;
}

function cardPath(ctx: CanvasRenderingContext2D, left: number, top: number, grow = 0) {
  ctx.beginPath();
  ctx.roundRect(left - grow, top - grow, cardWidth + 2 * grow, cardHeight + 2 * grow, radius + grow);
}

/**
 * How many dots of `pods` pods fit in `room` px, at most six, beside the
 * `ready/total` of `readyWidth` px and the `+n` of the pods without a dot.
 */
export function podDotsThatFit(
  pods: number,
  room: number,
  readyWidth: number,
  moreWidth: (count: number) => number,
): number {
  for (let dots = Math.min(maxDots, pods); dots > 0; dots--) {
    const more = pods - dots;
    if (readyWidth + 6 + (more > 0 ? moreWidth(more) + 4 : 0) + dots * dotStep <= room) return dots;
  }
  return 0;
}

/** The first `count` dots of the pods of a card, the problems first, right-aligned at `right`. */
function paintPods(ctx: CanvasRenderingContext2D, pods: readonly CardPod[], right: number, y: number, count: number) {
  const shown = [...pods]
    .sort((a, b) => severity[a.status] - severity[b.status] || a.name.localeCompare(b.name))
    .slice(0, count);
  let x = right;
  for (const pod of shown.reverse()) {
    ctx.beginPath();
    ctx.arc(x - dotRadius, y, dotRadius, 0, 2 * Math.PI);
    ctx.fillStyle = pod.color;
    ctx.fill();
    x -= dotStep;
  }
  return x;
}

/**
 * Paints a card of the map centred at `x`, `y`: its border, which tells a
 * problem of its pods, the stripe of its Helm release, the icon of its kind,
 * its name, and a second line with its kind, how many objects are folded into
 * it, and its pods or its consumers.
 */
export function paintCard(
  ctx: CanvasRenderingContext2D,
  card: MapCard,
  x: number,
  y: number,
  options: PaintCardOptions,
) {
  const { emphasis, colors, fontFamily, releaseColor, showNamespace, held = [], fitted, onIconError } = options;
  const left = x - cardWidth / 2;
  const top = y - cardHeight / 2;
  const alpha = emphasis === "dim" ? dimCardAlpha : card.linked ? 1 : 0.7;
  const problem = cardProblem(card);
  const raised = emphasis === "selected" || emphasis === "highlight";

  ctx.save();
  if (emphasis === "selected") {
    // a faint halo around the ring of the selected card
    ctx.globalAlpha = alpha * 0.25;
    cardPath(ctx, left, top, 3);
    ctx.lineWidth = 6;
    ctx.strokeStyle = colors.selected;
    ctx.stroke();
  }
  ctx.globalAlpha = alpha;

  cardPath(ctx, left, top);
  ctx.fillStyle = colors.card;
  ctx.fill();
  ctx.lineWidth = emphasis === "selected" ? 2 : emphasis === "highlight" ? 1.5 : problem ? 1.8 : 1;
  ctx.strokeStyle = raised ? colors.selected : problem ? podHealthStyles[problem].color : colors.border;
  ctx.setLineDash(card.linked ? [] : [4, 3]);
  ctx.stroke();
  ctx.setLineDash([]);

  if (releaseColor) {
    ctx.save();
    cardPath(ctx, left, top);
    ctx.clip();
    ctx.fillStyle = releaseColor;
    ctx.fillRect(left, top, stripeWidth, cardHeight);
    ctx.restore();
  }

  const discX = left + stripeWidth + 6 + discRadius;
  ctx.beginPath();
  ctx.arc(discX, y, discRadius, 0, 2 * Math.PI);
  ctx.fillStyle = kindColor(card.kind);
  ctx.fill();
  const image = config[card.kind.toLowerCase()]?.img;
  if (image) {
    try {
      ctx.drawImage(image, discX - iconSize / 2, y - iconSize / 2, iconSize, iconSize);
    } catch (error) {
      onIconError(error);
    }
  }

  const textLeft = discX + discRadius + 8;
  const textRight = left + cardWidth - 10;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.font = `600 13px ${fontFamily}`;
  ctx.fillStyle = colors.text;
  ctx.fillText(fit(ctx, card.name, textRight - textLeft, fitted), textLeft, top + 23);

  // Line 2: the kind in full, and how many objects the card holds; on the right, its pods, whose dots give way
  // first when the line is short, or how many cards use it.
  ctx.font = `11px ${fontFamily}`;
  ctx.fillStyle = colors.secondaryText;
  const lineY = top + 42;
  const width = (text: string) => ctx.measureText(text).width;
  const kind = kindLabel(card.kind);
  const holds = held.length ? ` · +${held.length}` : "";
  const withNamespace = showNamespace && card.namespace ? `${kind} · ${card.namespace}${holds}` : undefined;
  const ready = card.pods.length ? readyLabel(card) : "";
  const least = ready ? width(ready) + 8 : 0;
  const label =
    withNamespace && textLeft + width(withNamespace) + least <= textRight ? withNamespace : `${kind}${holds}`;
  ctx.textAlign = "left";
  ctx.fillText(label, textLeft, lineY);
  const room = textRight - textLeft - width(label) - 8;

  ctx.textAlign = "right";
  if (card.pods.length) {
    const dots = podDotsThatFit(card.pods.length, room, width(ready), (count) => width(`+${count}`));
    ctx.fillText(ready, textRight, lineY);
    let right = textRight - width(ready) - 6;
    const more = card.pods.length - dots;
    if (dots > 0 && more > 0) {
      ctx.fillText(`+${more}`, right, lineY);
      right -= width(`+${more}`) + 4;
    }
    paintPods(ctx, card.pods, right, lineY - 4, dots);
  } else if (card.consumers >= 2) {
    const used = `used by ${card.consumers}`;
    if (width(used) <= room) ctx.fillText(used, textRight, lineY);
  }
  ctx.restore();
}

/** The pointer area of a card: its whole rectangle. */
export function paintCardArea(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x - cardWidth / 2, y - cardHeight / 2, cardWidth, cardHeight);
}

/** The opacity and width of an edge: by the number of edges at rest, opaque and thicker standing out, faint else. */
export function edgeStyle(emphasis: EdgeEmphasis, edgeCount: number): { alpha: number; width: number } {
  if (emphasis === "highlight") return { alpha: 1, width: 2.5 };
  if (emphasis === "dim") return { alpha: dimEdgeAlpha, width: 1.5 };
  return { alpha: restingEdgeAlpha(edgeCount), width: 1.5 };
}

/** Paints an edge along its route. */
export function paintEdge(
  ctx: CanvasRenderingContext2D,
  route: EdgeRoute,
  color: string,
  { alpha, width }: { alpha: number; width: number },
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(route.start.x, route.start.y);
  for (const segment of route.segments) {
    if (segment.type === "line") {
      ctx.lineTo(segment.to.x, segment.to.y);
    } else {
      ctx.bezierCurveTo(segment.c1.x, segment.c1.y, segment.c2.x, segment.c2.y, segment.to.x, segment.to.y);
    }
  }
  ctx.stroke();
  ctx.restore();
}

/** Paints the headers of the columns. */
export function paintHeaders(
  ctx: CanvasRenderingContext2D,
  headers: readonly ColumnHeader[],
  colors: CanvasColors,
  fontFamily: string,
) {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.font = `600 12px ${fontFamily}`;
  ctx.fillStyle = colors.secondaryText;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  for (const header of headers) {
    ctx.fillText(header.label, header.x, header.y);
  }
  ctx.restore();
}
