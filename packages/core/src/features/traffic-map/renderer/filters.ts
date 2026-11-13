/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import type { AggregatedFlow, ExternalPeerStat, TrafficEndpoint, TrafficSourceName } from "../common/types";

/** The namespaces of the cluster's own machinery, which "Hide system traffic" leaves out. */
export const systemNamespaces: ReadonlySet<string> = new Set([
  "kube-system",
  "kube-public",
  "kube-node-lease",
  "cert-manager",
  "caretta",
  "cilium",
  "calico-system",
  "tigera-operator",
  "gatekeeper-system",
  "argo-rollouts",
  "argocd",
  "flux-system",
  "monitoring",
  "observability",
  "istio-system",
  "linkerd",
  "gmp-system",
  "gmp-public",
  "datadog",
  "opencost",
  "external-dns",
  "ingress-nginx",
  "traefik",
  "velero",
  "vault",
  "external-secrets",
]);

const metadataHosts = new Set([
  "instance-data.ec2.internal",
  "metadata.google.internal",
  "metadata.google.internal.",
  "metadata.azure.com",
]);

/** An address that only the node itself talks to: link-local, loopback or a cloud metadata service. */
export function isLocalEndpoint(endpoint: TrafficEndpoint): boolean {
  const name = endpoint.name.toLowerCase();
  const ip = endpoint.ip ?? "";

  return (
    metadataHosts.has(name) ||
    name.endsWith(".metadata.azure.com") ||
    name.startsWith("169.254.") ||
    ip.startsWith("169.254.") ||
    name === "localhost" ||
    name.startsWith("127.") ||
    name === "0.0.0.0"
  );
}

const privateAddress = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/** Traffic of the cluster's own machinery rather than of its applications. */
export function isSystemEndpoint(endpoint: TrafficEndpoint): boolean {
  const name = endpoint.name;

  if (endpoint.namespace && systemNamespaces.has(endpoint.namespace)) return true;
  if (endpoint.kind === "Host") return true;
  if ((endpoint.kind === "External" || endpoint.kind === "Unknown") && /^(host|health|init|unmanaged)$/.test(name)) {
    return true;
  }
  if (name.startsWith("fe80:") || name.startsWith("ff0")) return true;
  if (isLocalEndpoint(endpoint)) return true;
  if (endpoint.namespace === "default" && name === "kubernetes") return true;
  if (/^\d+-\d+-\d+-\d+\./.test(name) || /^(ec2|ip)-/.test(name)) return true;
  if (endpoint.kind === "External" && endpoint.ip && privateAddress.test(endpoint.ip)) return true;

  return false;
}

export function isOutsideCluster(endpoint: TrafficEndpoint): boolean {
  return endpoint.kind === "External" || endpoint.kind === "Host" || endpoint.kind === "Unknown";
}

export type L7Filter = "all" | "HTTP" | "DNS" | "TCP";

export interface TrafficFilters {
  hideSystem: boolean;
  hideExternal: boolean;
  /** Draw every connection from outside the cluster as one Internet node. */
  collapseInternet: boolean;
  l7: L7Filter;
  /** Verdicts to keep; empty for all. */
  verdicts: readonly string[];
  /** HTTP status classes to keep ("2xx"…); empty for all. */
  statusClasses: readonly string[];
  /** Namespaces to leave out. */
  hiddenNamespaces: readonly string[];
  /** The least volume of an edge, in its source's unit (connections or requests per second). */
  minVolume: number;
  /** A node id to draw alone with its neighbours. */
  focus?: string;
}

export const defaultFilters: TrafficFilters = {
  hideSystem: true,
  hideExternal: false,
  collapseInternet: true,
  l7: "all",
  verdicts: [],
  statusClasses: [],
  hiddenNamespaces: [],
  minVolume: 0,
};

/** The id of a node: namespace and name, or the name alone outside a namespace. */
export function nodeIdOf(endpoint: TrafficEndpoint): string {
  return endpoint.namespace ? `${endpoint.namespace}/${endpoint.name}` : endpoint.name;
}

/** Whether a source measures rates (requests per second) rather than counting connections. */
export function isRateSource(source: TrafficSourceName | undefined): boolean {
  return source === "istio" || source === "beyla";
}

/** The volume of an edge: its request rate for a rate-based source, its connections otherwise. */
export function volumeOf(flow: AggregatedFlow, rateBased: boolean): number {
  return rateBased ? (flow.requestRate ?? flow.connections) : flow.connections || flow.flowCount;
}

export const minVolumeSteps = {
  connections: [0, 100, 1_000, 10_000, 100_000],
  rate: [0, 1, 10, 100, 1_000],
};

const internetEndpoint: TrafficEndpoint = { name: "Internet", namespace: "", kind: "External" };

function hasStatusClass(flow: AggregatedFlow, classes: readonly string[]): boolean {
  return classes.some(
    (statusClass) =>
      (flow.httpStatusCounts?.[statusClass] ?? 0) > 0 || (statusClass === "5xx" && (flow.errorCount ?? 0) > 0),
  );
}

function matchesL7(flow: AggregatedFlow, l7: L7Filter): boolean {
  switch (l7) {
    case "all":
      return true;
    case "HTTP":
      return flow.l7Protocol === "HTTP" || flow.l7Protocol === "gRPC" || Boolean(flow.topHttpPaths?.length);
    case "DNS":
      return flow.l7Protocol === "DNS" || Boolean(flow.topDnsQueries?.length);
    case "TCP":
      return !flow.l7Protocol;
  }
}

/** The outside addresses of several edges, summed per name, busiest first. */
export function mergeExternalPeers(flows: readonly Pick<AggregatedFlow, "externalPeers">[]): ExternalPeerStat[] {
  const merged = new Map<string, ExternalPeerStat>();

  for (const peer of flows.flatMap((flow) => flow.externalPeers ?? [])) {
    const existing = merged.get(peer.name);

    if (!existing) {
      merged.set(peer.name, { ...peer, ips: [...peer.ips], aliases: peer.aliases && [...peer.aliases] });
      continue;
    }

    existing.flowCount += peer.flowCount;
    existing.connections += peer.connections;
    existing.ips = [...new Set([...existing.ips, ...peer.ips])];

    if (peer.aliases) {
      existing.aliases = [...new Set([...(existing.aliases ?? []), ...peer.aliases])];
    }
  }

  return [...merged.values()].sort((a, b) => b.flowCount - a.flowCount || a.name.localeCompare(b.name));
}

/** Merges the edges that the Internet node now stands for, summing what they carry. */
function collapseInternet(flows: readonly AggregatedFlow[]): AggregatedFlow[] {
  const merged = new Map<string, AggregatedFlow>();
  const result: AggregatedFlow[] = [];

  for (const flow of flows) {
    const fromOutside = flow.source.kind === "External" && !isOutsideCluster(flow.destination);

    if (!fromOutside) {
      result.push(flow);
      continue;
    }

    const key = `${nodeIdOf(flow.destination)}|${flow.port}|${flow.directionUnknown ? "u" : "d"}`;
    const existing = merged.get(key);

    if (!existing) {
      const copy = { ...flow, source: internetEndpoint };

      merged.set(key, copy);
      result.push(copy);
      continue;
    }

    existing.flowCount += flow.flowCount;
    existing.connections += flow.connections;
    existing.bytesSent += flow.bytesSent;
    existing.bytesRecv += flow.bytesRecv;
    existing.lastSeen = Math.max(existing.lastSeen, flow.lastSeen);

    if (flow.externalPeers) {
      existing.externalPeers = mergeExternalPeers([existing, flow]);
    }

    if (flow.requestRate !== undefined) existing.requestRate = (existing.requestRate ?? 0) + flow.requestRate;
    if (flow.errorRate !== undefined) existing.errorRate = (existing.errorRate ?? 0) + flow.errorRate;
    if (flow.requestCount !== undefined) existing.requestCount = (existing.requestCount ?? 0) + flow.requestCount;
    if (flow.errorCount !== undefined) existing.errorCount = (existing.errorCount ?? 0) + flow.errorCount;
  }

  return result;
}

/** The edges that the view draws, after its filters. */
export function applyFilters(
  flows: readonly AggregatedFlow[],
  filters: TrafficFilters,
  rateBased: boolean,
): AggregatedFlow[] {
  const hidden = new Set(filters.hiddenNamespaces);

  let result = flows.filter((flow) => {
    const { source, destination } = flow;

    if (isLocalEndpoint(source) || isLocalEndpoint(destination)) return false;
    if (filters.hideSystem && (isSystemEndpoint(source) || isSystemEndpoint(destination))) return false;
    if (filters.hideExternal && (isOutsideCluster(source) || isOutsideCluster(destination))) return false;
    if (!filters.focus && (hidden.has(source.namespace) || hidden.has(destination.namespace))) return false;
    if (filters.minVolume > 0 && volumeOf(flow, rateBased) < filters.minVolume) return false;
    if (!matchesL7(flow, filters.l7)) return false;
    if (filters.verdicts.length && !filters.verdicts.some((verdict) => (flow.verdictCounts?.[verdict] ?? 0) > 0)) {
      return false;
    }
    if (filters.statusClasses.length && !hasStatusClass(flow, filters.statusClasses)) return false;

    return true;
  });

  if (filters.collapseInternet) {
    result = collapseInternet(result);
  }

  if (filters.focus) {
    const focus = filters.focus;

    result = result.filter((flow) => nodeIdOf(flow.source) === focus || nodeIdOf(flow.destination) === focus);
  }

  return result;
}

/** The verdicts and status classes that the flows carry, which the filters offer. */
export function availableFacets(flows: readonly AggregatedFlow[]) {
  const verdicts = new Set<string>();
  const statusClasses = new Set<string>();
  const namespaces = new Map<string, number>();
  let hasL7 = false;

  for (const flow of flows) {
    Object.keys(flow.verdictCounts ?? {}).forEach((verdict) => verdicts.add(verdict));
    Object.keys(flow.httpStatusCounts ?? {}).forEach((statusClass) => statusClasses.add(statusClass));
    hasL7 ||= Boolean(flow.l7Protocol || flow.topHttpPaths?.length || flow.topDnsQueries?.length);

    for (const endpoint of [flow.source, flow.destination]) {
      if (endpoint.namespace) {
        namespaces.set(endpoint.namespace, (namespaces.get(endpoint.namespace) ?? 0) + 1);
      }
    }
  }

  return {
    // Offered only when something other than "forwarded" happened.
    verdicts: verdicts.size > 1 || (verdicts.size === 1 && !verdicts.has("forwarded")) ? [...verdicts].sort() : [],
    statusClasses: [...statusClasses].sort(),
    namespaces: [...namespaces].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name),
    hasL7,
  };
}
