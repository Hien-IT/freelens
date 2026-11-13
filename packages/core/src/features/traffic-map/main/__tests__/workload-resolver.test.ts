/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { describe, expect, it, vi } from "vitest";
import { WorkloadResolver } from "../workload-resolver";

import type { TrafficEndpoint, TrafficFlow } from "../../common/types";
import type { ClusterAccess, KubeObjectJson } from "../cluster-access";

const owned = (name: string, kind?: string, owner?: string): KubeObjectJson => ({
  metadata: {
    name,
    namespace: "infra",
    ownerReferences: kind && owner ? [{ kind, name: owner, controller: true }] : undefined,
  },
});

const objects: Record<string, KubeObjectJson[]> = {
  "/api/v1/namespaces/infra/pods": [
    owned("teleport-auth-f796df7c6-th82k", "ReplicaSet", "teleport-auth-f796df7c6"),
    owned("backup-29000000-abcde", "Job", "backup-29000000"),
    owned("postgres-0", "StatefulSet", "postgres"),
    owned("kube-apiserver-node-a", "Node", "node-a"),
    owned("standalone"),
  ],
  "/apis/apps/v1/namespaces/infra/replicasets": [owned("teleport-auth-f796df7c6", "Deployment", "teleport-auth")],
  "/apis/batch/v1/namespaces/infra/jobs": [owned("backup-29000000", "CronJob", "backup")],
};

function fakeAccess(): ClusterAccess {
  return {
    list: vi.fn(async (path: string) => (objects[path] ?? []) as never[]),
    get: async () => undefined,
    queryPrometheus: async () => [],
    queryService: async () => [],
    portForward: async () => {
      throw new Error("not used");
    },
  };
}

const pod = (name: string, workload?: string, workloadKind?: string): TrafficEndpoint => ({
  name,
  namespace: "infra",
  kind: "Pod",
  workload,
  workloadKind,
});

const flowTo = (destination: TrafficEndpoint): TrafficFlow => ({
  source: { name: "world", namespace: "", kind: "External" },
  destination,
  protocol: "tcp",
  port: 80,
  bytesSent: 0,
  bytesRecv: 0,
  connections: 1,
  verdict: "forwarded",
  lastSeen: 0,
});

describe("WorkloadResolver", () => {
  it("names the workload above the ReplicaSet or Job of a pod, or its own controller", async () => {
    const flows = [
      flowTo(pod("teleport-auth-f796df7c6-th82k")),
      flowTo(pod("backup-29000000-abcde")),
      flowTo(pod("postgres-0")),
    ];

    await new WorkloadResolver(fakeAccess()).resolve(flows);

    expect(flows.map((flow) => [flow.destination.workload, flow.destination.workloadKind])).toEqual([
      ["teleport-auth", "Deployment"],
      ["backup", "CronJob"],
      ["postgres", "StatefulSet"],
    ]);
  });

  it("replaces a ReplicaSet that a source named as the workload", async () => {
    const flows = [flowTo(pod("teleport-auth-f796df7c6-th82k", "teleport-auth-f796df7c6", "ReplicaSet"))];

    await new WorkloadResolver(fakeAccess()).resolve(flows);

    expect(flows[0].destination).toMatchObject({ workload: "teleport-auth", workloadKind: "Deployment" });
  });

  it("leaves a static pod, a pod without owner and an unknown pod as they are", async () => {
    const flows = [flowTo(pod("kube-apiserver-node-a")), flowTo(pod("standalone")), flowTo(pod("gone-1"))];

    await new WorkloadResolver(fakeAccess()).resolve(flows);

    expect(flows.map((flow) => flow.destination.workload)).toEqual([undefined, undefined, undefined]);
  });

  it("keeps the workload that a source named, and reads nothing for it", async () => {
    const access = fakeAccess();
    const flows = [flowTo(pod("web-1", "web", "Deployment"))];

    await new WorkloadResolver(access).resolve(flows);

    expect(flows[0].destination.workload).toBe("web");
    expect(access.list).not.toHaveBeenCalled();
  });

  it("reads a namespace once while its owners are fresh, and survives a refused list", async () => {
    const access = fakeAccess();
    const resolver = new WorkloadResolver(access);

    await resolver.resolve([flowTo(pod("postgres-0"))]);
    await resolver.resolve([flowTo(pod("postgres-0"))]);

    expect(vi.mocked(access.list).mock.calls.filter(([path]) => path.endsWith("/pods"))).toHaveLength(1);

    vi.mocked(access.list).mockRejectedValue(new Error("forbidden"));

    const refused = [{ ...flowTo(pod("x-1")), destination: { ...pod("x-1"), namespace: "secret" } }];

    await expect(new WorkloadResolver(access).resolve(refused)).resolves.toBeUndefined();
    expect(refused[0].destination.workload).toBeUndefined();
  });
});
