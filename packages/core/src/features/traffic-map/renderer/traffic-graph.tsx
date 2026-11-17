/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Icon } from "@freelensapp/icon";
import { observer } from "mobx-react";
import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { ElementSize } from "../../resource-map/renderer/helpers/element-size";
import { volumeOf } from "./filters";
import { cardTitleOf, fitMiddle, formatLatency, formatVolume, nodeColor, restingEdgeAlpha } from "./graph";
import {
  cardHeight,
  cardWidth,
  edgeAnchors,
  edgeLanes,
  edgeRoute,
  fitTransform,
  labelRect,
  layoutColumns,
  placeLabels,
} from "./layout";
import styles from "./traffic-map.module.scss";

import type { ForceGraphMethods } from "react-force-graph-2d";

import type { VolumeUnit } from "./filters";
import type { TrafficLink, TrafficNode } from "./graph";
import type { EdgeRoute, LabelAnchor, LayoutPoint, RoutePoint } from "./layout";
import type { TrafficMapModel } from "./traffic-map-model";

/** The colours of the active theme that the canvas paints with. */
export interface TrafficCanvasColors {
  text: string;
  secondaryText: string;
  card: string;
  border: string;
  selected: string;
}

export interface TrafficGraphProps {
  model: TrafficMapModel;
  colors: TrafficCanvasColors;
}

/** A node as the canvas draws it: with the column and the block that the layout placed it in. */
type DrawnNode = TrafficNode & Pick<LayoutPoint, "column" | "blockLeft" | "blockRight">;
/**
 * An edge as the canvas draws it: where it meets the sides of its cards, from
 * their middles; the wires it runs on in the lanes; its route, built once per
 * layout, as the cards are pinned where the layout put them; and the colours
 * of its two cards, for a plain edge.
 */
type DrawnLink = Omit<TrafficLink, "source" | "target"> & {
  source: string | DrawnNode;
  target: string | DrawnNode;
  sourceOffset: number;
  targetOffset: number;
  sourceLane: number;
  targetLane: number;
  route?: EdgeRoute;
  sourceColor: string;
  targetColor: string;
};
type GraphMethods = ForceGraphMethods<DrawnNode, DrawnLink>;

const cardRadius = 8;
const problemColor = "#ef4444";
/** The font of the application, which the canvas does not inherit. */
const canvasFont = '"Roboto", "Helvetica", "Arial", sans-serif';
const minZoom = 0.1;
const maxZoom = 4;
/** The most a fit zooms in, so that a graph of a few cards is not blown up; the zoom buttons still reach `maxZoom`. */
const maxFitZoom = 1.25;
const zoomStep = 1.3;
const fitPadding = 48;
const kindLabels: Record<string, string> = {
  Pod: "Pod",
  Workload: "Workload",
  Service: "Service",
  External: "External",
  Host: "Node",
  Unknown: "Unknown",
};

/** The ports of an edge in few characters: `:4318, :4222 +1`. */
function portsLabel(ports: readonly number[]): string {
  if (ports.length === 0) return "";

  return `:${ports.slice(0, 2).join(", :")}${ports.length > 2 ? ` +${ports.length - 2}` : ""}`;
}

/** The tooltip of an edge: a line per port. */
function linkTitle(link: TrafficLink, unit: VolumeUnit): string {
  return link.flows
    .map((flow) => {
      const parts = [
        flow.port ? `:${flow.port}` : "",
        flow.l7Protocol ?? flow.protocol.toUpperCase(),
        formatVolume(volumeOf(flow, unit), unit),
      ];
      const latency = flow.latencyP50Ms ?? flow.avgLatencyMs;

      if (latency !== undefined) parts.push(formatLatency(latency));
      if ((flow.errorCount ?? 0) > 0) parts.push(`${flow.errorCount} err`);
      if (flow.verdictCounts?.dropped) parts.push(`${flow.verdictCounts.dropped} dropped`);

      return parts.filter(Boolean).join(" · ");
    })
    .join("<br>");
}

/** Text cut to a width, with an ellipsis at its end. */
function fit(context: CanvasRenderingContext2D, text: string, width: number): string {
  if (context.measureText(text).width <= width) return text;

  let end = text.length;

  while (end > 1 && context.measureText(`${text.slice(0, end)}…`).width > width) end--;

  return `${text.slice(0, end)}…`;
}

/** At most this many edges, every edge of the hot path moves; past it only the ones that stand out do. */
const animateAllUpTo = 25;

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius = cardRadius,
) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function subtitleOf(node: TrafficNode): string {
  const { endpoint } = node;
  const kind = endpoint.workloadKind ?? kindLabels[endpoint.kind] ?? endpoint.kind;

  if (endpoint.name === "Internet" && endpoint.kind === "External") return "Outside the cluster";

  return endpoint.namespace ? `${endpoint.namespace} · ${kind}` : kind;
}

/** The path of a route, ready to stroke with the caller's width and dashes. */
function tracePath(context: CanvasRenderingContext2D, route: EdgeRoute) {
  context.beginPath();
  context.moveTo(route.start.x, route.start.y);

  for (const segment of route.segments) {
    if (segment.type === "line") {
      context.lineTo(segment.to.x, segment.to.y);
    } else {
      context.bezierCurveTo(segment.c1.x, segment.c1.y, segment.c2.x, segment.c2.y, segment.to.x, segment.to.y);
    }
  }
}

/**
 * The stroke of a plain edge: from the colour of its source card to the colour
 * of its target card, so that near a card the edge has the card's colour.
 */
function plainStroke(context: CanvasRenderingContext2D, link: DrawnLink, route: EdgeRoute): string | CanvasGradient {
  const { start, end } = route;

  // A gradient between two equal points paints nothing.
  if (start.x === end.x && start.y === end.y) return link.sourceColor;

  const gradient = context.createLinearGradient(start.x, start.y, end.x, end.y);

  gradient.addColorStop(0, link.sourceColor);
  gradient.addColorStop(1, link.targetColor);

  return gradient;
}

function drawArrow(context: CanvasRenderingContext2D, from: RoutePoint, to: RoutePoint, size: number) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);

  context.beginPath();
  context.moveTo(to.x, to.y);
  context.lineTo(to.x - size * Math.cos(angle - Math.PI / 7), to.y - size * Math.sin(angle - Math.PI / 7));
  context.lineTo(to.x - size * Math.cos(angle + Math.PI / 7), to.y - size * Math.sin(angle + Math.PI / 7));
  context.closePath();
  context.fill();
}

const endpointId = (end: string | TrafficNode) => (typeof end === "string" ? end : end.id);

/**
 * The traffic of the map: a card per workload, in columns from the callers on
 * the left to what they call on the right, and a curve per connection.
 */
export const TrafficGraphView = observer(({ model, colors }: TrafficGraphProps) => {
  const size = useMemo(() => new ElementSize(), []);
  const graphRef = useRef<GraphMethods | undefined>(undefined);
  const fittedFor = useRef("");
  const { graph, selection, unit } = model;

  // Fresh objects for the library, which mutates them, placed in their
  // columns and pinned there.
  const data = useMemo(() => {
    const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
    const points = layoutColumns(
      graph.nodes.map((node) => node.id),
      graph.links.map((link) => ({
        source: endpointId(link.source),
        target: endpointId(link.target),
        undirected: link.directionUnknown,
      })),
      (id) => `${nodesById.get(id)?.endpoint.namespace ? 1 : 0}|${id}`,
    );
    const ends = graph.links.map((link) => ({
      id: link.id,
      source: endpointId(link.source),
      target: endpointId(link.target),
    }));
    const anchors = edgeAnchors(points, ends);
    const lanes = edgeLanes(points, ends, anchors);

    return {
      nodes: graph.nodes.map((node): DrawnNode & { fx: number; fy: number } => {
        const point = points.get(node.id) ?? {
          x: 0,
          y: 0,
          column: 0,
          blockLeft: -cardWidth / 2,
          blockRight: cardWidth / 2,
        };

        return {
          ...node,
          x: point.x,
          y: point.y,
          fx: point.x,
          fy: point.y,
          column: point.column,
          blockLeft: point.blockLeft,
          blockRight: point.blockRight,
        };
      }),
      links: graph.links.map((link): DrawnLink => {
        const source = endpointId(link.source);
        const target = endpointId(link.target);
        const from = points.get(source);
        const to = points.get(target);
        const sourceOffset = anchors.get(link.id)?.source ?? 0;
        const targetOffset = anchors.get(link.id)?.target ?? 0;
        const sourceLane = lanes.get(link.id)?.source ?? 0;
        const targetLane = lanes.get(link.id)?.target ?? 0;
        const sourceNode = nodesById.get(source);
        const targetNode = nodesById.get(target);

        return {
          ...link,
          source,
          target,
          sourceOffset,
          targetOffset,
          sourceLane,
          targetLane,
          route: from && to ? edgeRoute(from, to, sourceOffset, targetOffset, sourceLane, targetLane) : undefined,
          sourceColor: sourceNode ? nodeColor(sourceNode.endpoint) : link.color,
          targetColor: targetNode ? nodeColor(targetNode.endpoint) : link.color,
        };
      }),
    };
  }, [graph]);

  // Fit the graph once the canvas has a size, and again when the user looks at
  // something else (another scope, filter, focus or window). Neither a refresh
  // that brings the same view's new data nor a change of the canvas's size, as
  // when the panel below is resized, fits it again: the zoom and the position
  // the user chose stay. The Fit button fits it on demand.
  const fitKey = model.viewKey;
  const hasNodes = data.nodes.length > 0;
  const hasSize = size.width > 0 && size.height > 0;

  // The library's own fit measures the centres of the nodes, which cuts the
  // outer cards in half; this one fits the cards whole.
  const fitGraph = (durationMs: number) => {
    const methods = graphRef.current;

    if (!methods || data.nodes.length === 0) return;

    const { x, y, k } = fitTransform(
      data.nodes.map((node) => ({ x: node.x ?? 0, y: node.y ?? 0 })),
      { width: size.width, height: size.height },
      { padding: fitPadding, minZoom, maxZoom: maxFitZoom },
    );

    methods.centerAt(x, y, durationMs);
    methods.zoom(k, durationMs);
  };

  useEffect(() => {
    if (!hasNodes || !hasSize || fittedFor.current === fitKey) return;

    const timer = setTimeout(() => {
      fitGraph(300);
      fittedFor.current = fitKey;
    }, 50);

    return () => clearTimeout(timer);
  }, [fitKey, hasNodes, hasSize]);

  const zoomBy = (factor: number) => {
    const methods = graphRef.current;

    if (methods) {
      methods.zoom(Math.min(maxZoom, Math.max(minZoom, methods.zoom() * factor)), 200);
    }
  };

  const [hoveredNode, setHoveredNode] = useState<string | undefined>(undefined);
  const [hoveredLink, setHoveredLink] = useState<string | undefined>(undefined);
  const selectedNode = selection?.type === "node" ? selection.id : undefined;
  const selectedLink = selection?.type === "link" ? selection.id : undefined;
  // The node whose edges stand out: the one under the pointer, else the selected one.
  const focusNode = hoveredNode ?? (hoveredLink ? undefined : selectedNode);
  const focusLink = hoveredLink ?? (hoveredNode ? undefined : selectedLink);

  const neighbours = useMemo(() => {
    const ids = new Set<string>();

    if (!focusNode) return ids;

    ids.add(focusNode);

    for (const link of graph.links) {
      if (endpointId(link.source) === focusNode || endpointId(link.target) === focusNode) {
        ids.add(endpointId(link.source));
        ids.add(endpointId(link.target));
      }
    }

    return ids;
  }, [graph, focusNode]);

  const touchesFocus = (link: TrafficLink) =>
    focusNode !== undefined && (endpointId(link.source) === focusNode || endpointId(link.target) === focusNode);
  const isDimmed = (link: TrafficLink) =>
    (focusNode !== undefined && !touchesFocus(link)) || (focusLink !== undefined && link.id !== focusLink);
  const restingAlpha = restingEdgeAlpha(graph.links.length);
  const isEmphasized = (link: TrafficLink) => link.id === focusLink || touchesFocus(link);
  // The dots move on every edge that stands out, and at rest on the hot edges of a small graph.
  const hasDots = (link: TrafficLink) =>
    !isDimmed(link) && (isEmphasized(link) || (link.hot && graph.links.length <= animateAllUpTo));
  const animated =
    Boolean(focusNode || focusLink) || (graph.links.length <= animateAllUpTo && graph.links.some((link) => link.hot));

  // The labels of the edges that stand out, drawn over everything else at a
  // size that stays the same on the screen: near the other end of each edge
  // of the card in focus, where its edges are apart, else in the middle of
  // the edge in focus; the busiest first, and none over another.
  const drawLabels = (context: CanvasRenderingContext2D, globalScale: number) => {
    if (!focusNode && !focusLink) return;

    const scale = 1 / globalScale;
    const height = 16 * scale;
    const padding = 6 * scale;
    const candidates = [];

    context.save();
    context.font = `${11 * scale}px ${canvasFont}`;

    for (const link of data.links) {
      if (!link.route || !isEmphasized(link)) continue;

      // Near the other end of an edge of the card in focus, anchored away from the card there.
      const [at, anchor]: [RoutePoint, LabelAnchor] = !focusNode
        ? [link.route.labelAt, "centre"]
        : endpointId(link.target) === focusNode
          ? [link.route.labelNearSource, "start"]
          : [link.route.labelNearTarget, "end"];
      const ports = portsLabel(link.ports);
      const text = `${ports ? `${ports} · ` : ""}${formatVolume(link.volume, unit)}`;
      const width = context.measureText(text).width + 2 * padding;

      candidates.push({ id: link.id, volume: link.volume, text, ...labelRect(at, width, height, anchor) });
    }

    context.globalAlpha = 1;
    context.lineWidth = scale;
    context.textAlign = "center";
    context.textBaseline = "middle";

    for (const label of placeLabels(candidates)) {
      roundedRect(context, label.x, label.y, label.width, label.height, height / 2);
      context.fillStyle = colors.card;
      context.fill();
      context.strokeStyle = colors.border;
      context.stroke();
      context.fillStyle = colors.secondaryText;
      context.fillText(label.text, label.x + label.width / 2, label.y + label.height / 2);
    }

    context.restore();
  };

  return (
    <div className={styles.graph} ref={(element) => size.follow(element)}>
      {size.width > 0 && size.height > 0 && (
        <ForceGraph2D<DrawnNode, DrawnLink>
          ref={graphRef as never}
          width={size.width}
          height={size.height}
          graphData={data}
          nodeId="id"
          cooldownTicks={0}
          warmupTicks={0}
          enableNodeDrag={false}
          autoPauseRedraw={!animated}
          minZoom={minZoom}
          maxZoom={maxZoom}
          nodeLabel={(node) => `${node.endpoint.kind}: ${node.id}`}
          nodeCanvasObject={(node, context) => {
            const x = (node.x ?? 0) - cardWidth / 2;
            const y = (node.y ?? 0) - cardHeight / 2;
            const selected = node.id === selectedNode;
            const hovered = node.id === hoveredNode && !selected;
            const dimmed = focusNode !== undefined && !neighbours.has(node.id);
            const alpha = dimmed ? 0.3 : 1;

            if (selected) {
              // A faint halo around the ring of the selected card.
              context.globalAlpha = alpha * 0.25;
              roundedRect(context, x - 3, y - 3, cardWidth + 6, cardHeight + 6, cardRadius + 3);
              context.lineWidth = 6;
              context.strokeStyle = colors.selected;
              context.stroke();
            }

            context.globalAlpha = alpha;

            // The card, with a band in the colour of its namespace.
            roundedRect(context, x, y, cardWidth, cardHeight);
            context.fillStyle = colors.card;
            context.fill();
            context.lineWidth = selected ? 2 : hovered ? 1.5 : node.hasProblems ? 1.8 : 1;
            context.strokeStyle =
              selected || hovered ? colors.selected : node.hasProblems ? problemColor : colors.border;
            context.stroke();

            context.save();
            roundedRect(context, x, y, cardWidth, cardHeight);
            context.clip();
            context.fillStyle = nodeColor(node.endpoint);
            context.fillRect(x, y, 5, cardHeight);
            context.restore();

            if (node.hasProblems) {
              context.beginPath();
              context.arc(x + cardWidth - 10, y + 10, 4, 0, 2 * Math.PI);
              context.fillStyle = problemColor;
              context.fill();
            }

            const left = x + 14;
            const textWidth = cardWidth - 24;

            context.textAlign = "left";
            context.textBaseline = "alphabetic";
            context.fillStyle = colors.text;
            context.font = `600 13px ${canvasFont}`;
            context.fillText(
              fitMiddle(
                (text) => context.measureText(text).width,
                cardTitleOf(node.endpoint.name, node.endpoint.workloadKind),
                // Clear of the dot of a card with problems.
                node.hasProblems ? textWidth - 12 : textWidth,
              ),
              left,
              y + 21,
            );

            context.fillStyle = colors.secondaryText;
            context.font = `11px ${canvasFont}`;
            context.fillText(fit(context, subtitleOf(node), textWidth), left, y + 37);

            const ports = node.ports.length
              ? `:${node.ports.slice(0, 3).join(", :")}${node.ports.length > 3 ? ` +${node.ports.length - 3}` : ""}`
              : "";
            const volume = formatVolume(node.volume, unit);

            // The volume stands out; the ports take what room it leaves.
            context.textAlign = "right";
            context.fillStyle = colors.text;
            context.font = `600 11px ${canvasFont}`;
            context.fillText(volume, x + cardWidth - 10, y + 50);

            const volumeWidth = context.measureText(volume).width;

            context.textAlign = "left";
            context.fillStyle = colors.secondaryText;
            context.font = `11px ${canvasFont}`;
            context.fillText(fit(context, ports, textWidth - volumeWidth - 8), left, y + 50);

            context.globalAlpha = 1;
          }}
          nodePointerAreaPaint={(node, color, context) => {
            context.fillStyle = color;
            context.fillRect((node.x ?? 0) - cardWidth / 2, (node.y ?? 0) - cardHeight / 2, cardWidth, cardHeight);
          }}
          linkLabel={(link) => linkTitle(link, unit)}
          linkCanvasObjectMode={() => "replace"}
          linkCanvasObject={(link, context) => {
            const { route } = link;

            if (!route) return;

            const emphasized = isEmphasized(link);
            const width = emphasized ? link.width + 1.5 : link.width;

            context.globalAlpha = isDimmed(link) ? 0.06 : emphasized ? 1 : restingAlpha;
            context.strokeStyle = link.plain ? plainStroke(context, link, route) : link.color;
            // The arrow head sits at the target, in its colour for a plain edge.
            context.fillStyle = link.plain ? link.targetColor : link.color;
            context.lineWidth = width;
            context.setLineDash(link.dropped ? [6, 4] : []);
            tracePath(context, route);
            context.stroke();
            context.setLineDash([]);

            if (hasDots(link)) {
              // Dots that move along the edge, in the direction of the traffic.
              context.globalAlpha = 1;
              context.strokeStyle = colors.text;
              context.lineWidth = Math.max(1, width / 2);
              context.setLineDash([2, 14]);
              context.lineDashOffset = -((Date.now() / 30) % 16);
              tracePath(context, route);
              context.stroke();
              context.setLineDash([]);
              context.lineDashOffset = 0;
            }

            if (!link.directionUnknown) {
              context.globalAlpha = isDimmed(link) ? 0.06 : emphasized ? 1 : restingAlpha;
              drawArrow(context, route.arrowFrom, route.end, 6 + width);
            }

            context.globalAlpha = 1;
          }}
          linkPointerAreaPaint={(link, color, context) => {
            if (!link.route) return;

            context.strokeStyle = color;
            context.lineWidth = link.width + 8;
            tracePath(context, link.route);
            context.stroke();
          }}
          onRenderFramePost={drawLabels}
          onNodeHover={(node) => setHoveredNode(node?.id)}
          onLinkHover={(link) => setHoveredLink(link?.id)}
          onNodeClick={(node) => model.select({ type: "node", id: node.id })}
          onLinkClick={(link) => model.select({ type: "link", id: link.id })}
          onBackgroundClick={() => model.select(undefined)}
        />
      )}
      <div className={styles.zoomControls}>
        <Icon
          material="add"
          small
          className={styles.zoomButton}
          tooltip="Zoom in"
          aria-label="Zoom in"
          onClick={() => zoomBy(zoomStep)}
        />
        <Icon
          material="remove"
          small
          className={styles.zoomButton}
          tooltip="Zoom out"
          aria-label="Zoom out"
          onClick={() => zoomBy(1 / zoomStep)}
        />
        <Icon
          material="fit_screen"
          small
          className={styles.zoomButton}
          tooltip="Fit the map to the view"
          aria-label="Fit the map to the view"
          onClick={() => fitGraph(300)}
        />
      </div>
    </div>
  );
});
