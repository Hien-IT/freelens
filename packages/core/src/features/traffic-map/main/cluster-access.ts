/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

/** One series of an instant PromQL query: its labels and its value. */
export interface PromSample {
  metric: Record<string, string>;
  value: number;
}

export interface PortForwardHandle {
  /** The local port that forwards to the target. */
  readonly localPort: number;
  /** Whether the forward is still running. */
  isAlive(): boolean;
  stop(): void;
}

export interface ServiceTarget {
  namespace: string;
  name: string;
  port: number;
}

/** Prometheus is not found or not set up for the cluster. */
export class PrometheusUnavailableError extends Error {}

/**
 * What the traffic sources use of a cluster. The sources take it rather than
 * the application's injectables, so that a test runs them against fakes.
 */
export interface ClusterAccess {
  /** The items of a Kubernetes list, such as `/api/v1/namespaces/kube-system/services`. */
  list<T = KubeObjectJson>(path: string): Promise<T[]>;
  /** A Kubernetes object, or undefined when it does not exist. */
  get<T = KubeObjectJson>(path: string): Promise<T | undefined>;
  /**
   * Runs an instant PromQL query on the Prometheus of the cluster, as the
   * cluster's settings or the detection name it. Throws
   * `PrometheusUnavailableError` when there is none.
   */
  queryPrometheus(query: string): Promise<PromSample[]>;
  /**
   * Runs an instant PromQL query on a Prometheus-compatible service of the
   * cluster, such as the VictoriaMetrics that Caretta installs, through the
   * service proxy of the API server.
   */
  queryService(target: ServiceTarget, query: string): Promise<PromSample[]>;
  /** Forwards a local port to the port of a service, through kubectl. */
  portForward(namespace: string, service: string, port: number): Promise<PortForwardHandle>;
}

/** The parts of a Kubernetes object that the sources read. */
export interface KubeObjectJson {
  metadata: {
    name: string;
    namespace?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    ownerReferences?: { kind: string; name: string; controller?: boolean }[];
  };
  spec?: any;
  status?: any;
  data?: Record<string, string>;
}

/** Whether a request failed with a status of the API server, such as 404 or 403. */
export function requestStatusOf(error: unknown): number | undefined {
  const status = (error as { statusCode?: unknown } | undefined)?.statusCode;

  return typeof status === "number" ? status : undefined;
}
