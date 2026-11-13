/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 *
 * @vitest-environment node
 */

import http2 from "node:http2";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FrameDecoder, frameMessage } from "../grpc";
import { HubbleSource } from "../hubble-source";
import { ProtobufWriter, readFields } from "../protobuf";
import { encodeFlow } from "./encode-flow";
import type { AddressInfo } from "node:net";

import type { ClusterAccess, KubeObjectJson } from "../../cluster-access";
import type { FlowSpec } from "./encode-flow";

interface RelayFake {
  port: number;
  /** The GetFlows requests that the relay received, as their fields. */
  requests: { number: number; whitelistCount: number }[];
  flows: FlowSpec[];
  extra: Uint8Array[];
  close(): Promise<void>;
}

/** A plaintext Hubble Relay that answers ServerStatus and GetFlows. */
async function startRelay(): Promise<RelayFake> {
  const server = http2.createServer();
  const fake: RelayFake = {
    port: 0,
    requests: [],
    flows: [],
    extra: [],
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };

  server.on("stream", (stream, headers) => {
    const decoder = new FrameDecoder();
    const messages: Uint8Array[] = [];

    stream.on("data", (chunk: Buffer) => messages.push(...decoder.push(chunk)));
    stream.on("end", () => {
      stream.respond({ ":status": 200, "content-type": "application/grpc" }, { waitForTrailers: true });
      stream.on("wantTrailers", () => stream.sendTrailers({ "grpc-status": "0" }));

      if (headers[":path"] === "/observer.Observer/ServerStatus") {
        stream.write(frameMessage(new ProtobufWriter().message(5, (nodes) => nodes.uint(1, 2)).finish()));
      } else if (headers[":path"] === "/observer.Observer/GetFlows") {
        const fields = [...readFields(messages[0] ?? new Uint8Array())];

        fake.requests.push({
          number: fields.find((field) => field.number === 1)?.value ?? 0,
          whitelistCount: fields.filter((field) => field.number === 6).length,
        });

        for (const flow of fake.flows) {
          stream.write(frameMessage(new ProtobufWriter().bytes(1, encodeFlow(flow)).finish()));
        }

        for (const message of fake.extra) {
          stream.write(frameMessage(message));
        }
      }

      stream.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  fake.port = (server.address() as AddressInfo).port;

  return fake;
}

function fakeAccess(relay: RelayFake, objects: Record<string, KubeObjectJson | KubeObjectJson[]>): ClusterAccess {
  return {
    list: async (path) => ((objects[path] as KubeObjectJson[] | undefined) ?? []) as never[],
    get: async (path) => objects[path] as never,
    queryPrometheus: async () => [],
    queryService: async () => [],
    portForward: async () => ({ localPort: relay.port, isAlive: () => true, stop: () => {} }),
  };
}

const relayPods: KubeObjectJson[] = [
  { metadata: { name: "hubble-relay-1", namespace: "kube-system" }, status: { phase: "Running" } },
];

describe("HubbleSource", () => {
  let relay: RelayFake;

  beforeEach(async () => {
    relay = await startRelay();
  });

  afterEach(async () => {
    await relay.close();
  });

  const installed = () =>
    fakeAccess(relay, {
      "/api/v1/pods?labelSelector=k8s-app%3Dhubble-relay": relayPods,
      "/api/v1/namespaces/kube-system/services/hubble-relay": {
        metadata: { name: "hubble-relay" },
        spec: { ports: [{ port: 80 }] },
      },
      "/api/v1/namespaces/kube-system/configmaps/cilium-config": {
        metadata: { name: "cilium-config", labels: { "cilium.io/version": "1.18.0" } },
      },
    });

  it("is not found without relay pods", async () => {
    const source = new HubbleSource(fakeAccess(relay, {}));

    expect(await source.detect()).toMatchObject({ available: false });
  });

  it("is present but unusable when the relay pods do not run", async () => {
    const source = new HubbleSource(
      fakeAccess(relay, {
        "/api/v1/pods?labelSelector=k8s-app%3Dhubble-relay": [
          { metadata: { name: "hubble-relay-1", namespace: "kube-system" }, status: { phase: "Pending" } },
        ],
      }),
    );

    expect(await source.detect()).toMatchObject({ available: false, present: true });
  });

  it("detects the relay with its version", async () => {
    const source = new HubbleSource(installed());

    expect(await source.detect()).toMatchObject({ available: true, version: "1.18.0", native: false });
  });

  it("reads the flows of the window through the relay", async () => {
    const now = Math.floor(Date.now() / 1000);

    relay.flows = [
      {
        timeSeconds: now - 10,
        verdict: 1,
        tcp: [40000, 8080],
        source: { namespace: "shop", pod: "web-1", workload: ["web", "Deployment"] },
        destination: { namespace: "shop", pod: "api-1", workload: ["api", "Deployment"] },
      },
      {
        // Older than the window: left out.
        timeSeconds: now - 3600,
        verdict: 1,
        tcp: [40001, 8080],
        source: { namespace: "shop", pod: "web-2" },
        destination: { namespace: "shop", pod: "api-1" },
      },
      {
        timeSeconds: now - 5,
        verdict: 1,
        tcp: [40002, 5432],
        source: { namespace: "other", pod: "batch-1" },
        destination: { namespace: "other", pod: "db-1" },
      },
    ];
    relay.extra = [new ProtobufWriter().message(3, (event) => event.uint(2, 50)).finish()];

    const source = new HubbleSource(installed());

    await source.detect();

    const response = await source.getFlows({ namespaces: ["shop"], sinceSeconds: 300, limit: 1000 });

    source.close();

    expect(response.flows).toHaveLength(1);
    expect(response.flows[0]).toMatchObject({
      source: { name: "web-1", workload: "web" },
      destination: { name: "api-1" },
      port: 8080,
      verdict: "forwarded",
    });
    expect(relay.requests).toEqual([{ number: 1000, whitelistCount: 2 }]);
    expect(response.warning).toContain("50 events lost");
    expect(response.warningKind).toBe("incomplete");
  });

  it("reports a relay it cannot reach as a warning to retry", async () => {
    const source = new HubbleSource({
      ...installed(),
      portForward: async () => {
        throw new Error("port-forward failed");
      },
    });

    await source.detect();

    expect(await source.getFlows({ namespaces: [], sinceSeconds: 60, limit: 10 })).toMatchObject({
      flows: [],
      warning: "port-forward failed",
      warningKind: "transient",
    });
  });
});
