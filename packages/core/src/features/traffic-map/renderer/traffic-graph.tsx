/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import * as d3 from "d3-force";
import { observer } from "mobx-react";
import { useEffect, useMemo, useRef } from "react";
import ForceGraph2D from "react-force-graph-2d";
import { ElementSize } from "../../resource-map/renderer/helpers/element-size";
import { refWithSetter } from "../../resource-map/renderer/helpers/graph-methods";
import { formatLatency, formatVolume, nodeColor } from "./graph";
import styles from "./traffic-map.module.scss";

import type { ForceGraphMethods } from "react-force-graph-2d";

import type { TrafficLink, TrafficNode } from "./graph";
import type { TrafficMapModel } from "./traffic-map-model";

export interface TrafficGraphProps {
  model: TrafficMapModel;
  /** The colour of the labels of the nodes. */
  textColor: string;
}

type GraphMethods = ForceGraphMethods<TrafficNode, TrafficLink>;

function nodeRadius(node: TrafficNode): number {
  return Math.min(14, 5 + Math.log10(Math.max(node.volume, 1)) * 1.5);
}

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

/** The traffic of the map as a force-directed graph: workloads as nodes, their connections as directed edges. */
export const TrafficGraphView = observer(({ model, textColor }: TrafficGraphProps) => {
  const size = useMemo(() => new ElementSize(), []);
  const graphRef = useMemo(
    () =>
      refWithSetter<GraphMethods>((methods) => {
        if (!methods) return;

        methods.d3Force("charge", d3.forceManyBody().strength(-180).distanceMax(400));
        methods.d3Force(
          "collide",
          d3.forceCollide<TrafficNode>((node) => nodeRadius(node) + 18),
        );
        (methods.d3Force("link") as d3.ForceLink<TrafficNode, TrafficLink> | undefined)?.distance(90);
      }),
    [],
  );
  const positions = useRef(new Map<string, { x?: number; y?: number }>());
  const fitted = useRef(false);
  const { graph, selection, rateBased } = model;

  // Fresh objects for the library, which mutates them, with the positions that
  // nodes already had, so a refresh does not scatter the graph again.
  const data = useMemo(
    () => ({
      nodes: graph.nodes.map((node) => ({ ...node, ...positions.current.get(node.id) })),
      links: graph.links.map((link) => ({ ...link })),
    }),
    [graph],
  );

  useEffect(() => {
    fitted.current = data.nodes.every((node) => positions.current.has(node.id));
  }, [data]);

  const selectedNode = selection?.type === "node" ? selection.id : undefined;
  const selectedLink = selection?.type === "link" ? selection.id : undefined;

  const neighbours = useMemo(() => {
    const ids = new Set<string>();

    if (!selectedNode) return ids;

    for (const link of graph.links) {
      if (link.source === selectedNode || link.target === selectedNode) {
        ids.add(String(link.source));
        ids.add(String(link.target));
      }
    }

    return ids;
  }, [graph, selectedNode]);

  const endpointId = (end: string | TrafficNode) => (typeof end === "string" ? end : end.id);
  const isDimmed = (link: TrafficLink) =>
    (selectedNode !== undefined &&
      endpointId(link.source) !== selectedNode &&
      endpointId(link.target) !== selectedNode) ||
    (selectedLink !== undefined && link.id !== selectedLink);

  return (
    <div className={styles.graph} ref={(element) => size.follow(element)}>
      {size.width > 0 && size.height > 0 && (
        <ForceGraph2D<TrafficNode, TrafficLink>
          ref={graphRef}
          width={size.width}
          height={size.height}
          graphData={data}
          nodeId="id"
          cooldownTicks={150}
          onEngineStop={() => {
            for (const node of data.nodes) {
              positions.current.set(node.id, { x: node.x, y: node.y });
            }

            if (!fitted.current) {
              fitted.current = true;
              graphRef.current?.zoomToFit(400, 60);
            }
          }}
          nodeLabel={(node) => `${node.endpoint.kind}: ${node.id}`}
          nodeCanvasObject={(node, context, scale) => {
            const radius = nodeRadius(node);
            const x = node.x ?? 0;
            const y = node.y ?? 0;
            const dimmed = selectedNode !== undefined && !neighbours.has(node.id);

            context.globalAlpha = dimmed ? 0.25 : 1;
            context.beginPath();
            context.arc(x, y, radius, 0, 2 * Math.PI);
            context.fillStyle = nodeColor(node.endpoint);
            context.fill();

            if (node.hasProblems || node.hot || node.id === selectedNode) {
              context.lineWidth = node.id === selectedNode ? 3 : 2;
              context.strokeStyle = node.hasProblems ? "#ef4444" : node.id === selectedNode ? textColor : "#f97316";
              context.stroke();
            }

            if (scale > 0.6 || node.id === selectedNode) {
              const fontSize = Math.max(10 / scale, 3);

              context.font = `${fontSize}px sans-serif`;
              context.textAlign = "center";
              context.textBaseline = "top";
              context.fillStyle = textColor;
              context.fillText(node.endpoint.name, x, y + radius + 2);
            }

            context.globalAlpha = 1;
          }}
          nodePointerAreaPaint={(node, color, context) => {
            context.beginPath();
            context.arc(node.x ?? 0, node.y ?? 0, nodeRadius(node) + 2, 0, 2 * Math.PI);
            context.fillStyle = color;
            context.fill();
          }}
          linkLabel={(link) => linkTitle(link, rateBased)}
          linkColor={(link) => (isDimmed(link) ? `${link.color}33` : link.color)}
          linkWidth={(link) => (link.id === selectedLink ? link.width + 2 : link.width)}
          linkLineDash={(link) => (link.dropped ? [6, 3] : null)}
          linkCurvature={0.15}
          linkDirectionalArrowLength={(link) => (link.flow.directionUnknown ? 0 : 6)}
          linkDirectionalArrowRelPos={0.95}
          linkDirectionalParticles={(link) => (link.hot ? 3 : 0)}
          linkDirectionalParticleWidth={(link) => link.width + 1}
          linkDirectionalParticleSpeed={0.008}
          onNodeClick={(node) => model.select({ type: "node", id: node.id })}
          onLinkClick={(link) => model.select({ type: "link", id: link.id })}
          onBackgroundClick={() => model.select(undefined)}
        />
      )}
    </div>
  );
});
