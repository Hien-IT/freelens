/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { dropReasonName, hubbleVerdicts, l7Types } from "./messages";

import type { FlowVerdict, PolicyRef, TrafficEndpoint, TrafficFlow } from "../../common/types";
import type { HubbleEndpoint, HubbleFlow, HubblePolicy } from "./messages";

const hostIdentities = new Map([
  ["reserved:host", "host"],
  ["reserved:remote-node", "remote-node"],
  ["reserved:kube-apiserver", "kube-apiserver"],
]);
const worldIdentities = new Set(["reserved:world", "reserved:world-ipv4", "reserved:world-ipv6"]);

/** What a non-pod endpoint is, from its identity labels. Node evidence wins over a CIDR label. */
function classifyNonPod(labels: readonly string[], ip: string): Pick<TrafficEndpoint, "kind" | "name"> {
  let external = false;
  let reserved: string | undefined;

  for (const label of labels) {
    const host = hostIdentities.get(label);

    if (host) {
      return { kind: "Host", name: host };
    }

    if (worldIdentities.has(label) || label.startsWith("cidr:")) {
      external = true;
    } else if (label.startsWith("reserved:") && reserved === undefined) {
      reserved = label.slice("reserved:".length);
    }
  }

  if (external) {
    return { kind: "External", name: "world" };
  }

  if (reserved !== undefined) {
    return { kind: "Unknown", name: reserved };
  }

  return { kind: "Unknown", name: ip || "unknown" };
}

function convertEndpoint(endpoint: HubbleEndpoint | undefined, ip: string, names: readonly string[]): TrafficEndpoint {
  if (!endpoint) {
    return { kind: "Unknown", name: ip || "unknown", namespace: "", ip: ip || undefined };
  }

  const converted: TrafficEndpoint = endpoint.podName
    ? { kind: "Pod", name: endpoint.podName, namespace: endpoint.namespace }
    : { ...classifyNonPod(endpoint.labels, ip), namespace: endpoint.namespace };

  if (converted.kind !== "Pod" && names.length > 0) {
    converted.names = [...names];
  }

  if (ip) {
    converted.ip = ip;
  }

  const [workload] = endpoint.workloads;

  if (converted.kind === "Pod" && workload?.name) {
    converted.workload = workload.name;
    converted.workloadKind = workload.kind || undefined;

    // An Argo Rollout runs its pods through ReplicaSets that Hubble names as
    // the workload; the template hash label tells the Rollout's name.
    const hash = endpoint.labels
      .find((label) => label.startsWith("k8s:rollouts-pod-template-hash="))
      ?.slice("k8s:rollouts-pod-template-hash=".length);

    if (workload.kind === "ReplicaSet" && hash && workload.name.endsWith(`-${hash}`)) {
      converted.workload = workload.name.slice(0, -hash.length - 1);
      converted.workloadKind = "Rollout";
    }
  }

  return converted;
}

function policyRefs(policies: readonly HubblePolicy[]): PolicyRef[] {
  return policies
    .filter((policy) => policy.name)
    .map((policy) => ({ kind: policy.kind, name: policy.name, namespace: policy.namespace || undefined }));
}

/**
 * The flow as the traffic map reads it, or undefined for a flow it leaves out.
 *
 * A reply is drawn on its caller's edge: an L7 reply (a response) is turned
 * around, with the port of the server as its port. A reply without L7 adds
 * nothing that the request did not, and is left out.
 */
export function convertHubbleFlow(flow: HubbleFlow, nowMs: number): TrafficFlow | undefined {
  if (flow.isReply && !flow.l7) {
    return undefined;
  }

  const verdict = (hubbleVerdicts[flow.verdict] ?? "") as FlowVerdict;
  const converted: TrafficFlow = {
    source: convertEndpoint(flow.source, flow.sourceIp, flow.sourceNames),
    destination: convertEndpoint(flow.destination, flow.destinationIp, flow.destinationNames),
    protocol: flow.l4?.protocol ?? "",
    port: flow.l4?.destinationPort ?? 0,
    bytesSent: 0,
    bytesRecv: 0,
    connections: 1,
    verdict,
    lastSeen: flow.timeMs || nowMs,
  };

  if (flow.l7) {
    const { l7 } = flow;

    converted.l7Type = l7Types[l7.type];

    if (l7.latencyNs > 0) {
      converted.latencyMs = l7.latencyNs / 1e6;
    }

    if (l7.http) {
      converted.l7Protocol = "HTTP";
      converted.httpMethod = l7.http.method || undefined;
      converted.httpPath = l7.http.url || undefined;
      converted.httpStatus = l7.http.code || undefined;
    } else if (l7.dns) {
      converted.l7Protocol = "DNS";
      converted.dnsQuery = l7.dns.query || undefined;
      converted.dnsRCode = l7.dns.rcode;
      converted.dnsTtl = l7.dns.ttl || undefined;
      converted.dnsIps = l7.dns.ips.length ? l7.dns.ips : undefined;
    } else if (l7.kafka) {
      converted.l7Protocol = "Kafka";
    }
  }

  if (verdict === "dropped") {
    const reason = flow.dropReasonDesc || flow.dropReason;

    if (reason) {
      converted.dropReason = dropReasonName(reason);
    }
  }

  const allowedBy = policyRefs(flow.allowedBy);
  const deniedBy = policyRefs(flow.deniedBy);

  if (allowedBy.length || deniedBy.length) {
    converted.policyVerdict = {
      allowedBy: allowedBy.length ? allowedBy : undefined,
      deniedBy: deniedBy.length ? deniedBy : undefined,
    };
  }

  if (flow.isReply) {
    return {
      ...converted,
      source: converted.destination,
      destination: converted.source,
      port: flow.l4?.sourcePort ?? 0,
      connections: 0,
    };
  }

  return converted;
}

/**
 * Names the outside addresses that Hubble gave no DNS name for, from the DNS
 * answers of the same flows: a pod that resolved `api.example.com` to an
 * address and then connected to it was talking to `api.example.com`.
 */
export function nameExternalAddresses(flows: TrafficFlow[]): void {
  const names = new Map<string, Set<string>>();

  for (const flow of flows) {
    if (!flow.dnsQuery || !flow.dnsIps) continue;

    const query = flow.dnsQuery.replace(/\.$/, "");

    for (const ip of flow.dnsIps) {
      let set = names.get(ip);

      if (!set) {
        set = new Set();
        names.set(ip, set);
      }

      set.add(query);
    }
  }

  if (names.size === 0) return;

  for (const flow of flows) {
    for (const endpoint of [flow.source, flow.destination]) {
      if (endpoint.kind === "External" && !endpoint.names?.length && endpoint.ip) {
        const known = names.get(endpoint.ip);

        if (known) {
          endpoint.names = [...known];
        }
      }
    }
  }
}
