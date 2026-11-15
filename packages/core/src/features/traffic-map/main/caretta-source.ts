/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { PrometheusUnavailableError } from "./cluster-access";
import { promAlternatives, promWindow } from "./source";

import type { DetectionResult, FlowsResponse, TrafficEndpoint, TrafficFlow } from "../common/types";
import type { ClusterAccess, KubeObjectJson, PromSample, ServiceTarget } from "./cluster-access";
import type { FlowOptions, TrafficSource } from "./source";

const podSelector = "app.kubernetes.io/name=caretta";
const metric = "caretta_links_observed";
const storeSelector = "app.kubernetes.io/name=victoria-metrics-single";
const defaultStorePort = 8428;

/** The labels of a link, without the side (`role`) that observed it. */
const linkLabels = [
  "client_name",
  "client_namespace",
  "client_kind",
  "server_name",
  "server_namespace",
  "server_kind",
  "server_port",
];

/**
 * The bytes that each link carried in the window. `caretta_links_observed`
 * holds the bytes a link has sent since Caretta started, so its increase over
 * the window is the window's traffic, and a link that carried none in it, such
 * as one that closed long ago, is left out.
 */
export function carettaLinksQuery(namespaces: readonly string[], window: string): string {
  const sum = (selector: string) =>
    `(sum by (${linkLabels.join(", ")}, role) (increase(${metric}${selector}[${window}])) > 0)`;

  if (namespaces.length === 0) {
    return sum("");
  }

  const pattern = promAlternatives(namespaces);

  return `${sum(`{client_namespace=~"${pattern}"}`)} or ${sum(`{server_namespace=~"${pattern}"}`)}`;
}

/** An IPv4 or IPv6 address, rather than the DNS name Caretta resolved it to. */
const ipAddress = /^(\d{1,3}(\.\d{1,3}){3}|[0-9a-f:]+:[0-9a-f:.]*)$/i;

/**
 * An endpoint as Caretta names it: an address outside the cluster in the
 * namespace `external`, by its reverse DNS name or its address; a node in the
 * namespace `node`; a pod without controller as `pod`; and any other pod by
 * the workload that owns it, with that workload's kind.
 */
export function carettaEndpoint(name: string, namespace: string, kind: string | undefined): TrafficEndpoint {
  const lowerKind = kind?.toLowerCase();

  if (namespace === "external" || lowerKind === "external" || (!namespace && name)) {
    return ipAddress.test(name)
      ? { name, namespace: "", kind: "External", ip: name }
      : { name, namespace: "", kind: "External", names: [name] };
  }

  if (namespace === "node" || lowerKind === "node") {
    return { name, namespace: "", kind: "Host" };
  }

  if (!kind || lowerKind === "pod") {
    return { name, namespace, kind: "Pod" };
  }

  if (lowerKind === "service") {
    return { name, namespace, kind: "Service" };
  }

  return { name, namespace, kind: "Workload", workload: name, workloadKind: kind };
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
    const query = carettaLinksQuery(options.namespaces, promWindow(options.sinceSeconds));
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

    // Both ends of a link inside the cluster report it, the client and the
    // server: keep the larger of the two rather than counting it twice.
    const links = new Map<string, PromSample>();

    for (const sample of samples) {
      const key = linkLabels.map((label) => sample.metric[label] ?? "").join("|");
      const existing = links.get(key);

      if (!existing || sample.value > existing.value) {
        links.set(key, sample);
      }
    }

    const flows = [...links.values()].map(({ metric: labels, value }): TrafficFlow => {
      const port = Number.parseInt(labels.server_port ?? "", 10);

      return {
        source: carettaEndpoint(labels.client_name ?? "", labels.client_namespace ?? "", labels.client_kind),
        destination: carettaEndpoint(labels.server_name ?? "", labels.server_namespace ?? "", labels.server_kind),
        protocol: "tcp",
        port: Number.isFinite(port) ? port : 0,
        connections: 0,
        bytesSent: Math.round(value),
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
