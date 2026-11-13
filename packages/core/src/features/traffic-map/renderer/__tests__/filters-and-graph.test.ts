/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { describe, expect, it } from "vitest";
import { applyFilters, availableFacets, defaultFilters, isSystemEndpoint, mergeExternalPeers } from "../filters";
import { buildTrafficGraph, edgeColors, edgeWidth } from "../graph";
import { selfLinkOf } from "../traffic-map-dependencies.injectable";

import type { AggregatedFlow, TrafficEndpoint } from "../../common/types";

const workload = (name: string, namespace = "shop"): TrafficEndpoint => ({
  name,
  namespace,
  kind: "Workload",
  workload: name,
  workloadKind: "Deployment",
});

const edge = (source: TrafficEndpoint, destination: TrafficEndpoint, overrides: Partial<AggregatedFlow> = {}) =>
  ({
    source,
    destination,
    protocol: "tcp",
    port: 80,
    flowCount: 1,
    bytesSent: 0,
    bytesRecv: 0,
    connections: 10,
    lastSeen: 0,
    verdictCounts: { forwarded: 1 },
    ...overrides,
  }) satisfies AggregatedFlow;

const world: TrafficEndpoint = { name: "world", namespace: "", kind: "External" };
const otherWorld: TrafficEndpoint = { name: "203.0.113.9", namespace: "", kind: "External" };

describe("isSystemEndpoint", () => {
  it("treats system namespaces, nodes and link-local addresses as system traffic", () => {
    expect(isSystemEndpoint(workload("coredns", "kube-system"))).toBe(true);
    expect(isSystemEndpoint({ name: "host", namespace: "", kind: "Host" })).toBe(true);
    expect(isSystemEndpoint({ name: "169.254.169.254", namespace: "", kind: "External" })).toBe(true);
    expect(isSystemEndpoint({ name: "kubernetes", namespace: "default", kind: "Service" })).toBe(true);
    expect(isSystemEndpoint(workload("web"))).toBe(false);
  });
});

describe("applyFilters", () => {
  const flows = [
    edge(workload("web"), workload("api")),
    edge(workload("coredns", "kube-system"), workload("api")),
    edge(world, workload("web"), { port: 443 }),
    edge(otherWorld, workload("web"), { port: 443, connections: 5 }),
    edge(workload("api"), workload("db"), { verdictCounts: { dropped: 2 } }),
  ];

  it("hides system traffic and draws the outside as one Internet node by default", () => {
    const result = applyFilters(flows, defaultFilters, false);

    expect(result.map((flow) => `${flow.source.name}->${flow.destination.name}`)).toEqual([
      "web->api",
      "Internet->web",
      "api->db",
    ]);
    expect(result[1].connections).toBe(15);
  });

  it("keeps the edges at the focus", () => {
    const result = applyFilters(flows, { ...defaultFilters, focus: "shop/db" }, false);

    expect(result.map((flow) => flow.destination.name)).toEqual(["db"]);
  });

  it("keeps the edges with a verdict, and hides namespaces", () => {
    expect(applyFilters(flows, { ...defaultFilters, verdicts: ["dropped"] }, false)).toHaveLength(1);
    expect(applyFilters(flows, { ...defaultFilters, hiddenNamespaces: ["shop"] }, false)).toHaveLength(0);
  });

  it("offers the verdicts only when something was not forwarded", () => {
    expect(availableFacets(flows).verdicts).toEqual(["dropped", "forwarded"]);
    expect(availableFacets(flows.slice(0, 1)).verdicts).toEqual([]);
  });
});

describe("mergeExternalPeers", () => {
  it("sums the outside addresses of the edges that the Internet node merges", () => {
    const merged = applyFilters(
      [
        edge(world, workload("web"), {
          port: 443,
          externalPeers: [{ name: "a.example.com", ips: ["198.51.100.1"], flowCount: 2, connections: 2 }],
        }),
        edge(otherWorld, workload("web"), {
          port: 443,
          externalPeers: [
            { name: "a.example.com", ips: ["198.51.100.2"], flowCount: 1, connections: 1 },
            { name: "203.0.113.9", ips: ["203.0.113.9"], flowCount: 4, connections: 4 },
          ],
        }),
      ],
      defaultFilters,
      false,
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].externalPeers).toEqual([
      { name: "203.0.113.9", ips: ["203.0.113.9"], flowCount: 4, connections: 4 },
      { name: "a.example.com", ips: ["198.51.100.1", "198.51.100.2"], flowCount: 3, connections: 3 },
    ]);
    expect(mergeExternalPeers([])).toEqual([]);
  });
});

describe("buildTrafficGraph", () => {
  it("makes a node per endpoint and colours the edges by what they carry", () => {
    const graph = buildTrafficGraph(
      [
        edge(workload("web"), workload("api"), { l7Protocol: "HTTP", connections: 1 }),
        edge(workload("api"), workload("db"), { errorCount: 3, connections: 1 }),
        edge(workload("web"), workload("cache"), { connections: 1 }),
      ],
      false,
    );

    expect(graph.nodes.map((node) => node.id).sort()).toEqual(["shop/api", "shop/cache", "shop/db", "shop/web"]);
    expect(graph.links.map((link) => link.color)).toEqual([edgeColors.http, edgeColors.error, edgeColors.tcp]);
    expect(graph.nodes.find((node) => node.id === "shop/db")?.hasProblems).toBe(true);
  });

  it("marks the busiest tenth of the edges as hot", () => {
    const flows = Array.from({ length: 20 }, (_, index) =>
      edge(workload(`client-${index}`), workload("api"), { connections: index + 1 }),
    );
    const hot = buildTrafficGraph(flows, false).links.filter((link) => link.hot);

    expect(hot.map((link) => link.volume)).toEqual([19, 20]);
  });

  it("widens edges by the order of magnitude of their volume", () => {
    expect(edgeWidth(1)).toBe(1.5);
    expect(edgeWidth(100_000)).toBe(3.5);
    expect(edgeWidth(1e12)).toBe(6);
  });
});

describe("selfLinkOf", () => {
  it("links workloads, pods and services to their objects", () => {
    expect(selfLinkOf(workload("web"))).toBe("/apis/apps/v1/namespaces/shop/deployments/web");
    expect(selfLinkOf({ name: "web-1", namespace: "shop", kind: "Pod" })).toBe("/api/v1/namespaces/shop/pods/web-1");
    expect(selfLinkOf(world)).toBeUndefined();
  });
});
