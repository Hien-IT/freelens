/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { PrometheusUnavailableError } from "./cluster-access";
import { promAlternatives } from "./source";

import type { DetectionResult, EndpointKind, FlowsResponse, TrafficEndpoint, TrafficFlow } from "../common/types";
import type { ClusterAccess, KubeObjectJson, PromSample, ServiceTarget } from "./cluster-access";
import type { FlowOptions, TrafficSource } from "./source";

const podSelector = "app.kubernetes.io/name=caretta";
const metric = "caretta_links_observed";
const storeSelector = "app.kubernetes.io/name=victoria-metrics-single";
const defaultStorePort = 8428;

export function carettaLinksQuery(namespaces: readonly string[]): string {
  if (namespaces.length === 0) {
    return metric;
  }

  const pattern = promAlternatives(namespaces);

  return `${metric}{client_namespace=~"${pattern}"} or ${metric}{server_namespace=~"${pattern}"}`;
}

const knownKinds = new Set<EndpointKind>(["Pod", "Workload", "Service", "External", "Host", "Unknown"]);

function carettaEndpoint(name: string, namespace: string, kind: string | undefined): TrafficEndpoint {
  if (!namespace && name) {
    return { name, namespace: "", kind: "External" };
  }

  if (kind === "node" || kind === "Node") {
    return { name, namespace, kind: "Host" };
  }

  // Caretta names the owner of a pod (a Deployment, a DaemonSet…) as its kind.
  if (kind && !knownKinds.has(kind as EndpointKind)) {
    return { name, namespace, kind: "Workload", workload: name, workloadKind: kind };
  }

  return { name, namespace, kind: (kind as EndpointKind) || "Pod", workload: name };
}

/**
 * Reads the links that Caretta's eBPF agents observe, from the
 * VictoriaMetrics that Caretta installs, or from the cluster's Prometheus
 * when that one holds them.
 */
export class CarettaSource implements TrafficSource {
  readonly name = "caretta" as const;

  private namespace?: string;
  private store?: ServiceTarget;

  constructor(private readonly access: ClusterAccess) {}

  async detect(): Promise<DetectionResult> {
    const pods = await this.access.list(`/api/v1/pods?labelSelector=${encodeURIComponent(podSelector)}`);

    if (pods.length === 0) {
      this.namespace = undefined;

      return {
        available: false,
        message: "Caretta not detected. Install Caretta for eBPF-based traffic visibility.",
      };
    }

    const sorted = [...pods].sort((a, b) =>
      `${a.metadata.namespace}/${a.metadata.name}`.localeCompare(`${b.metadata.namespace}/${b.metadata.name}`),
    );
    const running = sorted.filter((pod) => pod.status?.phase === "Running");

    if (running.length === 0) {
      return {
        available: false,
        message: `Caretta pods found in ${sorted[0].metadata.namespace} but none are running (${pods.length} total)`,
      };
    }

    this.namespace = running[0].metadata.namespace;
    this.store = undefined;

    return {
      available: true,
      version: running[0].metadata.labels?.["app.kubernetes.io/version"],
      message: `Caretta detected with ${running.length} running pod(s) in namespace ${this.namespace}`,
    };
  }

  /** Caretta's own metrics store in its namespace, if it has one. */
  private async findStore(): Promise<ServiceTarget | undefined> {
    if (this.store || !this.namespace) {
      return this.store;
    }

    const services = await this.access
      .list(`/api/v1/namespaces/${this.namespace}/services?labelSelector=${encodeURIComponent(storeSelector)}`)
      .catch(() => [] as KubeObjectJson[]);
    const service =
      services[0] ??
      (await this.access.get(`/api/v1/namespaces/${this.namespace}/services/caretta-vm`).catch(() => undefined));

    if (service) {
      this.store = {
        namespace: this.namespace,
        name: service.metadata.name,
        port: service.spec?.ports?.[0]?.port ?? defaultStorePort,
      };
    }

    return this.store;
  }

  async getFlows(options: FlowOptions): Promise<FlowsResponse> {
    const now = Date.now();
    const query = carettaLinksQuery(options.namespaces);
    const failed = (warning: string): FlowsResponse => ({
      source: this.name,
      timestamp: now,
      flows: [],
      warning,
      warningKind: "transient",
    });

    if (!this.namespace) {
      const detection = await this.detect();

      if (!detection.available) {
        return failed(`Caretta is not available: ${detection.message}`);
      }
    }

    const store = await this.findStore();
    let samples: PromSample[];

    try {
      samples = store ? await this.access.queryService(store, query) : await this.access.queryPrometheus(query);
    } catch (error) {
      if (error instanceof PrometheusUnavailableError) {
        return failed(
          "Caretta's metrics store (caretta-vm) was not found and no Prometheus is set up for the cluster. Reinstall Caretta with its bundled VictoriaMetrics, or set the Prometheus of the cluster in its settings.",
        );
      }

      return failed(`Failed to query the Caretta metrics: ${error instanceof Error ? error.message : String(error)}`);
    }

    const flows = samples.map(({ metric: labels, value }): TrafficFlow => {
      const port = Number.parseInt(labels.server_port ?? "", 10);

      return {
        source: carettaEndpoint(labels.client_name ?? "", labels.client_namespace ?? "", labels.client_kind),
        destination: carettaEndpoint(labels.server_name ?? "", labels.server_namespace ?? "", labels.server_kind),
        protocol: "tcp",
        port: Number.isFinite(port) ? port : 0,
        connections: Math.trunc(value) || 1,
        bytesSent: 0,
        bytesRecv: 0,
        verdict: "forwarded",
        lastSeen: now,
      };
    });

    if (flows.length === 0 && !store) {
      return {
        source: this.name,
        timestamp: now,
        flows,
        warning:
          "The Prometheus of the cluster holds no Caretta metrics, and Caretta's own metrics store (caretta-vm) was not found. Reinstall Caretta with its bundled VictoriaMetrics.",
        warningKind: "partial",
      };
    }

    return { source: this.name, timestamp: now, flows };
  }

  close() {}
}
