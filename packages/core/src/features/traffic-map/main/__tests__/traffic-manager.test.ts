/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { describe, expect, it, vi } from "vitest";
import { platformOfNode, recommend } from "../cluster-info";
import { TrafficManager } from "../traffic-manager";

import type { DetectionResult, FlowsResponse, TrafficFlow, TrafficSourceName } from "../../common/types";
import type { ClusterAccess } from "../cluster-access";
import type { TrafficSource } from "../source";

const access: ClusterAccess = {
  list: async () => [],
  get: async () => undefined,
  queryPrometheus: async () => [],
  queryService: async () => [],
  portForward: async () => {
    throw new Error("not used");
  },
};

function fakeSource(name: TrafficSourceName, detection: DetectionResult, flows: TrafficFlow[] = []): TrafficSource {
  return {
    name,
    detect: vi.fn(async () => detection),
    getFlows: vi.fn(async (): Promise<FlowsResponse> => ({ source: name, timestamp: 0, flows })),
    close: vi.fn(),
  };
}

const pod = (name: string, workload: string) => ({ name, namespace: "shop", kind: "Pod" as const, workload });

describe("TrafficManager", () => {
  it("makes the first available source, in priority order, the active one", async () => {
    const manager = new TrafficManager(access, [
      fakeSource("hubble", { available: false, message: "not found" }),
      fakeSource("istio", { available: true }),
      fakeSource("caretta", { available: true }),
    ]);

    const sources = await manager.detectSources();

    expect(sources.active).toBe("istio");
    expect(sources.recommended).toBeUndefined();
    expect(sources.detected.map((status) => [status.name, status.status])).toEqual([
      ["hubble", "not_found"],
      ["istio", "available"],
      ["caretta", "available"],
    ]);
  });

  it("reports a source that fails to detect as an error", async () => {
    const failing = fakeSource("hubble", { available: false });

    vi.mocked(failing.detect).mockRejectedValue(new Error("forbidden"));

    const sources = await new TrafficManager(access, [failing]).detectSources();

    expect(sources.detected).toEqual([{ name: "hubble", status: "error", message: "forbidden" }]);
    expect(sources.active).toBeUndefined();
  });

  it("switches to a source the user picks, and refuses one that is not available", async () => {
    const manager = new TrafficManager(access, [
      fakeSource("hubble", { available: true }),
      fakeSource("istio", { available: true }),
      fakeSource("caretta", { available: false }),
    ]);

    expect((await manager.setActiveSource("istio")).active).toBe("istio");
    await expect(manager.setActiveSource("caretta")).rejects.toThrow("not available");
  });

  it("aggregates the flows by workload and keeps the newest single flows", async () => {
    const flows: TrafficFlow[] = [1, 2, 3].map((index) => ({
      source: pod(`web-${index}`, "web"),
      destination: pod("api-1", "api"),
      protocol: "tcp",
      port: 80,
      bytesSent: 0,
      bytesRecv: 0,
      connections: 1,
      verdict: "forwarded",
      lastSeen: index,
    }));
    const source = fakeSource("hubble", { available: true }, flows);
    const manager = new TrafficManager(access, [source]);

    const result = await manager.getFlows({ namespaces: ["shop", "shop"], sinceSeconds: 5 });

    expect(source.getFlows).toHaveBeenCalledWith({ namespaces: ["shop"], sinceSeconds: 30, limit: 1000 });
    expect(result.flowsTotal).toBe(3);
    expect(result.flows.map((flow) => flow.lastSeen)).toEqual([3, 2, 1]);
    expect(result.aggregated).toHaveLength(1);
    expect(result.aggregated[0]).toMatchObject({ source: { name: "web", kind: "Workload" }, flowCount: 3 });

    const byPod = await manager.getFlows({ sinceSeconds: 300, groupByPod: true });

    expect(byPod.aggregated).toHaveLength(3);
  });

  it("fails to read flows when no source is available", async () => {
    const manager = new TrafficManager(access, [fakeSource("hubble", { available: false })]);

    await expect(manager.getFlows({ sinceSeconds: 300 })).rejects.toThrow("No traffic source");
  });
});

describe("platformOfNode", () => {
  it("reads the platform from the provider ID, the labels or the name", () => {
    expect(platformOfNode({ metadata: { name: "n" }, spec: { providerID: "aws:///eu-west-1a/i-1" } })).toBe("eks");
    expect(platformOfNode({ metadata: { name: "n", labels: { "kubernetes.azure.com/role": "agent" } } })).toBe("aks");
    expect(platformOfNode({ metadata: { name: "minikube" } })).toBe("minikube");
    expect(platformOfNode({ metadata: { name: "n" } }, "v1.31.4+rke2r1")).toBe("rke2");
    expect(platformOfNode(undefined)).toBe("generic");
  });
});

describe("recommend", () => {
  it("recommends Hubble on Cilium, and the GKE way on GKE", () => {
    expect(recommend({ platform: "generic", cni: "cilium", dataplaneV2: false }, [])?.name).toBe("hubble");
    expect(recommend({ platform: "gke", cni: "cilium", dataplaneV2: false }, [])?.installCommand).toContain(
      "--enable-dataplane-v2-observability",
    );
  });

  it("recommends nothing when a source works, or when Hubble is there but unusable", () => {
    expect(
      recommend({ platform: "eks", cni: "vpc-cni", dataplaneV2: false }, [{ name: "istio", status: "available" }]),
    ).toBeUndefined();
    expect(
      recommend({ platform: "generic", cni: "cilium", dataplaneV2: false }, [{ name: "hubble", status: "present" }]),
    ).toBeUndefined();
  });

  it("recommends Caretta with its chart elsewhere", () => {
    const recommendation = recommend({ platform: "eks", cni: "vpc-cni", dataplaneV2: false }, []);

    expect(recommendation).toMatchObject({ name: "caretta", helmChart: { chartName: "caretta" } });
    expect(recommendation?.reason).toContain("AWS VPC CNI");
  });
});
