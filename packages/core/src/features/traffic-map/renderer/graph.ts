/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { nodeIdOf, volumeOf } from "./filters";

import type { AggregatedFlow, TrafficEndpoint } from "../common/types";

export interface TrafficNode {
  id: string;
  endpoint: TrafficEndpoint;
  /** The volume of the edges at the node. */
  volume: number;
  /** The node has an edge with 5xx errors or dropped flows. */
  hasProblems: boolean;
  hot: boolean;
  /** The ports that the node is called on, busiest first. */
  ports: number[];
  // Set by the layout.
  x?: number;
  y?: number;
}

export interface TrafficLink {
  id: string;
  source: string | TrafficNode;
  target: string | TrafficNode;
  flow: AggregatedFlow;
  volume: number;
  width: number;
  color: string;
  hot: boolean;
  dropped: boolean;
}

export interface TrafficGraph {
  nodes: TrafficNode[];
  links: TrafficLink[];
}

export const edgeColors = {
  error: "#ef4444",
  hot: "#f97316",
  http: "#3b82f6",
  dns: "#06b6d4",
  tcp: "#6b7280",
};

const namespacePalette = [
  "#dc2626",
  "#2563eb",
  "#16a34a",
  "#9333ea",
  "#ea580c",
  "#0891b2",
  "#c026d3",
  "#65a30d",
  "#0d9488",
  "#e11d48",
  "#7c3aed",
  "#ca8a04",
  "#4f46e5",
  "#db2777",
  "#059669",
  "#d97706",
];

/** A colour per namespace, the same for a namespace wherever it is drawn. */
export function namespaceColor(namespace: string): string {
  if (!namespace) return "#78716c";

  let hash = 0;

  for (const char of namespace) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }

  return namespacePalette[hash % namespacePalette.length];
}

export const externalColor = "#eab308";
export const internetColor = "#0ea5e9";

export function nodeColor(endpoint: TrafficEndpoint): string {
  if (endpoint.kind === "External" && endpoint.name === "Internet") return internetColor;
  if (endpoint.kind === "External" || endpoint.kind === "Unknown") return externalColor;
  if (endpoint.kind === "Host") return "#64748b";

  return namespaceColor(endpoint.namespace);
}

/** The width of an edge: the order of magnitude of its volume, between 1.5 and 6. */
export function edgeWidth(volume: number): number {
  return Math.min(6, Math.max(1.5, Math.log10(Math.max(volume, 1_000)) - 1.5));
}

export function hasErrors(flow: AggregatedFlow): boolean {
  return (flow.errorCount ?? 0) > 0 || (flow.httpStatusCounts?.["5xx"] ?? 0) > 0;
}

export function isDropped(flow: AggregatedFlow): boolean {
  return (flow.verdictCounts?.dropped ?? 0) > 0;
}

function edgeColor(flow: AggregatedFlow, hot: boolean): string {
  if (hasErrors(flow)) return edgeColors.error;
  if (hot) return edgeColors.hot;
  if (flow.l7Protocol === "HTTP" || flow.l7Protocol === "gRPC") return edgeColors.http;
  if (flow.l7Protocol === "DNS") return edgeColors.dns;

  return edgeColors.tcp;
}

export function linkIdOf(flow: AggregatedFlow): string {
  return `${nodeIdOf(flow.source)}->${nodeIdOf(flow.destination)}:${flow.port}${flow.directionUnknown ? ":unoriented" : ""}`;
}

/**
 * The nodes and edges of the flows. The busiest tenth of the edges is the hot
 * path, which the graph animates.
 */
export function buildTrafficGraph(flows: readonly AggregatedFlow[], rateBased: boolean): TrafficGraph {
  const volumes = flows.map((flow) => volumeOf(flow, rateBased)).sort((a, b) => b - a);
  const hotIndex = Math.floor(volumes.length * 0.1) - 1;
  const hotThreshold = hotIndex >= 0 ? volumes[hotIndex] : Number.POSITIVE_INFINITY;
  const nodes = new Map<string, TrafficNode>();
  const portVolumes = new Map<string, Map<number, number>>();
  const links: TrafficLink[] = [];

  const nodeOf = (endpoint: TrafficEndpoint) => {
    const id = nodeIdOf(endpoint);
    let node = nodes.get(id);

    if (!node) {
      node = { id, endpoint, volume: 0, hasProblems: false, hot: false, ports: [] };
      nodes.set(id, node);
    }

    return node;
  };

  for (const flow of flows) {
    const volume = volumeOf(flow, rateBased);
    const hot = volume > 0 && volume >= hotThreshold;
    const dropped = isDropped(flow);
    const source = nodeOf(flow.source);
    const target = nodeOf(flow.destination);

    if (flow.port > 0 && !flow.directionUnknown) {
      const ports = portVolumes.get(target.id) ?? new Map<number, number>();

      ports.set(flow.port, (ports.get(flow.port) ?? 0) + volume);
      portVolumes.set(target.id, ports);
    }

    for (const node of [source, target]) {
      node.volume += volume;
      node.hot ||= hot;
      node.hasProblems ||= dropped || hasErrors(flow);
    }

    links.push({
      id: linkIdOf(flow),
      source: source.id,
      target: target.id,
      flow,
      volume,
      width: edgeWidth(volume),
      color: edgeColor(flow, hot),
      hot,
      dropped,
    });
  }

  for (const [id, ports] of portVolumes) {
    nodes.get(id)!.ports = [...ports].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([port]) => port);
  }

  return { nodes: [...nodes.values()], links };
}

/** Whether two graphs have the same nodes and edges, so the drawn one can stay where it is. */
export function sameShape(a: TrafficGraph, b: TrafficGraph): boolean {
  if (a.nodes.length !== b.nodes.length || a.links.length !== b.links.length) return false;

  const nodeIds = new Set(a.nodes.map((node) => node.id));
  const linkIds = new Set(a.links.map((link) => link.id));

  return b.nodes.every((node) => nodeIds.has(node.id)) && b.links.every((link) => linkIds.has(link.id));
}

/** A count or a rate in few characters: 1.2K, 3.4M. */
export function formatVolume(value: number, rateBased: boolean): string {
  const suffix = rateBased ? "/s" : "";

  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M${suffix}`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K${suffix}`;
  if (rateBased && value < 10) return `${value.toFixed(2)}${suffix}`;

  return `${Math.round(value)}${suffix}`;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;

  return `${bytes} B`;
}

export function formatLatency(ms: number | undefined): string {
  if (ms === undefined) return "—";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  if (ms >= 10) return `${Math.round(ms)} ms`;

  return `${ms.toFixed(1)} ms`;
}
