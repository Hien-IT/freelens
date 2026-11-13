/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import type { AggregatedFlow, DnsQueryStat, HttpPathStat, TrafficEndpoint, TrafficFlow } from "./types";

const topEntries = 10;

/**
 * The endpoint as the graph draws it: a pod with a known workload becomes that
 * workload, so a Deployment with fifty replicas is one node rather than fifty.
 * An endpoint that a source already names after its workload is kept as it is.
 */
export function graphEndpoint(endpoint: TrafficEndpoint): TrafficEndpoint {
  if (endpoint.kind !== "Pod" || !endpoint.workload || !endpoint.namespace || endpoint.workload === endpoint.name) {
    return endpoint;
  }

  return {
    name: endpoint.workload,
    namespace: endpoint.namespace,
    kind: "Workload",
    workload: endpoint.workload,
    workloadKind: endpoint.workloadKind,
  };
}

/** The flows with their endpoints as the graph draws them. */
export function graphFlows(flows: readonly TrafficFlow[]): TrafficFlow[] {
  return flows.map((flow) => ({
    ...flow,
    source: graphEndpoint(flow.source),
    destination: graphEndpoint(flow.destination),
  }));
}

/** A rate that can be summed: zero for a negative, NaN or infinite one. */
export function finiteRate(rate: number | undefined): number {
  return rate !== undefined && Number.isFinite(rate) && rate > 0 ? rate : 0;
}

/**
 * A per-second rate as a count, rounded, with a floor of one for any positive
 * rate, so a slow but real trickle of traffic or errors stays visible.
 */
export function roundRate(rate: number | undefined): number {
  const finite = finiteRate(rate);

  return finite === 0 ? 0 : Math.max(1, Math.round(finite));
}

/** The p-th percentile (0 to 1) of a sorted list. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }

  return sorted[Math.floor((sorted.length - 1) * p)];
}

/** The key that the aggregation groups flows by. */
export function aggregationKey(flow: Pick<TrafficFlow, "source" | "destination" | "port" | "directionUnknown">) {
  return [
    `${flow.source.namespace}/${flow.source.name}`,
    `${flow.destination.namespace}/${flow.destination.name}`,
    flow.port,
    flow.directionUnknown ? "u" : "d",
  ].join("|");
}

// A source that emits L7 records reports one request as two of them, the
// request and its response. Counting records would double every request, so
// requests and responses are counted apart and the larger of the two is kept.
interface PathAccumulator {
  requests: number;
  responses: number;
  latencyCount: number;
  latencySumMs: number;
  withStatus: number;
  errors: number;
}

interface DnsAccumulator {
  queries: number;
  responses: number;
  nxCount: number;
  ttlSum: number;
  ttlCount: number;
}

interface Accumulator {
  aggregate: AggregatedFlow;
  /** Latencies of single responses. */
  latencies: number[];
  /** Latencies already averaged by a metric-based source, with the request rate behind each. */
  means: { value: number; weight: number }[];
  statusCounts: Record<string, number>;
  paths: Map<string, PathAccumulator>;
  dns: Map<string, DnsAccumulator>;
  verdicts: Record<string, number>;
  dropReasons: Record<string, number>;
  l7Votes: Map<string, number>;
}

function increment(record: Record<string, number>, key: string) {
  record[key] = (record[key] ?? 0) + 1;
}

function newAccumulator(flow: TrafficFlow): Accumulator {
  return {
    aggregate: {
      source: flow.source,
      destination: flow.destination,
      protocol: flow.protocol,
      port: flow.port,
      flowCount: 0,
      bytesSent: 0,
      bytesRecv: 0,
      connections: 0,
      lastSeen: flow.lastSeen,
      directionUnknown: flow.directionUnknown || undefined,
    },
    latencies: [],
    means: [],
    statusCounts: {},
    paths: new Map(),
    dns: new Map(),
    verdicts: {},
    dropReasons: {},
    l7Votes: new Map(),
  };
}

function accumulate(accumulator: Accumulator, flow: TrafficFlow) {
  const { aggregate } = accumulator;

  aggregate.flowCount++;
  aggregate.bytesSent += flow.bytesSent;
  aggregate.bytesRecv += flow.bytesRecv;
  aggregate.connections += flow.connections;
  aggregate.lastSeen = Math.max(aggregate.lastSeen, flow.lastSeen);

  if (flow.requestRate !== undefined || flow.errorRate !== undefined) {
    aggregate.requestCount = (aggregate.requestCount ?? 0) + roundRate(flow.requestRate);
    aggregate.errorCount = (aggregate.errorCount ?? 0) + roundRate(flow.errorRate);
    aggregate.requestRate = (aggregate.requestRate ?? 0) + finiteRate(flow.requestRate);
    aggregate.errorRate = (aggregate.errorRate ?? 0) + finiteRate(flow.errorRate);
  }

  if (flow.l7Protocol) {
    const weight = flow.connections > 0 ? flow.connections : 1;

    accumulator.l7Votes.set(flow.l7Protocol, (accumulator.l7Votes.get(flow.l7Protocol) ?? 0) + weight);
  }

  // The latency belongs to the response, never to the request record. A
  // metric-based source reports no record type, and its figure is already an
  // average: it is kept apart, as percentiles of averages mean nothing.
  const hasLatency = flow.latencyMs !== undefined && flow.latencyMs > 0 && flow.l7Type !== "REQUEST";

  if (hasLatency) {
    if (flow.l7Type === undefined) {
      accumulator.means.push({ value: flow.latencyMs!, weight: finiteRate(flow.requestRate) || 1 });
    } else {
      accumulator.latencies.push(flow.latencyMs!);
    }
  }

  if (flow.httpStatus && flow.httpStatus > 0) {
    increment(accumulator.statusCounts, `${Math.floor(flow.httpStatus / 100)}xx`);
  }

  if (flow.httpMethod) {
    const key = `${flow.httpMethod} ${flow.httpPath ?? ""}`;
    let path = accumulator.paths.get(key);

    if (!path) {
      path = { requests: 0, responses: 0, latencyCount: 0, latencySumMs: 0, withStatus: 0, errors: 0 };
      accumulator.paths.set(key, path);
    }

    if (flow.l7Type === "RESPONSE") {
      path.responses++;
    } else {
      path.requests++;
    }

    if (hasLatency) {
      path.latencySumMs += flow.latencyMs!;
      path.latencyCount++;
    }

    if (flow.httpStatus && flow.httpStatus > 0) {
      path.withStatus++;

      if (flow.httpStatus >= 400) {
        path.errors++;
      }
    }
  }

  if (flow.dnsQuery) {
    let dns = accumulator.dns.get(flow.dnsQuery);

    if (!dns) {
      dns = { queries: 0, responses: 0, nxCount: 0, ttlSum: 0, ttlCount: 0 };
      accumulator.dns.set(flow.dnsQuery, dns);
    }

    if (flow.l7Type === "RESPONSE") {
      dns.responses++;
    } else {
      dns.queries++;
    }

    // RCODE 3 is NXDOMAIN.
    if (flow.dnsRCode === 3) {
      dns.nxCount++;
    }

    if (flow.dnsTtl && flow.dnsTtl > 0) {
      dns.ttlSum += flow.dnsTtl;
      dns.ttlCount++;
    }
  }

  if (flow.verdict) {
    increment(accumulator.verdicts, flow.verdict);
  }

  if (flow.dropReason) {
    increment(accumulator.dropReasons, flow.dropReason);
  }
}

function finish(accumulator: Accumulator): AggregatedFlow {
  const { aggregate } = accumulator;

  let bestVotes = 0;

  for (const [protocol, votes] of accumulator.l7Votes) {
    if (votes > bestVotes) {
      aggregate.l7Protocol = protocol;
      bestVotes = votes;
    }
  }

  if (accumulator.latencies.length > 0) {
    const sorted = [...accumulator.latencies].sort((a, b) => a - b);

    aggregate.latencyP50Ms = percentile(sorted, 0.5);
    aggregate.latencyP95Ms = percentile(sorted, 0.95);
    aggregate.latencyP99Ms = percentile(sorted, 0.99);
    aggregate.avgLatencyMs = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  } else if (accumulator.means.length > 0) {
    const weight = accumulator.means.reduce((sum, mean) => sum + mean.weight, 0);

    aggregate.avgLatencyMs = accumulator.means.reduce((sum, mean) => sum + mean.value * mean.weight, 0) / weight;
  }

  if (Object.keys(accumulator.statusCounts).length > 0) {
    aggregate.httpStatusCounts = accumulator.statusCounts;
  }

  if (accumulator.paths.size > 0) {
    aggregate.topHttpPaths = [...accumulator.paths]
      .map(([key, path]): HttpPathStat => {
        const separator = key.indexOf(" ");

        return {
          method: key.slice(0, separator),
          path: key.slice(separator + 1),
          count: Math.max(path.requests, path.responses),
          avgMs: path.latencyCount > 0 ? path.latencySumMs / path.latencyCount : undefined,
          errorPct: path.withStatus > 0 ? (path.errors / path.withStatus) * 100 : undefined,
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, topEntries);
  }

  if (accumulator.dns.size > 0) {
    aggregate.topDnsQueries = [...accumulator.dns]
      .map(
        ([query, dns]): DnsQueryStat => ({
          query,
          count: Math.max(dns.queries, dns.responses),
          nxCount: dns.nxCount || undefined,
          avgTtl: dns.ttlCount > 0 ? Math.floor(dns.ttlSum / dns.ttlCount) : undefined,
        }),
      )
      .sort((a, b) => b.count - a.count)
      .slice(0, topEntries);
  }

  if (Object.keys(accumulator.verdicts).length > 0) {
    aggregate.verdictCounts = accumulator.verdicts;
  }

  if (Object.keys(accumulator.dropReasons).length > 0) {
    aggregate.dropReasons = accumulator.dropReasons;
  }

  return aggregate;
}

/**
 * Sums flows per pair of endpoints and port. Whether the direction is known is
 * part of the key: a source that cannot orient some of its traffic reports it
 * apart, and one answer about the direction of a mix would be wrong for half
 * of it.
 */
export function aggregateFlows(flows: readonly TrafficFlow[]): AggregatedFlow[] {
  const accumulators = new Map<string, Accumulator>();

  for (const flow of flows) {
    const key = aggregationKey(flow);
    let accumulator = accumulators.get(key);

    if (!accumulator) {
      accumulator = newAccumulator(flow);
      accumulators.set(key, accumulator);
    }

    accumulate(accumulator, flow);
  }

  return [...accumulators.values()].map(finish);
}
