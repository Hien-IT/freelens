/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import type { ClusterId } from "../../../common/cluster-types";

/**
 * What an endpoint of a flow is. Only a pod carries a namespace and labels; the
 * others say what kind of non-pod the source identified.
 */
export type EndpointKind = "Pod" | "Workload" | "Service" | "External" | "Host" | "Unknown";

export interface TrafficEndpoint {
  /** The pod, workload or service name, or a label for a non-pod endpoint. */
  name: string;
  namespace: string;
  kind: EndpointKind;
  ip?: string;
  /** The workload that owns the pod, when it is known. */
  workload?: string;
  /** The kind of that workload: Deployment, StatefulSet, DaemonSet, CronJob, Job… */
  workloadKind?: string;
}

/** The policies that the network plugin reports as having allowed or denied a flow. */
export interface PolicyVerdict {
  allowedBy?: PolicyRef[];
  deniedBy?: PolicyRef[];
}

export interface PolicyRef {
  kind: string;
  namespace?: string;
  name: string;
}

export type FlowVerdict = "forwarded" | "dropped" | "error" | "audit" | "";

/**
 * One flow between two endpoints, as a source reports it: a single record for a
 * source that reads flows (Hubble), or a rate over the window for one that reads
 * metrics (Istio, Caretta, Beyla).
 */
export interface TrafficFlow {
  source: TrafficEndpoint;
  destination: TrafficEndpoint;
  /** tcp, udp, icmp, sctp */
  protocol: string;
  /** The destination port, 0 when the source reports none. */
  port: number;
  /** HTTP, gRPC, DNS, Kafka… when the source sees the application protocol. */
  l7Protocol?: string;
  httpMethod?: string;
  httpPath?: string;
  httpStatus?: number;
  /** The latency of a response, or the average latency a metric-based source measured. */
  latencyMs?: number;
  /** REQUEST, RESPONSE or SAMPLE for a source that reports L7 records. */
  l7Type?: "REQUEST" | "RESPONSE" | "SAMPLE";
  dnsQuery?: string;
  dnsRCode?: number;
  dnsTtl?: number;
  dropReason?: string;
  bytesSent: number;
  bytesRecv: number;
  connections: number;
  /**
   * The initiator of the conversation could not be established, so the two
   * endpoints are ordered arbitrarily. The graph draws it without an arrowhead.
   */
  directionUnknown?: boolean;
  verdict: FlowVerdict;
  policyVerdict?: PolicyVerdict;
  /** Milliseconds since the epoch. */
  lastSeen: number;
  /** Requests per second, for a metric-based source. */
  requestRate?: number;
  /** 5xx responses per second, for a metric-based source. */
  errorRate?: number;
}

export interface HttpPathStat {
  method: string;
  path: string;
  count: number;
  avgMs?: number;
  /** The share of the responses with a 4xx or 5xx status, in percent. */
  errorPct?: number;
}

export interface DnsQueryStat {
  query: string;
  count: number;
  nxCount?: number;
  avgTtl?: number;
}

/** The flows between two endpoints on one port, summed. */
export interface AggregatedFlow {
  source: TrafficEndpoint;
  destination: TrafficEndpoint;
  protocol: string;
  port: number;
  flowCount: number;
  bytesSent: number;
  bytesRecv: number;
  connections: number;
  lastSeen: number;
  directionUnknown?: boolean;
  l7Protocol?: string;
  /** Requests: the rounded rate of a metric-based source, floored at one. */
  requestCount?: number;
  errorCount?: number;
  /** The unrounded per-second rates of a metric-based source. */
  requestRate?: number;
  errorRate?: number;
  avgLatencyMs?: number;
  latencyP50Ms?: number;
  latencyP95Ms?: number;
  latencyP99Ms?: number;
  /** "2xx" → count */
  httpStatusCounts?: Record<string, number>;
  topHttpPaths?: HttpPathStat[];
  topDnsQueries?: DnsQueryStat[];
  /** "forwarded" → count */
  verdictCounts?: Record<string, number>;
  dropReasons?: Record<string, number>;
}

/**
 * How a warning of a flows response behaves:
 *
 * - `transient`: it may resolve on its own (a failed query, a port-forward still starting); a retry is worthwhile.
 * - `incomplete`: the read succeeded but could not see everything; flows may be missing.
 * - `partial`: the flows are right, but some of their values are missing.
 */
export type WarningKind = "transient" | "incomplete" | "partial";

export interface FlowsResponse {
  /** The source that answered. */
  source: TrafficSourceName;
  /** Milliseconds since the epoch. */
  timestamp: number;
  flows: TrafficFlow[];
  warning?: string;
  warningKind?: WarningKind;
  /**
   * When the flows start being complete, set when a source read only its newest
   * records and the oldest part of the window did not fit.
   */
  coveredSince?: number;
}

/** The flows of a window as the traffic map receives them. */
export interface TrafficFlowsResult extends FlowsResponse {
  /** Every flow of the window, summed per pair of endpoints and port. */
  aggregated: AggregatedFlow[];
  /** How many flows the source returned; `flows` holds the newest of them. */
  flowsTotal: number;
}

export type TrafficSourceName = "hubble" | "istio" | "caretta" | "beyla";

export const trafficSourceNames: readonly TrafficSourceName[] = ["hubble", "istio", "caretta", "beyla"];

export const trafficSourceTitles: Record<TrafficSourceName, string> = {
  hubble: "Hubble (Cilium)",
  istio: "Istio",
  caretta: "Caretta",
  beyla: "Grafana Beyla",
};

export interface DetectionResult {
  available: boolean;
  version?: string;
  /** Built into the cluster, such as Hubble in GKE Dataplane V2. */
  native?: boolean;
  message?: string;
  /**
   * Found in the cluster but not usable as it stands: misconfigured, or not
   * scraped. Only meaningful when `available` is false.
   */
  present?: boolean;
}

export interface SourceStatus {
  name: TrafficSourceName;
  status: "available" | "present" | "not_found" | "error";
  version?: string;
  native?: boolean;
  message?: string;
}

export interface ClusterInfo {
  /** gke, eks, aks, openshift, rke2, rancher, nutanix, minikube, kind, docker-desktop, generic */
  platform: string;
  /** cilium, calico, flannel, canal, vpc-cni, azure-cni, gke-native, unknown… */
  cni: string;
  /** GKE: Dataplane V2, which is Cilium with Hubble built in. */
  dataplaneV2: boolean;
}

export interface HelmChartInfo {
  repo: string;
  repoUrl: string;
  chartName: string;
  version?: string;
  /** Values to install the chart with, as YAML. */
  values?: string;
}

export interface Recommendation {
  name: TrafficSourceName;
  reason: string;
  /** A command to run, for a source that is not installed with Helm. */
  installCommand?: string;
  docsUrl: string;
  helmChart?: HelmChartInfo;
  alternativeName?: TrafficSourceName;
  alternativeReason?: string;
  alternativeDocsUrl?: string;
}

export interface SourcesResponse {
  cluster: ClusterInfo;
  /** The source that answers flow requests, if any is available. */
  active?: TrafficSourceName;
  detected: SourceStatus[];
  recommended?: Recommendation;
}

export interface TrafficFlowsQuery {
  /** Keep flows with either endpoint in one of these namespaces; empty or missing for all. */
  namespaces?: string[];
  /** The window to read, in seconds. */
  sinceSeconds: number;
  /** Draw pods rather than the workloads that own them. */
  groupByPod?: boolean;
}

export type TrafficRequest =
  | { clusterId: ClusterId; type: "sources"; refresh?: boolean }
  | { clusterId: ClusterId; type: "flows"; query: TrafficFlowsQuery }
  | { clusterId: ClusterId; type: "set-source"; source: TrafficSourceName };

export type TrafficResponse<T> = { callWasSuccessful: true; response: T } | { callWasSuccessful: false; error: string };

export interface TrafficResultData {
  sources: SourcesResponse;
  flows: TrafficFlowsResult;
  "set-source": SourcesResponse;
}
