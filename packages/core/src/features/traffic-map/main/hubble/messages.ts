/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { decodeString, ProtobufWriter, readFields } from "./protobuf";

/**
 * The messages of the Hubble Observer API (`observer.proto` and `flow.proto` of
 * Cilium) that the client reads and writes, by their field numbers. Only the
 * fields that the traffic map uses are decoded.
 */

export interface HubbleWorkload {
  name: string;
  kind: string;
}

export interface HubbleEndpoint {
  namespace: string;
  labels: string[];
  podName: string;
  workloads: HubbleWorkload[];
}

export interface HubblePolicy {
  name: string;
  namespace: string;
  kind: string;
}

export interface HubbleLayer4 {
  protocol: "tcp" | "udp" | "icmp" | "icmpv6" | "sctp" | "";
  sourcePort: number;
  destinationPort: number;
}

export interface HubbleHttp {
  code: number;
  method: string;
  url: string;
  protocol: string;
}

export interface HubbleDns {
  query: string;
  /** The addresses of a response. */
  ips: string[];
  ttl: number;
  rcode: number;
}

export interface HubbleLayer7 {
  /** 1 REQUEST, 2 RESPONSE, 3 SAMPLE */
  type: number;
  latencyNs: number;
  http?: HubbleHttp;
  dns?: HubbleDns;
  kafka?: boolean;
}

export interface HubbleFlow {
  /** Milliseconds since the epoch, 0 when the flow carries no time. */
  timeMs: number;
  /** 1 FORWARDED, 2 DROPPED, 3 ERROR, 4 AUDIT… */
  verdict: number;
  dropReason: number;
  dropReasonDesc: number;
  sourceIp: string;
  destinationIp: string;
  /** The DNS names that Cilium knows for the source and destination addresses. */
  sourceNames: string[];
  destinationNames: string[];
  l4?: HubbleLayer4;
  source?: HubbleEndpoint;
  destination?: HubbleEndpoint;
  nodeName: string;
  l7?: HubbleLayer7;
  sourceService: string;
  destinationService: string;
  /** 1 INGRESS, 2 EGRESS */
  trafficDirection: number;
  /** The flow is a reply; undefined when the source did not say. */
  isReply?: boolean;
  allowedBy: HubblePolicy[];
  deniedBy: HubblePolicy[];
}

export type GetFlowsResponse =
  | { type: "flow"; flow: HubbleFlow; nodeName: string }
  | { type: "node-status"; state: number; nodeNames: string[] }
  | { type: "lost-events"; count: number }
  | { type: "other" };

export const hubbleVerdicts: Record<number, string> = {
  1: "forwarded",
  2: "dropped",
  3: "error",
  4: "audit",
  5: "redirected",
  6: "traced",
  7: "translated",
};

export const l7Types: Record<number, "REQUEST" | "RESPONSE" | "SAMPLE"> = {
  1: "REQUEST",
  2: "RESPONSE",
  3: "SAMPLE",
};

/** The node states of a node-status event that mean the node's flows are missing. */
export const unavailableNodeStates = new Set([2 /* NODE_UNAVAILABLE */, 4 /* NODE_ERROR */]);

/** The names of the drop reasons that a user most often meets; others are shown by number. */
const dropReasonNames: Record<number, string> = {
  132: "INVALID_SOURCE_IP",
  133: "POLICY_DENIED",
  134: "INVALID_PACKET_DROPPED",
  135: "CT_TRUNCATED_OR_INVALID_HEADER",
  136: "CT_MISSING_TCP_ACK_FLAG",
  137: "CT_UNKNOWN_L4_PROTOCOL",
  139: "UNSUPPORTED_L3_PROTOCOL",
  140: "MISSED_TAIL_CALL",
  142: "UNKNOWN_L4_PROTOCOL",
  151: "STALE_OR_UNROUTABLE_IP",
  155: "CT_MAP_INSERTION_FAILED",
  158: "SERVICE_BACKEND_NOT_FOUND",
  160: "NO_TUNNEL_OR_ENCAPSULATION_ENDPOINT",
  161: "FAILED_TO_INSERT_INTO_PROXYMAP",
  163: "UNKNOWN_CONNECTION_TRACKING_STATE",
  164: "LOCAL_HOST_IS_UNREACHABLE",
  165: "NO_CONFIGURATION_AVAILABLE_TO_PERFORM_POLICY_DECISION",
  167: "NO_MAPPING_FOR_NAT_MASQUERADE",
  169: "FIB_LOOKUP_FAILED",
  171: "INVALID_IDENTITY",
  172: "UNKNOWN_SENDER",
  176: "FORBIDDEN_ICMPV6_MESSAGE",
  177: "DENIED_BY_LB_SRC_RANGE_CHECK",
  178: "SOCKET_LOOKUP_FAILED",
  181: "POLICY_DENY",
  189: "AUTH_REQUIRED",
  194: "NO_EGRESS_GATEWAY",
  195: "UNENCRYPTED_TRAFFIC",
  196: "TTL_EXCEEDED",
  198: "DROP_RATE_LIMITED",
  202: "DROP_HOST_NOT_READY",
  203: "DROP_EP_NOT_READY",
  204: "DROP_NO_EGRESS_IP",
};

export function dropReasonName(reason: number): string {
  return dropReasonNames[reason] ?? `DROP_REASON_${reason}`;
}

function decodeTimestampMs(bytes: Uint8Array): number {
  let seconds = 0;
  let nanos = 0;

  for (const field of readFields(bytes)) {
    if (field.number === 1) seconds = field.value;
    else if (field.number === 2) nanos = field.value;
  }

  return seconds * 1000 + Math.floor(nanos / 1e6);
}

/** A google.protobuf wrapper (BoolValue, UInt32Value…): its field 1. */
function decodeWrapper(bytes: Uint8Array): number {
  let value = 0;

  for (const field of readFields(bytes)) {
    if (field.number === 1) value = field.value;
  }

  return value;
}

function decodeWorkload(bytes: Uint8Array): HubbleWorkload {
  const workload: HubbleWorkload = { name: "", kind: "" };

  for (const field of readFields(bytes)) {
    if (field.number === 1) workload.name = decodeString(field.bytes);
    else if (field.number === 2) workload.kind = decodeString(field.bytes);
  }

  return workload;
}

function decodeEndpoint(bytes: Uint8Array): HubbleEndpoint {
  const endpoint: HubbleEndpoint = { namespace: "", labels: [], podName: "", workloads: [] };

  for (const field of readFields(bytes)) {
    switch (field.number) {
      case 3:
        endpoint.namespace = decodeString(field.bytes);
        break;
      case 4:
        endpoint.labels.push(decodeString(field.bytes));
        break;
      case 5:
        endpoint.podName = decodeString(field.bytes);
        break;
      case 6:
        endpoint.workloads.push(decodeWorkload(field.bytes));
        break;
    }
  }

  return endpoint;
}

function decodePorts(bytes: Uint8Array): { sourcePort: number; destinationPort: number } {
  const ports = { sourcePort: 0, destinationPort: 0 };

  for (const field of readFields(bytes)) {
    if (field.number === 1) ports.sourcePort = field.value;
    else if (field.number === 2) ports.destinationPort = field.value;
  }

  return ports;
}

function decodeLayer4(bytes: Uint8Array): HubbleLayer4 {
  for (const field of readFields(bytes)) {
    switch (field.number) {
      case 1:
        return { protocol: "tcp", ...decodePorts(field.bytes) };
      case 2:
        return { protocol: "udp", ...decodePorts(field.bytes) };
      case 3:
        return { protocol: "icmp", sourcePort: 0, destinationPort: 0 };
      case 4:
        return { protocol: "icmpv6", sourcePort: 0, destinationPort: 0 };
      case 5:
        return { protocol: "sctp", ...decodePorts(field.bytes) };
    }
  }

  return { protocol: "", sourcePort: 0, destinationPort: 0 };
}

function decodeHttp(bytes: Uint8Array): HubbleHttp {
  const http: HubbleHttp = { code: 0, method: "", url: "", protocol: "" };

  for (const field of readFields(bytes)) {
    switch (field.number) {
      case 1:
        http.code = field.value;
        break;
      case 2:
        http.method = decodeString(field.bytes);
        break;
      case 3:
        http.url = decodeString(field.bytes);
        break;
      case 4:
        http.protocol = decodeString(field.bytes);
        break;
    }
  }

  return http;
}

function decodeDns(bytes: Uint8Array): HubbleDns {
  const dns: HubbleDns = { query: "", ips: [], ttl: 0, rcode: 0 };

  for (const field of readFields(bytes)) {
    switch (field.number) {
      case 1:
        dns.query = decodeString(field.bytes);
        break;
      case 2:
        dns.ips.push(decodeString(field.bytes));
        break;
      case 3:
        dns.ttl = field.value;
        break;
      case 6:
        dns.rcode = field.value;
        break;
    }
  }

  return dns;
}

function decodeLayer7(bytes: Uint8Array): HubbleLayer7 {
  const l7: HubbleLayer7 = { type: 0, latencyNs: 0 };

  for (const field of readFields(bytes)) {
    switch (field.number) {
      case 1:
        l7.type = field.value;
        break;
      case 2:
        l7.latencyNs = field.value;
        break;
      case 100:
        l7.dns = decodeDns(field.bytes);
        break;
      case 101:
        l7.http = decodeHttp(field.bytes);
        break;
      case 102:
        l7.kafka = true;
        break;
    }
  }

  return l7;
}

function decodeIp(bytes: Uint8Array): { source: string; destination: string } {
  const ip = { source: "", destination: "" };

  for (const field of readFields(bytes)) {
    if (field.number === 1) ip.source = decodeString(field.bytes);
    else if (field.number === 2) ip.destination = decodeString(field.bytes);
  }

  return ip;
}

function decodeServiceName(bytes: Uint8Array): string {
  for (const field of readFields(bytes)) {
    if (field.number === 1) return decodeString(field.bytes);
  }

  return "";
}

function decodePolicy(bytes: Uint8Array): HubblePolicy {
  const policy: HubblePolicy = { name: "", namespace: "", kind: "" };

  for (const field of readFields(bytes)) {
    switch (field.number) {
      case 1:
        policy.name = decodeString(field.bytes);
        break;
      case 2:
        policy.namespace = decodeString(field.bytes);
        break;
      case 5:
        policy.kind = decodeString(field.bytes);
        break;
    }
  }

  return policy;
}

export function decodeFlow(bytes: Uint8Array): HubbleFlow {
  const flow: HubbleFlow = {
    timeMs: 0,
    verdict: 0,
    dropReason: 0,
    dropReasonDesc: 0,
    sourceIp: "",
    destinationIp: "",
    sourceNames: [],
    destinationNames: [],
    nodeName: "",
    sourceService: "",
    destinationService: "",
    trafficDirection: 0,
    allowedBy: [],
    deniedBy: [],
  };
  const ingressAllowed: HubblePolicy[] = [];
  const egressAllowed: HubblePolicy[] = [];
  const ingressDenied: HubblePolicy[] = [];
  const egressDenied: HubblePolicy[] = [];

  for (const field of readFields(bytes)) {
    switch (field.number) {
      case 1:
        flow.timeMs = decodeTimestampMs(field.bytes);
        break;
      case 2:
        flow.verdict = field.value;
        break;
      case 3:
        flow.dropReason = field.value;
        break;
      case 5: {
        const ip = decodeIp(field.bytes);

        flow.sourceIp = ip.source;
        flow.destinationIp = ip.destination;
        break;
      }
      case 6:
        flow.l4 = decodeLayer4(field.bytes);
        break;
      case 8:
        flow.source = decodeEndpoint(field.bytes);
        break;
      case 9:
        flow.destination = decodeEndpoint(field.bytes);
        break;
      case 13:
        flow.sourceNames.push(decodeString(field.bytes));
        break;
      case 14:
        flow.destinationNames.push(decodeString(field.bytes));
        break;
      case 11:
        flow.nodeName = decodeString(field.bytes);
        break;
      case 15:
        flow.l7 = decodeLayer7(field.bytes);
        break;
      case 20:
        flow.sourceService = decodeServiceName(field.bytes);
        break;
      case 21:
        flow.destinationService = decodeServiceName(field.bytes);
        break;
      case 22:
        flow.trafficDirection = field.value;
        break;
      case 25:
        flow.dropReasonDesc = field.value;
        break;
      case 26:
        flow.isReply = decodeWrapper(field.bytes) === 1;
        break;
      case 21001:
        egressAllowed.push(decodePolicy(field.bytes));
        break;
      case 21002:
        ingressAllowed.push(decodePolicy(field.bytes));
        break;
      case 21004:
        egressDenied.push(decodePolicy(field.bytes));
        break;
      case 21005:
        ingressDenied.push(decodePolicy(field.bytes));
        break;
    }
  }

  flow.allowedBy = [...ingressAllowed, ...egressAllowed];
  flow.deniedBy = [...ingressDenied, ...egressDenied];

  return flow;
}

export function decodeGetFlowsResponse(bytes: Uint8Array): GetFlowsResponse {
  let flowBytes: Uint8Array | undefined;
  let nodeName = "";
  let result: GetFlowsResponse = { type: "other" };

  for (const field of readFields(bytes)) {
    switch (field.number) {
      case 1:
        flowBytes = field.bytes;
        break;
      case 2: {
        let state = 0;
        const nodeNames: string[] = [];

        for (const inner of readFields(field.bytes)) {
          if (inner.number === 1) state = inner.value;
          else if (inner.number === 2) nodeNames.push(decodeString(inner.bytes));
        }

        result = { type: "node-status", state, nodeNames };
        break;
      }
      case 3: {
        let count = 0;

        for (const inner of readFields(field.bytes)) {
          if (inner.number === 2) count = inner.value;
        }

        result = { type: "lost-events", count };
        break;
      }
      case 1000:
        nodeName = decodeString(field.bytes);
        break;
    }
  }

  if (flowBytes) {
    const flow = decodeFlow(flowBytes);

    return { type: "flow", flow, nodeName: flow.nodeName || nodeName };
  }

  return result;
}

/** The number of nodes that Hubble Relay reads, from a ServerStatusResponse; 0 when it does not say. */
export function decodeConnectedNodes(bytes: Uint8Array): number {
  for (const field of readFields(bytes)) {
    if (field.number === 5) return decodeWrapper(field.bytes);
  }

  return 0;
}

export interface FlowFilter {
  sourcePod?: string[];
  destinationPod?: string[];
  /** Event types, by their `type`. */
  eventTypes?: number[];
  sourceLabel?: string[];
  destinationLabel?: string[];
  reply?: boolean[];
}

const fieldMaskPaths = [
  "time",
  "node_name",
  "verdict",
  "drop_reason",
  "drop_reason_desc",
  "IP",
  "source_names",
  "destination_names",
  "l4",
  "l7",
  "is_reply",
  "traffic_direction",
  "source.namespace",
  "source.pod_name",
  "source.labels",
  "source.workloads",
  "destination.namespace",
  "destination.pod_name",
  "destination.labels",
  "destination.workloads",
  "source_service.name",
  "destination_service.name",
  "ingress_allowed_by",
  "egress_allowed_by",
  "ingress_denied_by",
  "egress_denied_by",
];

function writeFilter(writer: ProtobufWriter, filter: FlowFilter) {
  filter.sourcePod?.forEach((pod) => writer.string(2, pod));
  filter.destinationPod?.forEach((pod) => writer.string(4, pod));
  filter.eventTypes?.forEach((type) => writer.message(6, (event) => event.uint(1, type)));
  filter.sourceLabel?.forEach((label) => writer.string(10, label));
  filter.destinationLabel?.forEach((label) => writer.string(11, label));
  filter.reply?.forEach((reply) => writer.bool(15, reply));
}

export interface GetFlowsRequest {
  number: number;
  whitelist: FlowFilter[];
  blacklist: FlowFilter[];
}

export function encodeGetFlowsRequest(request: GetFlowsRequest): Uint8Array {
  const writer = new ProtobufWriter().uint(1, request.number);

  request.blacklist.forEach((filter) => writer.message(5, (inner) => writeFilter(inner, filter)));
  request.whitelist.forEach((filter) => writer.message(6, (inner) => writeFilter(inner, filter)));
  writer.message(10, (mask) => fieldMaskPaths.forEach((path) => mask.string(1, path)));

  return writer.finish();
}
