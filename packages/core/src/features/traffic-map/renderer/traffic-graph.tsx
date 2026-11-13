/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { observer } from "mobx-react";
import { useEffect, useMemo, useRef } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { ElementSize } from "../../resource-map/renderer/helpers/element-size";
import { formatLatency, formatVolume, nodeColor } from "./graph";
import { cardHeight, cardWidth, layoutColumns } from "./layout";
import styles from "./traffic-map.module.scss";

import type { ForceGraphMethods } from "react-force-graph-2d";

import type { TrafficLink, TrafficNode } from "./graph";
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

type GraphMethods = ForceGraphMethods<TrafficNode, TrafficLink>;
type Point = { x: number; y: number };

const radius = 6;
const problemColor = "#ef4444";
const hotColor = "#f97316";
const kindLabels: Record<string, string> = {
  Pod: "Pod",
  Workload: "Workload",
  Service: "Service",
  External: "External",
  Host: "Node",
  Unknown: "Unknown",
};

function linkTitle(link: TrafficLink, rateBased: boolean): string {
  const { flow } = link;
  const parts = [
    flow.l7Protocol ?? flow.protocol.toUpperCase(),
    flow.port ? `:${flow.port}` : "",
    formatVolume(link.volume, rateBased),
  ];
  const latency = flow.latencyP50Ms ?? flow.avgLatencyMs;

  if (latency !== undefined) parts.push(formatLatency(latency));
  if ((flow.errorCount ?? 0) > 0) parts.push(`${flow.errorCount} err`);
  if (link.dropped) parts.push(`${flow.verdictCounts?.dropped} dropped`);

  return parts.filter(Boolean).join(" · ");
}

/** Text cut to a width, with an ellipsis. */
function fit(context: CanvasRenderingContext2D, text: string, width: number): string {
  if (context.measureText(text).width <= width) return text;

  let end = text.length;

  while (end > 1 && context.measureText(`${text.slice(0, end)}…`).width > width) end--;

  return `${text.slice(0, end)}…`;
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
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

  if (endpoint.name === "Internet" && endpoint.kind === "External") return "Inbound from outside";

  return endpoint.namespace ? `${endpoint.namespace} · ${kind}` : kind;
}

/**
 * The curve of an edge: from the right side of the caller's card to the left
 * side of the callee's, or around the right sides when the callee is not
 * further right, as in a cycle.
 */
function curveOf(source: Point, target: Point): [Point, Point, Point, Point] {
  const half = cardWidth / 2;

  if (target.x > source.x) {
    const start = { x: source.x + half, y: source.y };
    const end = { x: target.x - half, y: target.y };
    const bend = Math.max(40, (end.x - start.x) / 2);

    return [start, { x: start.x + bend, y: start.y }, { x: end.x - bend, y: end.y }, end];
  }

  const start = { x: source.x + half, y: source.y };
  const end = { x: target.x + half, y: target.y };
  const bend = 60 + Math.abs(source.x - target.x) / 4;

  return [start, { x: start.x + bend, y: start.y }, { x: end.x + bend, y: end.y }, end];
}

function strokeCurve(context: CanvasRenderingContext2D, [start, first, second, end]: [Point, Point, Point, Point]) {
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.bezierCurveTo(first.x, first.y, second.x, second.y, end.x, end.y);
  context.stroke();
}

function drawArrow(context: CanvasRenderingContext2D, from: Point, to: Point, size: number) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);

  context.beginPath();
  context.moveTo(to.x, to.y);
  context.lineTo(to.x - size * Math.cos(angle - Math.PI / 7), to.y - size * Math.sin(angle - Math.PI / 7));
  context.lineTo(to.x - size * Math.cos(angle + Math.PI / 7), to.y - size * Math.sin(angle + Math.PI / 7));
  context.closePath();
  context.fill();
}

const endpointId = (end: string | TrafficNode) => (typeof end === "string" ? end : end.id);
const pointOf = (end: string | TrafficNode): Point | undefined =>
  typeof end === "string" || end.x === undefined || end.y === undefined ? undefined : { x: end.x, y: end.y };

/**
 * The traffic of the map: a card per workload, in columns from the callers on
 * the left to what they call on the right, and a curve per connection.
 */
export const TrafficGraphView = observer(({ model, colors }: TrafficGraphProps) => {
  const size = useMemo(() => new ElementSize(), []);
  const graphRef = useRef<GraphMethods | undefined>(undefined);
  const fittedFor = useRef("");
  const { graph, selection, rateBased } = model;

  // Fresh objects for the library, which mutates them, placed in their
  // columns and pinned there.
  const data = useMemo(() => {
    const points = layoutColumns(
      graph.nodes.map((node) => node.id),
      graph.links.map((link) => ({
        source: endpointId(link.source),
        target: endpointId(link.target),
        undirected: link.flow.directionUnknown,
      })),
      (id) => {
        const node = graph.nodes.find((candidate) => candidate.id === id);

        return `${node?.endpoint.namespace ? 1 : 0}|${id}`;
      },
    );

    return {
      nodes: graph.nodes.map((node) => {
        const point = points.get(node.id) ?? { x: 0, y: 0 };

        return { ...node, x: point.x, y: point.y, fx: point.x, fy: point.y };
      }),
      links: graph.links.map((link) => ({ ...link })),
    };
  }, [graph]);

  // Fit the view when other nodes are drawn, and keep the user's zoom on a
  // refresh of the same ones.
  const nodeKey = data.nodes
    .map((node) => node.id)
    .sort()
    .join("\n");

  useEffect(() => {
    if (fittedFor.current === nodeKey || size.width === 0) return;

    const timer = setTimeout(() => {
      graphRef.current?.zoomToFit(300, 80);
      fittedFor.current = nodeKey;
    }, 50);

    return () => clearTimeout(timer);
  }, [nodeKey, size.width, size.height]);

  const selectedNode = selection?.type === "node" ? selection.id : undefined;
  const selectedLink = selection?.type === "link" ? selection.id : undefined;

  const neighbours = useMemo(() => {
    const ids = new Set<string>();

    if (!selectedNode) return ids;

    for (const link of graph.links) {
      if (endpointId(link.source) === selectedNode || endpointId(link.target) === selectedNode) {
        ids.add(endpointId(link.source));
        ids.add(endpointId(link.target));
      }
    }

    return ids;
  }, [graph, selectedNode]);

  const isDimmed = (link: TrafficLink) =>
    (selectedNode !== undefined &&
      endpointId(link.source) !== selectedNode &&
      endpointId(link.target) !== selectedNode) ||
    (selectedLink !== undefined && link.id !== selectedLink);
  const animated = graph.links.some((link) => link.hot);

  return (
    <div className={styles.graph} ref={(element) => size.follow(element)}>
      {size.width > 0 && size.height > 0 && (
        <ForceGraph2D<TrafficNode, TrafficLink>
          ref={graphRef as never}
          width={size.width}
          height={size.height}
          graphData={data}
          nodeId="id"
          cooldownTicks={0}
          warmupTicks={0}
          enableNodeDrag={false}
          autoPauseRedraw={!animated}
          minZoom={0.1}
          maxZoom={4}
          nodeLabel={(node) => `${node.endpoint.kind}: ${node.id}`}
          nodeCanvasObject={(node, context) => {
            const x = (node.x ?? 0) - cardWidth / 2;
            const y = (node.y ?? 0) - cardHeight / 2;
            const selected = node.id === selectedNode;
            const dimmed = selectedNode !== undefined && !neighbours.has(node.id);

            context.globalAlpha = dimmed ? 0.3 : 1;

            // The card, with a band in the colour of its namespace.
            roundedRect(context, x, y, cardWidth, cardHeight);
            context.fillStyle = colors.card;
            context.fill();
            context.lineWidth = selected ? 2.5 : node.hasProblems || node.hot ? 1.8 : 1;
            context.strokeStyle = selected
              ? colors.selected
              : node.hasProblems
                ? problemColor
                : node.hot
                  ? hotColor
                  : colors.border;
            context.stroke();

            context.save();
            roundedRect(context, x, y, cardWidth, cardHeight);
            context.clip();
            context.fillStyle = nodeColor(node.endpoint);
            context.fillRect(x, y, 5, cardHeight);
            context.restore();

            const left = x + 14;
            const textWidth = cardWidth - 24;

            context.textAlign = "left";
            context.textBaseline = "alphabetic";
            context.fillStyle = colors.text;
            context.font = "600 13px sans-serif";
            context.fillText(fit(context, node.endpoint.name, textWidth), left, y + 21);

            context.fillStyle = colors.secondaryText;
            context.font = "11px sans-serif";
            context.fillText(fit(context, subtitleOf(node), textWidth), left, y + 37);

            const ports = node.ports.length
              ? `:${node.ports.slice(0, 3).join(", :")}${node.ports.length > 3 ? ` +${node.ports.length - 3}` : ""}`
              : "";
            const volume = formatVolume(node.volume, rateBased);

            context.fillText(fit(context, ports, textWidth - 60), left, y + 50);
            context.textAlign = "right";
            context.fillText(volume, x + cardWidth - 10, y + 50);

            context.globalAlpha = 1;
          }}
          nodePointerAreaPaint={(node, color, context) => {
            context.fillStyle = color;
            context.fillRect((node.x ?? 0) - cardWidth / 2, (node.y ?? 0) - cardHeight / 2, cardWidth, cardHeight);
          }}
          linkLabel={(link) => linkTitle(link, rateBased)}
          linkCanvasObjectMode={() => "replace"}
          linkCanvasObject={(link, context, scale) => {
            const source = pointOf(link.source);
            const target = pointOf(link.target);

            if (!source || !target) return;

            const curve = curveOf(source, target);
            const width = link.id === selectedLink ? link.width + 1.5 : link.width;

            context.globalAlpha = isDimmed(link) ? 0.15 : 0.9;
            context.strokeStyle = link.color;
            context.fillStyle = link.color;
            context.lineWidth = width;
            context.setLineDash(link.dropped ? [6, 4] : []);
            strokeCurve(context, curve);
            context.setLineDash([]);

            if (link.hot) {
              // Dashes that move along the busiest edges, in the direction of the traffic.
              context.globalAlpha = isDimmed(link) ? 0.15 : 1;
              context.strokeStyle = "#ffffff";
              context.lineWidth = Math.max(1, width / 2);
              context.setLineDash([2, 14]);
              context.lineDashOffset = -((Date.now() / 30) % 16);
              strokeCurve(context, curve);
              context.setLineDash([]);
              context.lineDashOffset = 0;
            }

            if (!link.flow.directionUnknown) {
              context.globalAlpha = isDimmed(link) ? 0.15 : 1;
              drawArrow(context, curve[2], curve[3], 6 + width);
            }

            if (scale > 0.9 && !isDimmed(link)) {
              const middle = {
                x: (curve[0].x + 3 * curve[1].x + 3 * curve[2].x + curve[3].x) / 8,
                y: (curve[0].y + 3 * curve[1].y + 3 * curve[2].y + curve[3].y) / 8,
              };
              const label = `${link.flow.port ? `:${link.flow.port} ` : ""}${formatVolume(link.volume, rateBased)}`;

              context.globalAlpha = 1;
              context.font = "10px sans-serif";
              context.textAlign = "center";
              context.textBaseline = "middle";

              const labelWidth = context.measureText(label).width + 8;

              context.fillStyle = colors.card;
              context.fillRect(middle.x - labelWidth / 2, middle.y - 7, labelWidth, 14);
              context.fillStyle = colors.secondaryText;
              context.fillText(label, middle.x, middle.y);
            }

            context.globalAlpha = 1;
          }}
          linkPointerAreaPaint={(link, color, context) => {
            const source = pointOf(link.source);
            const target = pointOf(link.target);

            if (!source || !target) return;

            context.strokeStyle = color;
            context.lineWidth = link.width + 8;
            strokeCurve(context, curveOf(source, target));
          }}
          onNodeClick={(node) => model.select({ type: "node", id: node.id })}
          onLinkClick={(link) => model.select({ type: "link", id: link.id })}
          onBackgroundClick={() => model.select(undefined)}
        />
      )}
    </div>
  );
});
