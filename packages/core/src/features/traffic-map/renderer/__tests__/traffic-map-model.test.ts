/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { observable, runInAction } from "mobx";
import { afterEach, describe, expect, it, vi } from "vitest";
import { aggregateFlows, graphFlows } from "../../common/aggregation";
import { linkIdOf } from "../graph";
import { installPollMs, maxInstallPolls, TrafficMapModel } from "../traffic-map-model";

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

    expect(model.selectedLinkFlows.map((flow) => flow.destination.name)).toEqual(["db"]);
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

  it("does not draw a graph past its budget until asked, and narrows it to a namespace", async () => {
    const many: TrafficFlow[] = Array.from({ length: 250 }, (_, index) => ({
      ...flows[0],
      source: { ...pod(`client-${index}`, `client-${index}`), namespace: index % 2 ? "shop" : "pay" },
      destination: pod("api-1", "api"),
    }));
    const large: TrafficFlowsResult = {
      ...result,
      flows: many,
      flowsTotal: many.length,
      aggregated: aggregateFlows(graphFlows(many)),
    };
    const model = new TrafficMapModel({
      requestTraffic: (async (body: { type: string }) =>
        body.type === "sources"
          ? { callWasSuccessful: true, response: sources }
          : { callWasSuccessful: true, response: large }) as unknown as RequestTraffic,
      getNamespaces: () => [],
    });

    await model.detect(false);

    expect(model.graphSize).toBeGreaterThan(400);
    expect(model.tooLarge).toBe(true);

    model.setDrawAnyway(true);

    expect(model.tooLarge).toBe(false);

    model.setDrawAnyway(false);
    model.onlyNamespace("pay");

    expect(model.filters.hiddenNamespaces).toEqual(["shop"]);
    expect(model.tooLarge).toBe(false);
  });

  it("keeps the view across refreshes, and changes it with what the user looks at", async () => {
    const { model, namespaces } = createModel(observable.array(["shop"]));

    await model.detect(false);

    const view = model.viewKey;

    await model.load();

    expect(model.viewKey).toBe(view);

    model.select({ type: "node", id: "shop/web" });

    expect(model.viewKey).toBe(view);

    model.focus("shop/web");

    expect(model.viewKey).not.toBe(view);

    const focused = model.viewKey;

    runInAction(() => namespaces.push("pay"));

    expect(model.viewKey).not.toBe(focused);
  });

  describe("installing a source", () => {
    const notYet: SourcesResponse = {
      cluster: { platform: "generic", cni: "flannel", dataplaneV2: false },
      detected: [{ name: "caretta", status: "present" }],
    };
    const ready: SourcesResponse = {
      cluster: notYet.cluster,
      active: "caretta",
      detected: [{ name: "caretta", status: "available" }],
    };

    /** A model whose install answers `installed`, and whose detections answer `detections` in turn, the last one after. */
    function createInstallingModel(installed: unknown, detections: SourcesResponse[] = [notYet]) {
      let detection = 0;
      const requestTraffic = vi.fn(async (body: { type: string }) => {
        switch (body.type) {
          case "install-source":
            return installed;
          case "sources":
            return {
              callWasSuccessful: true,
              response: detections[Math.min(detection++, detections.length - 1)],
            };
          case "flows":
            return { callWasSuccessful: true, response: result };
          default:
            return { callWasSuccessful: false, error: "unexpected" };
        }
      });
      const model = new TrafficMapModel({
        requestTraffic: requestTraffic as unknown as RequestTraffic,
        getNamespaces: () => [],
      });
      const detectionCalls = () => requestTraffic.mock.calls.filter(([body]) => body.type === "sources").length;

      return { model, requestTraffic, detectionCalls };
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it("loads the flows of the source the install made active, without detecting again", async () => {
      vi.useFakeTimers();

      const { model, requestTraffic, detectionCalls } = createInstallingModel({
        callWasSuccessful: true,
        response: ready,
      });
      const installing = model.installSource("caretta");

      expect(model.installing).toBe(true);
      await installing;

      expect(requestTraffic).toHaveBeenCalledWith({ type: "install-source", source: "caretta" });
      expect(model.installing).toBe(false);
      expect(model.installed).toBe("caretta");
      expect(model.sources).toBe(ready);
      expect(model.result).toBe(result);
      expect(model.waitingForSource).toBe(false);

      await vi.advanceTimersByTimeAsync(installPollMs * 3);

      expect(detectionCalls()).toBe(0);
    });

    it("detects again until the installed source is active", async () => {
      vi.useFakeTimers();

      const { model, detectionCalls } = createInstallingModel({ callWasSuccessful: true, response: notYet }, [
        notYet,
        notYet,
        ready,
      ]);

      await model.installSource("caretta");

      expect(model.installed).toBe("caretta");
      expect(model.sources?.active).toBeUndefined();
      expect(model.waitingForSource).toBe(true);

      await vi.advanceTimersByTimeAsync(installPollMs * 2);

      expect(detectionCalls()).toBe(2);
      expect(model.waitingForSource).toBe(true);

      await vi.advanceTimersByTimeAsync(installPollMs);

      expect(detectionCalls()).toBe(3);
      expect(model.sources?.active).toBe("caretta");
      expect(model.waitingForSource).toBe(false);

      await vi.advanceTimersByTimeAsync(installPollMs * 5);

      expect(detectionCalls()).toBe(3);
    });

    it("gives up after its last try", async () => {
      vi.useFakeTimers();

      const { model, detectionCalls } = createInstallingModel({ callWasSuccessful: true, response: notYet });

      await model.installSource("caretta");
      await vi.advanceTimersByTimeAsync(installPollMs * maxInstallPolls);

      expect(detectionCalls()).toBe(maxInstallPolls);
      expect(model.waitingForSource).toBe(false);
      expect(model.installed).toBe("caretta");

      await vi.advanceTimersByTimeAsync(installPollMs * 5);

      expect(detectionCalls()).toBe(maxInstallPolls);
    });

    it("stops detecting when the page goes away", async () => {
      vi.useFakeTimers();

      const { model, detectionCalls } = createInstallingModel({ callWasSuccessful: true, response: notYet });
      const dispose = model.start();

      // The detection that start() runs.
      await vi.advanceTimersByTimeAsync(0);

      const before = detectionCalls();

      await model.installSource("caretta");
      await vi.advanceTimersByTimeAsync(installPollMs * 2);

      expect(detectionCalls()).toBe(before + 2);

      dispose();
      await vi.advanceTimersByTimeAsync(installPollMs * 5);

      expect(detectionCalls()).toBe(before + 2);
    });

    it("keeps the error of a failed install, and does not wait for the source", async () => {
      vi.useFakeTimers();

      const { model, detectionCalls } = createInstallingModel({
        callWasSuccessful: false,
        error: "Error: INSTALLATION FAILED: forbidden",
      });

      await model.installSource("caretta");

      expect(model.installError).toBe("Error: INSTALLATION FAILED: forbidden");
      expect(model.installing).toBe(false);
      expect(model.installed).toBeUndefined();
      expect(model.waitingForSource).toBe(false);

      await vi.advanceTimersByTimeAsync(installPollMs * 3);

      expect(detectionCalls()).toBe(0);
    });

    it("clears the error of the last install when it starts again", async () => {
      const { model } = createInstallingModel({ callWasSuccessful: false, error: "first" });

      await model.installSource("caretta");

      expect(model.installError).toBe("first");

      const again = model.installSource("caretta");

      expect(model.installError).toBeUndefined();
      await again;
    });
  });

  it("shows all traffic but keeps the merged Internet and cluster nodes", async () => {
    const { model } = createModel();

    await model.detect(false);
    model.updateFilters({ verdicts: ["dropped"], minVolume: 100, collapseHosts: false });
    model.resetFilters();

    expect(model.filters).toMatchObject({
      hideSystem: false,
      verdicts: [],
      minVolume: 0,
      collapseInternet: true,
      collapseHosts: false,
    });
  });
});
