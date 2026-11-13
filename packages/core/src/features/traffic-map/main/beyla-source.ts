/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { roundRate } from "../common/aggregation";
import { PrometheusUnavailableError } from "./cluster-access";
import { promAlternatives, promWindow } from "./source";

import type { DetectionResult, EndpointKind, FlowsResponse, TrafficEndpoint, TrafficFlow } from "../common/types";
import type { ClusterAccess, PromSample } from "./cluster-access";
import type { FlowOptions, TrafficSource } from "./source";

/** The jobs that Beyla, or Grafana Alloy running it, is scraped under. */
const jobSelector = 'job=~".*beyla.*|.*alloy.*"';
/** Beyla's name for the network flow metric, and the name of OpenTelemetry eBPF Instrumentation that it became. */
const flowMetrics = ["beyla_network_flow_bytes_total", "obi_network_flow_bytes_total"];
const buildInfoMetrics = ["beyla_build_info", "obi_build_info"];
const httpCount = "http_server_request_duration_seconds_count";
const httpSum = "http_server_request_duration_seconds_sum";
const pairLabels = [
  "k8s_src_owner_name",
  "k8s_src_namespace",
  "k8s_src_owner_type",
  "k8s_dst_owner_name",
  "k8s_dst_namespace",
  "k8s_dst_owner_type",
];
const l7Labels = "k8s_namespace_name, k8s_owner_name, k8s_pod_name, server_port";

function usable(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function beylaKind(type: string | undefined): EndpointKind {
  switch (type?.toLowerCase()) {
    case "deployment":
    case "replicaset":
    case "statefulset":
    case "daemonset":
      return "Workload";
    case "service":
      return "Service";
    default:
      return "Pod";
  }
}

function beylaEndpoint(name: string, namespace: string, type: string | undefined): TrafficEndpoint {
  if (!namespace) {
    return { name, namespace: "", kind: "External" };
  }

  const kind = beylaKind(type);

  return kind === "Service"
    ? { name, namespace, kind }
    : { name, namespace, kind, workload: name, workloadKind: type || undefined };
}

function endpointsOf(metric: Record<string, string>) {
  const sourceName = metric.k8s_src_owner_name || metric.k8s_src_name || "";
  const destinationName = metric.k8s_dst_owner_name || metric.k8s_dst_name || "";

  return {
    sourceName,
    destinationName,
    source: beylaEndpoint(sourceName, metric.k8s_src_namespace ?? "", metric.k8s_src_owner_type || metric.k8s_src_type),
    destination: beylaEndpoint(
      destinationName,
      metric.k8s_dst_namespace ?? "",
      metric.k8s_dst_owner_type || metric.k8s_dst_type,
    ),
  };
}

const endpointKey = (endpoint: TrafficEndpoint) => `${endpoint.namespace}/${endpoint.name}`;

/** `sum by (groupBy) (rate(metric{job…, extra}[window]))`, kept to the traffic that starts or ends in the namespaces. */
export function beylaRateQuery(
  metric: string,
  groupBy: string,
  extra: string,
  window: string,
  namespaces: readonly string[],
): string {
  const sum = (selector: string) =>
    `sum by (${groupBy}) (rate(${metric}{${jobSelector}${extra}${selector}}[${window}]))`;

  if (namespaces.length === 0) {
    return sum("");
  }

  const pattern = promAlternatives(namespaces);

  return `${sum(`, k8s_src_namespace=~"${pattern}"`)} or ${sum(`, k8s_dst_namespace=~"${pattern}"`)}`;
}

interface L7Stats {
  rate: number;
  errors: number;
  latencySeconds: number;
  method?: string;
  route?: string;
  busiest: number;
}

/**
 * Reads the network flow metrics of Grafana Beyla (or Alloy running it) from
 * Prometheus, with the HTTP server metrics it records for the destinations.
 */
export class BeylaSource implements TrafficSource {
  readonly name = "beyla" as const;

  private flowMetric = flowMetrics[0];

  constructor(private readonly access: ClusterAccess) {}

  async detect(): Promise<DetectionResult> {
    try {
      for (const candidate of flowMetrics) {
        const samples = await this.access.queryPrometheus(`count(${candidate}{${jobSelector}})`);

        if (samples.length > 0) {
          this.flowMetric = candidate;

          return {
            available: true,
            version: await this.version(),
            message: `Beyla detected through its Prometheus metrics (${candidate})`,
          };
        }
      }

      const version = await this.version();

      if (version) {
        return {
          available: false,
          present: true,
          version,
          message: `Beyla ${version} is running, but Prometheus holds no network flow metrics for it. Either its network feature is off — add "network" to OTEL_EBPF_METRICS_FEATURES — or no traffic has been observed yet.`,
        };
      }

      for (const metric of buildInfoMetrics) {
        if ((await this.access.queryPrometheus(`count(${metric})`)).length > 0) {
          return {
            available: false,
            present: true,
            message: `Beyla is in Prometheus, but none of its metrics match ${jobSelector}.`,
          };
        }
      }
    } catch (error) {
      if (!(error instanceof PrometheusUnavailableError)) {
        throw error;
      }
    }

    const pods = await Promise.all(
      ["alloy", "beyla"].map((name) =>
        this.access.list(`/api/v1/pods?labelSelector=${encodeURIComponent(`app.kubernetes.io/name=${name}`)}`),
      ),
    );
    const running = pods.flat().filter((pod) => pod.status?.phase === "Running").length;

    if (running > 0) {
      return {
        available: false,
        present: true,
        message: `Found ${running} running Alloy or Beyla pod(s), but Prometheus holds no Beyla metrics. Check that the Prometheus of the cluster scrapes Beyla.`,
      };
    }

    return {
      available: false,
      message:
        'Beyla not detected. Install Alloy or Beyla for traffic visibility, and include "network" in OTEL_EBPF_METRICS_FEATURES: the traffic map needs it, and it is off by default.',
    };
  }

  private async version(): Promise<string | undefined> {
    for (const metric of buildInfoMetrics) {
      const [sample] = await this.access.queryPrometheus(`${metric}{${jobSelector}}`).catch(() => []);

      if (sample) {
        return sample.metric.version || sample.metric.beyla_version;
      }
    }

    return undefined;
  }

  async getFlows(options: FlowOptions): Promise<FlowsResponse> {
    const now = Date.now();
    const window = promWindow(options.sinceSeconds);
    const seconds = Math.max(60, options.sinceSeconds);
    const groupBy = pairLabels.join(", ");
    let requests: PromSample[];

    try {
      requests = await this.access.queryPrometheus(
        beylaRateQuery(
          this.flowMetric,
          `${groupBy}, dst_port, transport`,
          ', direction="request"',
          window,
          options.namespaces,
        ),
      );
    } catch (error) {
      return {
        source: this.name,
        timestamp: now,
        flows: [],
        warning: `Failed to query the Beyla metrics: ${error instanceof Error ? error.message : String(error)}`,
        warningKind: "transient",
      };
    }

    const namespaceFilter = options.namespaces.length
      ? `, k8s_namespace_name=~"${promAlternatives(options.namespaces)}"`
      : "";
    const [responses, unknown, l7Rates, l7Latency, l7Errors] = await Promise.allSettled([
      this.access.queryPrometheus(
        beylaRateQuery(this.flowMetric, groupBy, ', direction="response"', window, options.namespaces),
      ),
      this.access.queryPrometheus(
        beylaRateQuery(this.flowMetric, `${groupBy}, transport`, ', direction="unknown"', window, options.namespaces),
      ),
      this.access.queryPrometheus(
        `sum by (${l7Labels}, http_request_method, http_route) (rate(${httpCount}{${jobSelector}${namespaceFilter}}[${window}]))`,
      ),
      this.access.queryPrometheus(
        `sum by (${l7Labels}) (rate(${httpSum}{${jobSelector}${namespaceFilter}}[${window}])) / sum by (${l7Labels}) (rate(${httpCount}{${jobSelector}${namespaceFilter}}[${window}]))`,
      ),
      this.access.queryPrometheus(
        `sum by (${l7Labels}) (rate(${httpCount}{${jobSelector}${namespaceFilter}, http_response_status_code=~"5.."}[${window}]))`,
      ),
    ]);
    const missing: string[] = [];
    const valueOf = (result: PromiseSettledResult<PromSample[]>, what: string): PromSample[] => {
      if (result.status === "fulfilled") return result.value;
      missing.push(what);

      return [];
    };

    // The flows that Beyla could orient: one per pair, port and transport.
    const flows = new Map<string, TrafficFlow>();
    let sawPort = false;
    let sawTransport = false;

    for (const { metric, value } of requests) {
      if (!usable(value)) continue;

      const { sourceName, destinationName, source, destination } = endpointsOf(metric);

      sawPort ||= Boolean(metric.dst_port);
      sawTransport ||= Boolean(metric.transport);

      if (!sourceName || !destinationName) continue;

      const port = Number.parseInt(metric.dst_port ?? "", 10) || 0;
      const key = `${endpointKey(source)}|${endpointKey(destination)}|${port}|${metric.transport ?? ""}`;
      const bytes = Math.round(value * seconds);
      const existing = flows.get(key);

      if (existing) {
        existing.bytesSent = Math.max(existing.bytesSent, bytes);
        continue;
      }

      flows.set(key, {
        source,
        destination,
        protocol: metric.transport?.toUpperCase() === "UDP" ? "udp" : "tcp",
        port,
        bytesSent: bytes,
        bytesRecv: 0,
        connections: 0,
        verdict: "forwarded",
        lastSeen: now,
      });
    }

    const edges = [...flows.values()];
    const edgesByPair = new Map<string, TrafficFlow[]>();

    for (const edge of edges) {
      const pair = `${endpointKey(edge.source)}|${endpointKey(edge.destination)}`;

      edgesByPair.set(pair, [...(edgesByPair.get(pair) ?? []), edge]);
    }

    // The replies, which Beyla records from the server to the client: spread
    // over the edges of the pair by what each sent.
    for (const { metric, value } of valueOf(responses, "received bytes")) {
      if (!usable(value)) continue;

      const { source, destination } = endpointsOf(metric);
      const pairEdges = edgesByPair.get(`${endpointKey(destination)}|${endpointKey(source)}`);

      if (!pairEdges) continue;

      const total = Math.round(value * seconds);
      const sent = pairEdges.reduce((sum, edge) => sum + edge.bytesSent, 0);

      for (const edge of pairEdges) {
        edge.bytesRecv = Math.max(
          edge.bytesRecv,
          Math.round(sent > 0 ? (total * edge.bytesSent) / sent : total / pairEdges.length),
        );
      }
    }

    this.mergeL7(
      edges,
      valueOf(l7Rates, "HTTP request rates"),
      valueOf(l7Latency, "HTTP latency"),
      valueOf(l7Errors, "HTTP 5xx error rates"),
    );

    // Conversations that Beyla could not orient, ordered by name so that the
    // two halves of one conversation fall on one edge.
    const unoriented = new Map<string, TrafficFlow>();

    if (unknown.status === "fulfilled") {
      for (const { metric, value } of unknown.value) {
        if (!usable(value)) continue;

        const { sourceName, destinationName, source, destination } = endpointsOf(metric);

        if (!sourceName || !destinationName) continue;

        const forward = endpointKey(source) <= endpointKey(destination);
        const [first, second] = forward ? [source, destination] : [destination, source];
        const key = `${endpointKey(first)}|${endpointKey(second)}|${metric.transport ?? ""}`;
        const bytes = Math.round(value * seconds);
        const edge = unoriented.get(key) ?? {
          source: first,
          destination: second,
          protocol: metric.transport?.toUpperCase() === "UDP" ? "udp" : "tcp",
          port: 0,
          bytesSent: 0,
          bytesRecv: 0,
          connections: 0,
          directionUnknown: true,
          verdict: "forwarded" as const,
          lastSeen: now,
        };

        if (forward) {
          edge.bytesSent += bytes;
        } else {
          edge.bytesRecv += bytes;
        }

        unoriented.set(key, edge);
      }
    }

    const allFlows = [...edges, ...unoriented.values()];
    const warnings: string[] = [];

    if (missing.length && allFlows.length) {
      warnings.push(
        `The Beyla metrics are incomplete: the ${missing.join(", ")} could not be read from Prometheus, so those figures are missing from these edges rather than zero.`,
      );
    }

    if (edges.length && (!sawPort || !sawTransport)) {
      const metricName = this.flowMetric.replace(/_total$/, "");
      const absent = [!sawPort && "dst.port", !sawTransport && "transport"].filter(Boolean).join(" and ");

      warnings.push(
        `Beyla is not exporting ${absent}, so ${!sawPort ? "every edge here appears as port 0" : "UDP traffic here is shown as TCP"}. ${
          !sawPort && !sawTransport ? "Both are" : "It is"
        } opt-in, added under attributes.select for ${metricName}.`,
      );
    }

    return {
      source: this.name,
      timestamp: now,
      flows: allFlows,
      ...(warnings.length ? { warning: warnings.join(" "), warningKind: "partial" as const } : {}),
    };
  }

  /**
   * Beyla measures HTTP at the server, without its callers: the rate of a
   * destination is shared among the edges into it, by the bytes each carried.
   */
  private mergeL7(edges: TrafficFlow[], rates: PromSample[], latencies: PromSample[], errors: PromSample[]) {
    const statsKey = (metric: Record<string, string>, withPort: boolean) =>
      `${metric.k8s_namespace_name ?? ""}/${metric.k8s_owner_name || metric.k8s_pod_name || ""}${withPort ? `:${metric.server_port ?? ""}` : ""}`;
    const byPort = new Map<string, L7Stats>();
    const byDestination = new Map<string, L7Stats>();
    const statsFor = (map: Map<string, L7Stats>, key: string) => {
      let stats = map.get(key);

      if (!stats) {
        stats = { rate: 0, errors: 0, latencySeconds: 0, busiest: 0 };
        map.set(key, stats);
      }

      return stats;
    };

    for (const { metric, value } of rates) {
      if (!usable(value)) continue;

      for (const stats of [
        statsFor(byPort, statsKey(metric, true)),
        statsFor(byDestination, statsKey(metric, false)),
      ]) {
        stats.rate += value;

        if (value > stats.busiest) {
          stats.busiest = value;
          stats.method = metric.http_request_method || undefined;
          stats.route = metric.http_route || undefined;
        }
      }
    }

    for (const { metric, value } of latencies) {
      if (!usable(value)) continue;

      for (const stats of [byPort.get(statsKey(metric, true)), byDestination.get(statsKey(metric, false))]) {
        if (stats) stats.latencySeconds = Math.max(stats.latencySeconds, value);
      }
    }

    for (const { metric, value } of errors) {
      if (!usable(value)) continue;

      for (const stats of [byPort.get(statsKey(metric, true)), byDestination.get(statsKey(metric, false))]) {
        if (stats) stats.errors += value;
      }
    }

    const buckets = new Map<string, TrafficFlow[]>();

    for (const edge of edges) {
      const key = `${edge.destination.namespace}/${edge.destination.name}:${edge.port}`;

      buckets.set(key, [...(buckets.get(key) ?? []), edge]);
    }

    for (const [key, bucket] of buckets) {
      const [first] = bucket;
      const stats =
        byPort.get(key) ??
        (first.port === 0 ? byDestination.get(`${first.destination.namespace}/${first.destination.name}`) : undefined);

      if (!stats) continue;

      const total = bucket.reduce((sum, edge) => sum + edge.bytesSent + edge.bytesRecv, 0);

      for (const edge of bucket) {
        const share = total > 0 ? (edge.bytesSent + edge.bytesRecv) / total : 1 / bucket.length;

        edge.requestRate = stats.rate * share;
        edge.errorRate = stats.errors * share;
        edge.connections = roundRate(edge.requestRate);
        edge.l7Protocol = "HTTP";
        edge.httpMethod = stats.method;
        edge.httpPath = stats.route;

        if (stats.latencySeconds > 0) {
          edge.latencyMs = stats.latencySeconds * 1000;
        }

        if (stats.errors > 0) {
          edge.verdict = "error";
        }
      }
    }
  }

  close() {}
}
