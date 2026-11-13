/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { observable, runInAction } from "mobx";
import { describe, expect, it, vi } from "vitest";
import { aggregateFlows, graphFlows } from "../../common/aggregation";
import { linkIdOf } from "../graph";
import { TrafficMapModel } from "../traffic-map-model";

import type { SourcesResponse, TrafficFlow, TrafficFlowsResult } from "../../common/types";
import type { RequestTraffic } from "../traffic-map-model";

const pod = (name: string, workload: string) => ({ name, namespace: "shop", kind: "Pod" as const, workload });

const flows: TrafficFlow[] = [
  {
    source: pod("web-1", "web"),
    destination: pod("api-1", "api"),
    protocol: "tcp",
    port: 8080,
    bytesSent: 0,
    bytesRecv: 0,
    connections: 1,
    verdict: "forwarded",
    lastSeen: 2,
  },
  {
    source: pod("api-1", "api"),
    destination: pod("db-0", "db"),
    protocol: "tcp",
    port: 5432,
    bytesSent: 0,
    bytesRecv: 0,
    connections: 1,
    verdict: "dropped",
    lastSeen: 1,
  },
];

const sources: SourcesResponse = {
  cluster: { platform: "generic", cni: "cilium", dataplaneV2: true },
  active: "hubble",
  detected: [{ name: "hubble", status: "available" }],
};

const result: TrafficFlowsResult = {
  source: "hubble",
  timestamp: 0,
  flows,
  flowsTotal: flows.length,
  aggregated: aggregateFlows(graphFlows(flows)),
};

function createModel(namespaces = observable.array<string>([])) {
  const requestTraffic = vi.fn(async (body: { type: string }) => {
    switch (body.type) {
      case "sources":
        return { callWasSuccessful: true, response: sources };
      case "flows":
        return { callWasSuccessful: true, response: result };
      default:
        return { callWasSuccessful: false, error: "unexpected" };
    }
  });
  const model = new TrafficMapModel({
    requestTraffic: requestTraffic as unknown as RequestTraffic,
    getNamespaces: () => [...namespaces],
  });

  return { model, requestTraffic, namespaces };
}

describe("TrafficMapModel", () => {
  it("detects the sources, then loads the flows of the namespaces", async () => {
    const { model, requestTraffic, namespaces } = createModel(observable.array(["shop"]));

    await model.detect(false);

    expect(requestTraffic).toHaveBeenLastCalledWith({
      type: "flows",
      query: { namespaces: ["shop"], sinceSeconds: 300, groupByPod: false },
    });
    expect(model.graph.nodes.map((node) => node.id).sort()).toEqual(["shop/api", "shop/db", "shop/web"]);

    const dispose = model.start();

    requestTraffic.mockClear();
    runInAction(() => namespaces.push("pay"));
    await vi.waitFor(() => expect(requestTraffic).toHaveBeenCalledWith(expect.objectContaining({ type: "flows" })));
    dispose();
  });

  it("selects the single flows behind an edge", async () => {
    const { model } = createModel();

    await model.detect(false);
    model.select({ type: "link", id: linkIdOf(model.visibleFlows.find((flow) => flow.port === 5432)!) });

    expect(model.selectedLink?.destination.name).toBe("db");
    expect(model.selectedRecords.map((flow) => flow.destination.name)).toEqual(["db-0"]);
  });

  it("focuses on a node and its neighbours", async () => {
    const { model } = createModel();

    await model.detect(false);
    model.focus("shop/web");

    expect(model.visibleFlows.map((flow) => flow.destination.name)).toEqual(["api"]);
    expect(model.selection).toEqual({ type: "node", id: "shop/web" });
    expect(model.selectedRecords.map((flow) => flow.source.name)).toEqual(["web-1"]);
  });

  it("offers the verdicts the flows carry", async () => {
    const { model } = createModel();

    await model.detect(false);

    expect(model.facets.verdicts).toEqual(["dropped", "forwarded"]);

    model.updateFilters({ verdicts: ["dropped"] });

    expect(model.visibleFlows.map((flow) => flow.destination.name)).toEqual(["db"]);
  });
});
