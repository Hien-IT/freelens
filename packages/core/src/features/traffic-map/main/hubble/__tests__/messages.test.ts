/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { describe, expect, it } from "vitest";
import { convertHubbleFlow, nameExternalAddresses } from "../convert";
import { decodeGetFlowsResponse, encodeGetFlowsRequest } from "../messages";
import { ProtobufWriter, readFields, readVarint } from "../protobuf";
import { encodeFlow } from "./encode-flow";

import type { HubbleFlow } from "../messages";
import type { FlowSpec } from "./encode-flow";

function decodeFlow(spec: FlowSpec): HubbleFlow {
  const response = new ProtobufWriter().bytes(1, encodeFlow(spec)).string(1000, "node-a").finish();
  const decoded = decodeGetFlowsResponse(response);

  if (decoded.type !== "flow") {
    throw new Error(`Expected a flow, got ${decoded.type}`);
  }

  return decoded.flow;
}

describe("protobuf", () => {
  it("reads varints of more than 32 bits", () => {
    const encoded = new ProtobufWriter().uint(1, 2 ** 40 + 5).finish();
    const [field] = [...readFields(encoded)];

    expect(field.value).toBe(2 ** 40 + 5);
    expect(readVarint(Uint8Array.from([0xac, 0x02]), 0)).toEqual([300, 2]);
  });
});

describe("encodeGetFlowsRequest", () => {
  it("writes the number, the filters and the field mask", () => {
    const request = encodeGetFlowsRequest({
      number: 500,
      whitelist: [{ sourcePod: ["shop/"] }],
      blacklist: [{ reply: [true], eventTypes: [4] }],
    });
    const fields = [...readFields(request)];

    expect(fields.find((field) => field.number === 1)?.value).toBe(500);

    const whitelist = fields.find((field) => field.number === 6)!;

    expect(
      [...readFields(whitelist.bytes)].map((field) => [field.number, new TextDecoder().decode(field.bytes)]),
    ).toEqual([[2, "shop/"]]);

    const blacklist = [...readFields(fields.find((field) => field.number === 5)!.bytes)];

    expect(blacklist.map((field) => field.number)).toEqual([6, 15]);
    expect(fields.filter((field) => field.number === 10)).toHaveLength(1);
  });
});

describe("decoding and converting Hubble flows", () => {
  it("reads a TCP flow between two pods with their workloads", () => {
    const flow = convertHubbleFlow(
      decodeFlow({
        timeSeconds: 1_700_000_000,
        verdict: 1,
        ip: ["10.0.0.1", "10.0.0.2"],
        tcp: [43210, 8080],
        source: { namespace: "shop", pod: "web-1", workload: ["web", "Deployment"] },
        destination: { namespace: "shop", pod: "api-1", workload: ["api", "Deployment"] },
      }),
      0,
    );

    expect(flow).toEqual({
      source: {
        name: "web-1",
        namespace: "shop",
        kind: "Pod",
        ip: "10.0.0.1",
        workload: "web",
        workloadKind: "Deployment",
      },
      destination: {
        name: "api-1",
        namespace: "shop",
        kind: "Pod",
        ip: "10.0.0.2",
        workload: "api",
        workloadKind: "Deployment",
      },
      protocol: "tcp",
      port: 8080,
      bytesSent: 0,
      bytesRecv: 0,
      connections: 1,
      verdict: "forwarded",
      lastSeen: 1_700_000_000_500,
    });
  });

  it("classifies the world and the host by their identities", () => {
    const flow = convertHubbleFlow(
      decodeFlow({
        verdict: 1,
        udp: [5353, 53],
        source: { labels: ["reserved:host"] },
        destination: { labels: ["reserved:world", "cidr:8.8.8.8/32"] },
      }),
      42,
    );

    expect(flow?.source).toMatchObject({ kind: "Host", name: "host" });
    expect(flow?.destination).toMatchObject({ kind: "External", name: "world" });
    expect(flow?.protocol).toBe("udp");
    expect(flow?.lastSeen).toBe(42);
  });

  it("names a Rollout from the ReplicaSet that runs its pod", () => {
    const flow = convertHubbleFlow(
      decodeFlow({
        tcp: [1, 80],
        source: {
          namespace: "shop",
          pod: "cart-6c9d8-x",
          labels: ["k8s:rollouts-pod-template-hash=6c9d8"],
          workload: ["cart-6c9d8", "ReplicaSet"],
        },
      }),
      0,
    );

    expect(flow?.source).toMatchObject({ workload: "cart", workloadKind: "Rollout" });
  });

  it("turns an HTTP response around onto the caller's edge", () => {
    const flow = convertHubbleFlow(
      decodeFlow({
        verdict: 1,
        tcp: [8080, 43210],
        source: { namespace: "shop", pod: "api-1" },
        destination: { namespace: "shop", pod: "web-1" },
        http: { code: 503, method: "GET", url: "/items" },
        l7Type: 2,
        latencyNs: 12_000_000,
        isReply: true,
      }),
      0,
    );

    expect(flow).toMatchObject({
      source: { name: "web-1" },
      destination: { name: "api-1" },
      port: 8080,
      connections: 0,
      l7Protocol: "HTTP",
      l7Type: "RESPONSE",
      httpStatus: 503,
      latencyMs: 12,
    });
  });

  it("leaves out a reply without L7", () => {
    expect(convertHubbleFlow(decodeFlow({ tcp: [80, 1234], isReply: true }), 0)).toBeUndefined();
  });

  it("names the reason and the policy of a dropped flow", () => {
    const flow = convertHubbleFlow(
      decodeFlow({
        verdict: 2,
        dropReasonDesc: 133,
        tcp: [1, 5432],
        deniedBy: [{ name: "deny-db", namespace: "shop", kind: "NetworkPolicy" }],
      }),
      0,
    );

    expect(flow).toMatchObject({
      verdict: "dropped",
      dropReason: "POLICY_DENIED",
      policyVerdict: { deniedBy: [{ kind: "NetworkPolicy", namespace: "shop", name: "deny-db" }] },
    });
  });

  it("reads a DNS query", () => {
    const flow = convertHubbleFlow(
      decodeFlow({ udp: [5353, 53], dns: { query: "db.example.com.", rcode: 3 }, l7Type: 2 }),
      0,
    );

    expect(flow).toMatchObject({ l7Protocol: "DNS", dnsQuery: "db.example.com.", dnsRCode: 3 });
  });
});

describe("domains of outside addresses", () => {
  it("keeps the DNS names that Hubble knows for an outside address", () => {
    const flow = convertHubbleFlow(
      decodeFlow({
        tcp: [40000, 443],
        ip: ["10.0.0.1", "140.82.112.3"],
        source: { namespace: "infra", pod: "teleport-auth-1" },
        destination: { labels: ["reserved:world"] },
        destinationNames: ["github.com"],
      }),
      0,
    );

    expect(flow?.destination).toEqual({
      kind: "External",
      name: "world",
      namespace: "",
      ip: "140.82.112.3",
      names: ["github.com"],
    });
  });

  it("names an outside address from a DNS answer of the same window", () => {
    const answer = convertHubbleFlow(
      decodeFlow({
        udp: [53, 40000],
        source: { namespace: "kube-system", pod: "coredns-1" },
        destination: { namespace: "infra", pod: "teleport-auth-1" },
        dns: { query: "api.example.com.", ips: ["203.0.113.7"] },
        l7Type: 2,
        isReply: true,
      }),
      0,
    )!;
    const connection = convertHubbleFlow(
      decodeFlow({
        tcp: [40001, 443],
        ip: ["10.0.0.1", "203.0.113.7"],
        source: { namespace: "infra", pod: "teleport-auth-1" },
        destination: { labels: ["reserved:world"] },
      }),
      0,
    )!;

    expect(answer.dnsIps).toEqual(["203.0.113.7"]);

    nameExternalAddresses([answer, connection]);

    expect(connection.destination.names).toEqual(["api.example.com"]);
  });
});

describe("decodeGetFlowsResponse", () => {
  it("reads lost events and node status", () => {
    const lost = new ProtobufWriter().message(3, (event) => event.uint(1, 1).uint(2, 17)).finish();
    const status = new ProtobufWriter()
      .message(2, (event) => event.uint(1, 2).string(2, "node-b").string(2, "node-c"))
      .finish();

    expect(decodeGetFlowsResponse(lost)).toEqual({ type: "lost-events", count: 17 });
    expect(decodeGetFlowsResponse(status)).toEqual({ type: "node-status", state: 2, nodeNames: ["node-b", "node-c"] });
  });
});
