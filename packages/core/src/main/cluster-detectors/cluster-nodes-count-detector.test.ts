/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { describe, expect, it, vi } from "vitest";
import { Cluster } from "../../common/cluster/cluster";
import { getDiForUnitTesting } from "../getDiForUnitTesting";
import k8SRequestInjectable from "../k8s-request.injectable";
import clusterNodeCountDetectorInjectable from "./cluster-nodes-count-detector.injectable";

const detectWith = async (responses: Record<string, unknown>) => {
  const di = getDiForUnitTesting();
  const k8sRequest = vi.fn(async (_cluster: unknown, pathnameAndQuery: string) => responses[pathnameAndQuery]);

  di.override(k8SRequestInjectable, () => k8sRequest);

  const cluster = new Cluster({ id: "some-cluster-id", contextName: "some-context", kubeConfigPath: "/some/config" });
  const result = await di.inject(clusterNodeCountDetectorInjectable).detect(cluster);

  return { result, paths: k8sRequest.mock.calls.map(([, path]) => path) };
};

describe("cluster node count detector", () => {
  it("counts the nodes from a list limited to one item", async () => {
    const { result, paths } = await detectWith({
      "/api/v1/nodes?limit=1": { items: [{}], metadata: { continue: "some-token", remainingItemCount: 41 } },
    });

    expect(result?.value).toBe(42);
    expect(paths).toEqual(["/api/v1/nodes?limit=1"]);
  });

  it("lists every node when the API server does not report the remaining count", async () => {
    const { result, paths } = await detectWith({
      "/api/v1/nodes?limit=1": { items: [{}], metadata: { continue: "some-token" } },
      "/api/v1/nodes": { items: [{}, {}, {}], metadata: {} },
    });

    expect(result?.value).toBe(3);
    expect(paths).toEqual(["/api/v1/nodes?limit=1", "/api/v1/nodes"]);
  });

  it("counts a single page", async () => {
    const { result } = await detectWith({ "/api/v1/nodes?limit=1": { items: [{}], metadata: {} } });

    expect(result?.value).toBe(1);
  });
});
