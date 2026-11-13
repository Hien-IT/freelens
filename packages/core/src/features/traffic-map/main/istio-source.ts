/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { roundRate } from "../common/aggregation";
import { PrometheusUnavailableError } from "./cluster-access";
import { promAlternatives, promWindow } from "./source";

import type { DetectionResult, FlowsResponse, TrafficEndpoint, TrafficFlow } from "../common/types";
import type { ClusterAccess, KubeObjectJson, PromSample } from "./cluster-access";
import type { FlowOptions, TrafficSource } from "./source";

const istiodNamespaces = ["istio-system", "istio", "default"];
const reporter = 'reporter="destination"';
const workloadLabels = [
  "source_workload",
  "source_workload_namespace",
  "destination_workload",
  "destination_workload_namespace",
  "destination_service_name",
];
const httpGroupBy = [...workloadLabels, "request_protocol"].join(", ");
const tcpGroupBy = workloadLabels.join(", ");

/**
 * `sum by (groupBy) (rate(metric{reporter="destination"…}[window]))`, kept to
 * the traffic that starts or ends in one of the namespaces when there are any.
 */
export function istioRateQuery(
  groupBy: string,
  metric: string,
  extra: string,
  window: string,
  namespaces: readonly string[],
): string {
  const sum = (selector: string) => `sum by (${groupBy}) (rate(${metric}{${reporter}${extra}${selector}}[${window}]))`;

  if (namespaces.length === 0) {
    return sum("");
  }

  const pattern = promAlternatives(namespaces);

  return `${sum(`, source_workload_namespace=~"${pattern}"`)} or ${sum(`, destination_workload_namespace=~"${pattern}"`)}`;
}

function seriesKey(metric: Record<string, string>): string {
  return [...workloadLabels, "request_protocol"].map((label) => metric[label] ?? "").join("|");
}

function ratesByKey(samples: readonly PromSample[]): Map<string, number> {
  const rates = new Map<string, number>();

  for (const sample of samples) {
    if (sample.value > 0) {
      const key = seriesKey(sample.metric);

      rates.set(key, (rates.get(key) ?? 0) + sample.value);
    }
  }

  return rates;
}

function istioEndpoint(name: string, namespace: string, service?: string): TrafficEndpoint {
  if ((!name || name === "unknown") && service) {
    return { name: service, namespace, kind: "Service" };
  }

  if (!namespace && name) {
    return { name, namespace: "", kind: "External" };
  }

  return { name, namespace, kind: "Pod", workload: name };
}

/** Reads the standard metrics of the Istio sidecars and gateways from Prometheus. */
export class IstioSource implements TrafficSource {
  readonly name = "istio" as const;

  constructor(private readonly access: ClusterAccess) {}

  async detect(): Promise<DetectionResult> {
    let unready: string | undefined;

    for (const namespace of istiodNamespaces) {
      const deployments = await this.access.list(
        `/apis/apps/v1/namespaces/${namespace}/deployments?labelSelector=${encodeURIComponent("app=istiod")}`,
      );

      if (deployments.length === 0) {
        continue;
      }

      const ready = deployments.filter((deployment) => (deployment.status?.readyReplicas ?? 0) > 0);

      if (ready.length === 0) {
        const [first] = deployments;

        unready ??= `istiod found in ${namespace} but not ready (0/${first.spec?.replicas ?? 1} replicas)`;
        continue;
      }

      const [first] = ready;
      const message =
        ready.length > 1
          ? `Istio detected with ${ready.length} istiod revisions running in namespace ${namespace}: ${ready.map(revisionOf).join(", ")}`
          : `Istio detected with istiod running in namespace ${namespace} (${first.status?.readyReplicas}/${first.spec?.replicas ?? 1} ready)`;

      return { available: true, version: versionOf(first), message };
    }

    return {
      available: false,
      message: unready ?? "Istio not detected. Install Istio for service mesh traffic visibility.",
    };
  }

  async getFlows(options: FlowOptions): Promise<FlowsResponse> {
    const now = Date.now();
    const window = promWindow(options.sinceSeconds);
    const seconds = Math.max(60, options.sinceSeconds);
    const query = (groupBy: string, metric: string, extra = "") =>
      this.access.queryPrometheus(istioRateQuery(groupBy, metric, extra, window, options.namespaces));

    let requests: PromSample[];

    try {
      requests = await query(httpGroupBy, "istio_requests_total");
    } catch (error) {
      return {
        source: this.name,
        timestamp: now,
        flows: [],
        warning:
          error instanceof PrometheusUnavailableError
            ? `Prometheus is not available for the Istio metrics: ${error.message}`
            : `Failed to query Prometheus for the Istio metrics: ${error instanceof Error ? error.message : String(error)}`,
        warningKind: "transient",
      };
    }

    const [errors, sent, received, tcp] = await Promise.allSettled([
      query(httpGroupBy, "istio_requests_total", ', response_code=~"5.."'),
      query(httpGroupBy, "istio_request_bytes_sum"),
      query(httpGroupBy, "istio_response_bytes_sum"),
      query(tcpGroupBy, "istio_tcp_connections_opened_total"),
    ]);
    const missing: string[] = [];
    const settledRates = (result: PromiseSettledResult<PromSample[]>, what: string) => {
      if (result.status === "fulfilled") {
        return ratesByKey(result.value);
      }

      if (!missing.includes(what)) {
        missing.push(what);
      }

      return new Map<string, number>();
    };
    const errorRates = settledRates(errors, "5xx error rates");
    const sentRates = settledRates(sent, "request/response bytes");
    const receivedRates = settledRates(received, "request/response bytes");
    const flows: TrafficFlow[] = [];

    for (const { metric, value } of requests) {
      if (value <= 0) {
        continue;
      }

      const key = seriesKey(metric);
      const protocol = (metric.request_protocol || "http").toLowerCase();
      const errorRate = errorRates.get(key) ?? 0;

      flows.push({
        source: istioEndpoint(metric.source_workload, metric.source_workload_namespace),
        destination: istioEndpoint(
          metric.destination_workload,
          metric.destination_workload_namespace,
          metric.destination_service_name,
        ),
        protocol,
        port: 0,
        l7Protocol: protocol === "grpc" ? "gRPC" : protocol.toUpperCase(),
        requestRate: value,
        errorRate,
        connections: roundRate(value),
        bytesSent: Math.round((sentRates.get(key) ?? 0) * seconds),
        bytesRecv: Math.round((receivedRates.get(key) ?? 0) * seconds),
        verdict: errorRate > 0 ? "error" : "forwarded",
        lastSeen: now,
      });
    }

    if (tcp.status === "fulfilled") {
      for (const { metric, value } of tcp.value) {
        if (value <= 0) {
          continue;
        }

        flows.push({
          source: istioEndpoint(metric.source_workload, metric.source_workload_namespace),
          destination: istioEndpoint(
            metric.destination_workload,
            metric.destination_workload_namespace,
            metric.destination_service_name,
          ),
          protocol: "tcp",
          port: 0,
          connections: roundRate(value),
          bytesSent: 0,
          bytesRecv: 0,
          verdict: "forwarded",
          lastSeen: now,
        });
      }
    } else {
      missing.push("TCP connections");
    }

    return {
      source: this.name,
      timestamp: now,
      flows,
      ...(missing.length && (flows.length || tcp.status === "rejected")
        ? {
            warning: `The Istio metrics are incomplete: the ${missing.join(", ")} could not be read from Prometheus, so those figures are missing from these edges rather than zero.`,
            warningKind: tcp.status === "rejected" ? "transient" : "partial",
          }
        : {}),
    };
  }

  close() {}
}

function revisionOf(deployment: KubeObjectJson): string {
  return deployment.spec?.template?.metadata?.labels?.["istio.io/rev"] ?? deployment.metadata.name;
}

function versionOf(deployment: KubeObjectJson): string | undefined {
  const revision = deployment.spec?.template?.metadata?.labels?.["istio.io/rev"];

  if (revision) {
    return revision;
  }

  const label = deployment.metadata.labels?.["app.kubernetes.io/version"];

  if (label) {
    return label;
  }

  const image: string | undefined = (deployment.spec?.template?.spec?.containers ?? [])
    .map((container: { image?: string }) => container.image)
    .find((value: string | undefined) => value?.includes(":"));

  return image?.slice(image.lastIndexOf(":") + 1);
}
