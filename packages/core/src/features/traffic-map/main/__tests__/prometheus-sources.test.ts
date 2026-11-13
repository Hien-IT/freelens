/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { describe, expect, it } from "vitest";
import { BeylaSource, beylaRateQuery } from "../beyla-source";
import { CarettaSource, carettaLinksQuery } from "../caretta-source";
import { PrometheusUnavailableError } from "../cluster-access";
import { IstioSource, istioRateQuery } from "../istio-source";

import type { ClusterAccess, KubeObjectJson, PromSample } from "../cluster-access";

interface Fake {
  objects?: Record<string, KubeObjectJson | KubeObjectJson[]>;
  /** The samples of the first query that contains the key. */
  queries?: [needle: string, samples: PromSample[] | Error][];
  services?: PromSample[];
}

function fakeAccess({ objects = {}, queries = [], services }: Fake): ClusterAccess & { asked: string[] } {
  const asked: string[] = [];
  const query = async (text: string) => {
    asked.push(text);

    const match = queries.find(([needle]) => text.includes(needle));

    if (match?.[1] instanceof Error) throw match[1];

    return match?.[1] ?? [];
  };

  return {
    asked,
    list: async (path) => ((objects[path] as KubeObjectJson[] | undefined) ?? []) as never[],
    get: async (path) => objects[path] as never,
    queryPrometheus: query,
    queryService: async (_target, text) => services ?? query(text),
    portForward: async () => {
      throw new Error("not used");
    },
  };
}

const options = { namespaces: [], sinceSeconds: 300, limit: 1000 };

describe("Istio", () => {
  it("builds rate queries kept to the namespaces", () => {
    expect(istioRateQuery("a, b", "istio_requests_total", "", "300s", ["shop", "pay"])).toBe(
      'sum by (a, b) (rate(istio_requests_total{reporter="destination", source_workload_namespace=~"shop|pay"}[300s])) or ' +
        'sum by (a, b) (rate(istio_requests_total{reporter="destination", destination_workload_namespace=~"shop|pay"}[300s]))',
    );
  });

  it("is detected by a ready istiod", async () => {
    const source = new IstioSource(
      fakeAccess({
        objects: {
          "/apis/apps/v1/namespaces/istio-system/deployments?labelSelector=app%3Distiod": [
            {
              metadata: { name: "istiod", labels: { "app.kubernetes.io/version": "1.27.0" } },
              spec: { replicas: 1 },
              status: { readyReplicas: 1 },
            },
          ],
        },
      }),
    );

    expect(await source.detect()).toMatchObject({ available: true, version: "1.27.0" });
  });

  it("reads HTTP rates, errors and bytes per workload pair", async () => {
    const labels = {
      source_workload: "web",
      source_workload_namespace: "shop",
      destination_workload: "api",
      destination_workload_namespace: "shop",
      destination_service_name: "api",
      request_protocol: "http",
    };
    const source = new IstioSource(
      fakeAccess({
        queries: [
          ['response_code=~"5.."', [{ metric: labels, value: 0.5 }]],
          ["istio_requests_total", [{ metric: labels, value: 10 }]],
          ["istio_request_bytes_sum", [{ metric: labels, value: 100 }]],
          ["istio_response_bytes_sum", [{ metric: labels, value: 200 }]],
        ],
      }),
    );

    const { flows, warning } = await source.getFlows(options);

    expect(warning).toBeUndefined();
    expect(flows).toEqual([
      expect.objectContaining({
        source: { name: "web", namespace: "shop", kind: "Pod", workload: "web" },
        destination: { name: "api", namespace: "shop", kind: "Pod", workload: "api" },
        l7Protocol: "HTTP",
        requestRate: 10,
        errorRate: 0.5,
        connections: 10,
        bytesSent: 30_000,
        bytesRecv: 60_000,
        verdict: "error",
      }),
    ]);
  });

  it("names a missing figure rather than showing zero", async () => {
    const source = new IstioSource(
      fakeAccess({
        queries: [
          ["istio_request_bytes_sum", new Error("timeout")],
          [
            "istio_requests_total",
            [
              {
                metric: {
                  source_workload: "web",
                  source_workload_namespace: "shop",
                  destination_workload: "api",
                  destination_workload_namespace: "shop",
                },
                value: 1,
              },
            ],
          ],
        ],
      }),
    );

    const { warning, warningKind } = await source.getFlows(options);

    expect(warning).toContain("request/response bytes");
    expect(warningKind).toBe("partial");
  });

  it("says so when there is no Prometheus", async () => {
    const source = new IstioSource(
      fakeAccess({ queries: [["istio_requests_total", new PrometheusUnavailableError("not found")]] }),
    );

    expect(await source.getFlows(options)).toMatchObject({ flows: [], warningKind: "transient" });
  });
});

describe("Caretta", () => {
  const pods = {
    "/api/v1/pods?labelSelector=app.kubernetes.io%2Fname%3Dcaretta": [
      {
        metadata: { name: "caretta-x", namespace: "caretta", labels: { "app.kubernetes.io/version": "0.0.16" } },
        status: { phase: "Running" },
      },
    ],
  };

  it("builds the links query kept to the namespaces", () => {
    expect(carettaLinksQuery([])).toBe("caretta_links_observed");
    expect(carettaLinksQuery(["shop"])).toBe(
      'caretta_links_observed{client_namespace=~"shop"} or caretta_links_observed{server_namespace=~"shop"}',
    );
  });

  it("reads the links from Caretta's own metrics store", async () => {
    const access = fakeAccess({
      objects: {
        ...pods,
        "/api/v1/namespaces/caretta/services/caretta-vm": {
          metadata: { name: "caretta-vm" },
          spec: { ports: [{ port: 8428 }] },
        },
      },
      services: [
        {
          metric: {
            client_name: "web",
            client_namespace: "shop",
            client_kind: "Deployment",
            server_name: "db",
            server_namespace: "shop",
            server_kind: "StatefulSet",
            server_port: "5432",
          },
          value: 42.7,
        },
        {
          metric: { client_name: "web", client_namespace: "shop", server_name: "1.1.1.1", server_port: "443" },
          value: 3,
        },
      ],
    });
    const source = new CarettaSource(access);

    expect(await source.detect()).toMatchObject({ available: true, version: "0.0.16" });

    const { flows } = await source.getFlows(options);

    expect(flows[0]).toMatchObject({
      source: { name: "web", kind: "Workload", workloadKind: "Deployment" },
      destination: { name: "db", kind: "Workload", workloadKind: "StatefulSet" },
      port: 5432,
      connections: 42,
    });
    expect(flows[1].destination).toEqual({ name: "1.1.1.1", namespace: "", kind: "External" });
  });
});

describe("Beyla", () => {
  it("builds rate queries on its jobs", () => {
    expect(beylaRateQuery("beyla_network_flow_bytes_total", "a", ', direction="request"', "300s", [])).toBe(
      'sum by (a) (rate(beyla_network_flow_bytes_total{job=~".*beyla.*|.*alloy.*", direction="request"}[300s]))',
    );
  });

  it("is detected by its network flow metric", async () => {
    const source = new BeylaSource(
      fakeAccess({
        queries: [
          ["count(beyla_network_flow_bytes_total", [{ metric: {}, value: 12 }]],
          ["beyla_build_info", [{ metric: { version: "2.5.0" }, value: 1 }]],
        ],
      }),
    );

    expect(await source.detect()).toMatchObject({ available: true, version: "2.5.0" });
  });

  it("is present when it runs without its network feature", async () => {
    const source = new BeylaSource(
      fakeAccess({ queries: [["beyla_build_info{", [{ metric: { version: "2.5.0" }, value: 1 }]]] }),
    );

    expect(await source.detect()).toMatchObject({ available: false, present: true });
  });

  it("merges flows with the HTTP rates of their destination", async () => {
    const pair = {
      k8s_src_owner_name: "web",
      k8s_src_namespace: "shop",
      k8s_src_owner_type: "Deployment",
      k8s_dst_owner_name: "api",
      k8s_dst_namespace: "shop",
      k8s_dst_owner_type: "Deployment",
    };
    const reversed = {
      k8s_src_owner_name: "api",
      k8s_src_namespace: "shop",
      k8s_src_owner_type: "Deployment",
      k8s_dst_owner_name: "web",
      k8s_dst_namespace: "shop",
      k8s_dst_owner_type: "Deployment",
    };
    const server = { k8s_namespace_name: "shop", k8s_owner_name: "api", server_port: "8080" };
    const source = new BeylaSource(
      fakeAccess({
        queries: [
          ['direction="request"', [{ metric: { ...pair, dst_port: "8080", transport: "TCP" }, value: 10 }]],
          ['direction="response"', [{ metric: reversed, value: 20 }]],
          ['direction="unknown"', []],
          ["http_server_request_duration_seconds_sum", [{ metric: server, value: 0.05 }]],
          ['http_response_status_code=~"5.."', [{ metric: server, value: 1 }]],
          [
            "http_server_request_duration_seconds_count",
            [{ metric: { ...server, http_request_method: "GET", http_route: "/items" }, value: 4 }],
          ],
        ],
      }),
    );

    const { flows, warning } = await source.getFlows(options);

    expect(warning).toBeUndefined();
    expect(flows).toEqual([
      expect.objectContaining({
        source: expect.objectContaining({ name: "web", kind: "Workload" }),
        destination: expect.objectContaining({ name: "api", kind: "Workload" }),
        port: 8080,
        protocol: "tcp",
        bytesSent: 3_000,
        bytesRecv: 6_000,
        requestRate: 4,
        errorRate: 1,
        latencyMs: 50,
        httpMethod: "GET",
        httpPath: "/items",
        verdict: "error",
      }),
    ]);
  });

  it("says when it does not export the port and the transport", async () => {
    const source = new BeylaSource(
      fakeAccess({
        queries: [
          [
            'direction="request"',
            [
              {
                metric: {
                  k8s_src_owner_name: "web",
                  k8s_src_namespace: "shop",
                  k8s_dst_owner_name: "api",
                  k8s_dst_namespace: "shop",
                },
                value: 1,
              },
            ],
          ],
        ],
      }),
    );

    const { warning, warningKind } = await source.getFlows(options);

    expect(warning).toContain("dst.port and transport");
    expect(warningKind).toBe("partial");
  });
});
