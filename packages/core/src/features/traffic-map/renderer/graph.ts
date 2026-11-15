/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { nodeIdOf, volumeOf } from "./filters";

import type { AggregatedFlow, TrafficEndpoint } from "../common/types";
import type { VolumeUnit } from "./filters";

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

/** The traffic from one node to another, on every port, drawn as one edge. */
export interface TrafficLink {
  id: string;
  source: string | TrafficNode;
  target: string | TrafficNode;
  /** The aggregated flows of the pair, one per port, busiest first. */
  flows: AggregatedFlow[];
  /** The ports of the flows, busiest first, without the zero of an unknown port. */
  ports: number[];
  directionUnknown: boolean;
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

const minEdgeWidth = 1.5;
const maxEdgeWidth = 6;

/**
 * The width of an edge, between 1.5 and 6: where its volume lies between the
 * least and the busiest of the graph, on a logarithmic scale, so a graph of
 * bytes and one of request rates look alike.
 */
export function edgeWidth(volume: number, least: number, busiest: number): number {
  const low = Math.log10(Math.max(least, 1e-3));
  const high = Math.log10(Math.max(busiest, 1e-3));

  if (high - low < 1e-9) {
    return (minEdgeWidth + maxEdgeWidth) / 2;
  }

  const share = (Math.log10(Math.max(volume, 1e-3)) - low) / (high - low);

  return minEdgeWidth + Math.min(1, Math.max(0, share)) * (maxEdgeWidth - minEdgeWidth);
}

export function hasErrors(flow: AggregatedFlow): boolean {
  return (flow.errorCount ?? 0) > 0 || (flow.httpStatusCounts?.["5xx"] ?? 0) > 0;
}

export function isDropped(flow: AggregatedFlow): boolean {
  return (flow.verdictCounts?.dropped ?? 0) > 0;
}

/** The colour of an edge: errors first, then what it carries. Its volume shows in its width, not its colour. */
function edgeColor(flows: readonly AggregatedFlow[]): string {
  if (flows.some(hasErrors)) return edgeColors.error;
  if (flows.some((flow) => flow.l7Protocol === "HTTP" || flow.l7Protocol === "gRPC")) return edgeColors.http;
  if (flows.some((flow) => flow.l7Protocol === "DNS")) return edgeColors.dns;

  return edgeColors.tcp;
}

/** The id of the edge that a flow is drawn on: its two nodes and whether its direction is known, on any port. */
export function linkIdOf(flow: AggregatedFlow): string {
  return `${nodeIdOf(flow.source)}->${nodeIdOf(flow.destination)}${flow.directionUnknown ? ":unoriented" : ""}`;
}

/** A key for one aggregated flow: its edge and its port. */
export function flowKeyOf(flow: AggregatedFlow): string {
  return `${linkIdOf(flow)}:${flow.port}`;
}

/**
 * The nodes and edges of the flows: an edge per pair of nodes, whatever the
 * ports, so the traffic between two workloads is one line. The busiest tenth
 * of the edges is the hot path, which the graph animates.
 */
export function buildTrafficGraph(flows: readonly AggregatedFlow[], unit: VolumeUnit): TrafficGraph {
  const nodes = new Map<string, TrafficNode>();
  const portVolumes = new Map<string, Map<number, number>>();
  const pairs = new Map<string, AggregatedFlow[]>();

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
    const id = linkIdOf(flow);

    pairs.set(id, [...(pairs.get(id) ?? []), flow]);
  }

  const volumeOfPair = (pair: readonly AggregatedFlow[]) => pair.reduce((sum, flow) => sum + volumeOf(flow, unit), 0);
  const volumes = [...pairs.values()].map(volumeOfPair).sort((a, b) => b - a);
  const busiest = volumes[0] ?? 0;
  const least = volumes.filter((volume) => volume > 0).at(-1) ?? 0;
  const hotIndex = Math.floor(volumes.length * 0.1) - 1;
  const hotThreshold = hotIndex >= 0 ? volumes[hotIndex] : Number.POSITIVE_INFINITY;
  const links: TrafficLink[] = [];

  for (const [id, pair] of pairs) {
    const sorted = [...pair].sort((a, b) => volumeOf(b, unit) - volumeOf(a, unit) || a.port - b.port);
    const [first] = sorted;
    const volume = volumeOfPair(sorted);
    const hot = volume > 0 && volume >= hotThreshold;
    const dropped = sorted.some(isDropped);
    const source = nodeOf(first.source);
    const target = nodeOf(first.destination);

    for (const flow of sorted) {
      if (flow.port > 0 && !flow.directionUnknown) {
        const ports = portVolumes.get(target.id) ?? new Map<number, number>();

        ports.set(flow.port, (ports.get(flow.port) ?? 0) + volumeOf(flow, unit));
        portVolumes.set(target.id, ports);
      }
    }

    for (const node of [source, target]) {
      node.volume += volume;
      node.hot ||= hot;
      node.hasProblems ||= dropped || sorted.some(hasErrors);
    }

    links.push({
      id,
      source: source.id,
      target: target.id,
      flows: sorted,
      ports: sorted.map((flow) => flow.port).filter((port) => port > 0),
      directionUnknown: Boolean(first.directionUnknown),
      volume,
      width: edgeWidth(volume, least, busiest),
      color: edgeColor(sorted),
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

/** A volume in its unit in few characters: 1.2K, 3.4M/s, 5.6 MiB. */
export function formatVolume(value: number, unit: VolumeUnit): string {
  if (unit === "bytes") return formatBytes(value);

  const suffix = unit === "rate" ? "/s" : "";

  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M${suffix}`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K${suffix}`;
  if (unit === "rate" && value < 10) return `${value.toFixed(2)}${suffix}`;

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

/**
 * A name cut to a width with an ellipsis in its middle, keeping its start and
 * its end: workloads of one application often share a long prefix and differ
 * only at the end, which an ellipsis at the end would hide.
 */
export function fitMiddle(measure: (text: string) => number, text: string, width: number): string {
  if (measure(text) <= width) return text;

  let keep = text.length - 1;

  while (keep > 2) {
    const head = Math.ceil(keep * 0.45);
    const candidate = `${text.slice(0, head)}…${text.slice(text.length - (keep - head))}`;

    if (measure(candidate) <= width) return candidate;

    keep--;
  }

  return `${text.slice(0, 1)}…`;
}

/** The name a card shows: a Deployment's name without the "-deployment" that its kind already says. */
export function cardTitleOf(name: string, workloadKind: string | undefined): string {
  return workloadKind === "Deployment" && name.endsWith("-deployment") && name.length > "-deployment".length
    ? name.slice(0, -"-deployment".length)
    : name;
}

/** How opaque edges are at rest: the more of them, the fainter, so the cards and the structure stay readable. */
export function restingEdgeAlpha(edgeCount: number): number {
  if (edgeCount > 40) return 0.3;
  if (edgeCount > 15) return 0.5;

  return 0.75;
}
