/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { describe, expect, it } from "vitest";
import { aggregateFlows, graphEndpoint, graphFlows, percentile, roundRate } from "../aggregation";

import type { TrafficEndpoint, TrafficFlow } from "../types";

const pod = (name: string, workload?: string): TrafficEndpoint => ({
  name,
  namespace: "shop",
  kind: "Pod",
  workload,
  workloadKind: workload ? "Deployment" : undefined,
});

const flow = (overrides: Partial<TrafficFlow> = {}): TrafficFlow => ({
  source: pod("web-1", "web"),
  destination: pod("api-1", "api"),
  protocol: "tcp",
  port: 8080,
  bytesSent: 0,
  bytesRecv: 0,
  connections: 1,
  verdict: "forwarded",
  lastSeen: 1_000,
  ...overrides,
});

describe("roundRate", () => {
  it("keeps a slow positive rate visible as one", () => {
    expect(roundRate(0.01)).toBe(1);
  });

  it("rounds larger rates", () => {
    expect(roundRate(2.6)).toBe(3);
  });

  it("gives zero for zero, negative and non-finite rates", () => {
    expect([roundRate(0), roundRate(-1), roundRate(Number.NaN), roundRate(Number.POSITIVE_INFINITY)]).toEqual([
      0, 0, 0, 0,
    ]);
  });
});

describe("percentile", () => {
  it("picks the value at the floor of the rank", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(9);
    expect(percentile([], 0.5)).toBe(0);
  });
});

describe("graphEndpoint", () => {
  it("draws a pod as its workload", () => {
    expect(graphEndpoint(pod("web-7d9f-abcde", "web"))).toEqual({
      name: "web",
      namespace: "shop",
      kind: "Workload",
      workload: "web",
      workloadKind: "Deployment",
    });
  });

  it("keeps a pod without a workload, and one already named after it", () => {
    expect(graphEndpoint(pod("standalone"))).toEqual(pod("standalone"));
    expect(graphEndpoint(pod("web", "web"))).toEqual(pod("web", "web"));
  });
});

describe("aggregateFlows", () => {
  it("sums the flows of the replicas of a workload into one edge", () => {
    const [aggregate, ...rest] = aggregateFlows(
      graphFlows([
        flow({ source: pod("web-1", "web"), bytesSent: 10, lastSeen: 1_000 }),
        flow({ source: pod("web-2", "web"), bytesSent: 5, lastSeen: 3_000 }),
      ]),
    );

    expect(rest).toEqual([]);
    expect(aggregate).toMatchObject({
      source: { name: "web", kind: "Workload" },
      destination: { name: "api", kind: "Workload" },
      flowCount: 2,
      connections: 2,
      bytesSent: 15,
      lastSeen: 3_000,
      verdictCounts: { forwarded: 2 },
    });
  });

  it("keeps flows of unknown direction apart from oriented ones", () => {
    const aggregates = aggregateFlows([flow(), flow({ directionUnknown: true })]);

    expect(aggregates).toHaveLength(2);
    expect(aggregates.map((aggregate) => aggregate.directionUnknown ?? false).sort()).toEqual([false, true]);
  });

  it("counts a request and its response once, with the latency of the response", () => {
    const [aggregate] = aggregateFlows([
      flow({ l7Protocol: "HTTP", l7Type: "REQUEST", httpMethod: "GET", httpPath: "/items", latencyMs: 99 }),
      flow({
        l7Protocol: "HTTP",
        l7Type: "RESPONSE",
        httpMethod: "GET",
        httpPath: "/items",
        httpStatus: 503,
        latencyMs: 20,
      }),
    ]);

    expect(aggregate.topHttpPaths).toEqual([{ method: "GET", path: "/items", count: 1, avgMs: 20, errorPct: 100 }]);
    expect(aggregate.httpStatusCounts).toEqual({ "5xx": 1 });
    expect(aggregate.latencyP50Ms).toBe(20);
    expect(aggregate.l7Protocol).toBe("HTTP");
  });

  it("weights the averages of a metric-based source by their request rates", () => {
    const [aggregate] = aggregateFlows([
      flow({ requestRate: 3, latencyMs: 10 }),
      flow({ requestRate: 1, latencyMs: 50 }),
    ]);

    expect(aggregate.avgLatencyMs).toBe(20);
    expect(aggregate.latencyP50Ms).toBeUndefined();
    expect(aggregate.requestRate).toBe(4);
    expect(aggregate.requestCount).toBe(4);
  });

  it("collects DNS queries and drop reasons", () => {
    const [aggregate] = aggregateFlows([
      flow({ dnsQuery: "api.example.com.", dnsRCode: 3, l7Type: "RESPONSE", dnsTtl: 30 }),
      flow({ verdict: "dropped", dropReason: "POLICY_DENIED" }),
    ]);

    expect(aggregate.topDnsQueries).toEqual([{ query: "api.example.com.", count: 1, nxCount: 1, avgTtl: 30 }]);
    expect(aggregate.verdictCounts).toEqual({ forwarded: 1, dropped: 1 });
    expect(aggregate.dropReasons).toEqual({ POLICY_DENIED: 1 });
  });
});
