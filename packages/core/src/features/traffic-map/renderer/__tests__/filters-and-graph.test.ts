/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { describe, expect, it } from "vitest";
import { applyFilters, availableFacets, defaultFilters, isSystemEndpoint, mergeExternalPeers } from "../filters";
import { buildTrafficGraph, cardTitleOf, edgeColors, edgeWidth, fitMiddle, restingEdgeAlpha } from "../graph";
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
    const result = applyFilters(flows, defaultFilters, "connections");

    expect(result.map((flow) => `${flow.source.name}->${flow.destination.name}`)).toEqual([
      "web->api",
      "Internet->web",
      "api->db",
    ]);
    expect(result[1].connections).toBe(15);
  });

  it("keeps the edges at the focus", () => {
    const result = applyFilters(flows, { ...defaultFilters, focus: "shop/db" }, "connections");

    expect(result.map((flow) => flow.destination.name)).toEqual(["db"]);
  });

  it("keeps the edges with a verdict, and hides namespaces", () => {
    expect(applyFilters(flows, { ...defaultFilters, verdicts: ["dropped"] }, "connections")).toHaveLength(1);
    expect(applyFilters(flows, { ...defaultFilters, hiddenNamespaces: ["shop"] }, "connections")).toHaveLength(0);
  });

  it("offers the verdicts only when something was not forwarded", () => {
    expect(availableFacets(flows).verdicts).toEqual(["dropped", "forwarded"]);
    expect(availableFacets(flows.slice(0, 1)).verdicts).toEqual([]);
  });
});

describe("one Internet node", () => {
  it("merges outside addresses on either end, and lists them on the merged edge", () => {
    const merged = applyFilters(
      [
        edge(
          workload("web"),
          { name: "64.239.26.208", namespace: "", kind: "External", ip: "64.239.26.208" },
          { port: 443, bytesSent: 10 },
        ),
        edge(
          workload("web"),
          { name: "198.51.100.7", namespace: "", kind: "External", ip: "198.51.100.7" },
          { port: 443, bytesSent: 5 },
        ),
        edge(
          workload("api"),
          { name: "198.51.100.7", namespace: "", kind: "External", ip: "198.51.100.7" },
          { port: 443 },
        ),
      ],
      defaultFilters,
      "bytes",
    );

    expect(merged.map((flow) => `${flow.source.name}->${flow.destination.name}`)).toEqual([
      "web->Internet",
      "api->Internet",
    ]);
    expect(merged[0]).toMatchObject({ bytesSent: 15, flowCount: 2, verdictCounts: { forwarded: 2 } });
    expect(merged[0].externalPeers?.map((peer) => peer.name)).toEqual(["198.51.100.7", "64.239.26.208"]);
  });
});

describe("one node for the cluster's nodes", () => {
  const host = (name: string): TrafficEndpoint => ({ name, namespace: "", kind: "Host" });

  it("merges the nodes of the cluster into one node, and lists them", () => {
    const merged = applyFilters(
      [
        edge(host("node-a"), workload("api"), { port: 3000, bytesSent: 10 }),
        edge(host("node-b"), workload("api"), { port: 3000, bytesSent: 5 }),
        edge(host("node-a"), host("node-b"), { port: 10250 }),
      ],
      { ...defaultFilters, hideSystem: false },
      "bytes",
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ source: { name: "Cluster nodes", kind: "Host" }, bytesSent: 15 });
    expect(merged[0].externalPeers?.map((peer) => peer.name).sort()).toEqual(["node-a", "node-b"]);
  });

  it("keeps the nodes apart when asked", () => {
    const flows = applyFilters(
      [edge(host("node-a"), workload("api")), edge(host("node-b"), workload("api"))],
      { ...defaultFilters, hideSystem: false, collapseHosts: false },
      "connections",
    );

    expect(flows.map((flow) => flow.source.name)).toEqual(["node-a", "node-b"]);
  });
});

describe("drawing helpers", () => {
  const measure = (text: string) => text.length;

  it("keeps the start and the end of a long name", () => {
    expect(fitMiddle(measure, "terminal-backend-afc-terminal-qr-zalopay", 24)).toBe("terminal-ba…l-qr-zalopay");
    expect(fitMiddle(measure, "short", 24)).toBe("short");
  });

  it("drops the -deployment that a Deployment's kind already says", () => {
    expect(cardTitleOf("pos-backend-afc-order-payment-deployment", "Deployment")).toBe("pos-backend-afc-order-payment");
    expect(cardTitleOf("nats-deployment", "StatefulSet")).toBe("nats-deployment");
  });

  it("fades edges more as they get more", () => {
    expect(restingEdgeAlpha(5)).toBeGreaterThan(restingEdgeAlpha(30));
    expect(restingEdgeAlpha(30)).toBeGreaterThan(restingEdgeAlpha(200));
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
      "connections",
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
      "connections",
    );

    expect(graph.nodes.map((node) => node.id).sort()).toEqual(["shop/api", "shop/cache", "shop/db", "shop/web"]);
    expect(graph.links.map((link) => link.color)).toEqual([edgeColors.http, edgeColors.error, edgeColors.tcp]);
    expect(graph.nodes.find((node) => node.id === "shop/db")?.hasProblems).toBe(true);
  });

  it("draws the ports of a pair as one edge, busiest first", () => {
    const graph = buildTrafficGraph(
      [
        edge(workload("mailer"), workload("nats"), { port: 4222, connections: 2 }),
        edge(workload("mailer"), workload("nats"), { port: 4318, connections: 13 }),
        edge(workload("mailer"), workload("nats"), { port: 53, connections: 6, errorCount: 1 }),
      ],
      "connections",
    );

    expect(graph.links).toHaveLength(1);
    expect(graph.links[0]).toMatchObject({
      id: "shop/mailer->shop/nats",
      ports: [4318, 53, 4222],
      volume: 21,
      color: edgeColors.error,
    });
    expect(graph.nodes.find((node) => node.id === "shop/nats")?.ports).toEqual([4318, 53, 4222]);
  });

  it("marks the busiest tenth of the edges as hot", () => {
    const flows = Array.from({ length: 20 }, (_, index) =>
      edge(workload(`client-${index}`), workload("api"), { connections: index + 1 }),
    );
    const hot = buildTrafficGraph(flows, "connections").links.filter((link) => link.hot);

    expect(hot.map((link) => link.volume)).toEqual([19, 20]);
  });

  it("widens edges by where their volume lies between the least and the busiest", () => {
    expect(edgeWidth(1, 1, 1_000)).toBe(1.5);
    expect(edgeWidth(1_000, 1, 1_000)).toBe(6);
    expect(edgeWidth(31.622_776_6, 1, 1_000)).toBeCloseTo(3.75);
    expect(edgeWidth(5, 5, 5)).toBe(3.75);
  });
});

describe("selfLinkOf", () => {
  it("links workloads, pods and services to their objects", () => {
    expect(selfLinkOf(workload("web"))).toBe("/apis/apps/v1/namespaces/shop/deployments/web");
    expect(selfLinkOf({ name: "web-1", namespace: "shop", kind: "Pod" })).toBe("/api/v1/namespaces/shop/pods/web-1");
    expect(selfLinkOf(world)).toBeUndefined();
  });
});
