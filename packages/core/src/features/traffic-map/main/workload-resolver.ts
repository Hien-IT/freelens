/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import type { TrafficEndpoint, TrafficFlow } from "../common/types";
import type { ClusterAccess, KubeObjectJson } from "./cluster-access";

/** How long the owners read for a namespace answer for it. */
const maxAgeMs = 60_000;

interface Owner {
  kind: string;
  name: string;
}

interface NamespaceOwners {
  /** The workload of each pod, or null for a pod that has none, such as a static pod. */
  pods: Map<string, Owner | null>;
}

function controllerOf(object: KubeObjectJson): Owner | undefined {
  const reference = object.metadata.ownerReferences?.find((owner) => owner.controller);

  return reference ? { kind: reference.kind, name: reference.name } : undefined;
}

/**
 * The workload that runs a pod: the Deployment (or Argo Rollout) above its
 * ReplicaSet, the CronJob above its Job, or the controller that owns it
 * directly, such as a StatefulSet or a DaemonSet.
 */
export function workloadOfPod(
  pod: KubeObjectJson,
  replicaSets: ReadonlyMap<string, KubeObjectJson>,
  jobs: ReadonlyMap<string, KubeObjectJson>,
): Owner | null {
  const owner = controllerOf(pod);

  if (!owner || owner.kind === "Node") {
    return null;
  }

  if (owner.kind === "ReplicaSet") {
    const replicaSet = replicaSets.get(owner.name);

    return (replicaSet && controllerOf(replicaSet)) ?? owner;
  }

  if (owner.kind === "Job") {
    const job = jobs.get(owner.name);

    return (job && controllerOf(job)) ?? owner;
  }

  return owner;
}

/**
 * Names the workload of each pod endpoint that a source could not, from the
 * owners of the pods in the cluster, so a pod is drawn as its workload. A
 * source such as Hubble names the workload of most pods itself, but not of
 * all of them.
 */
export class WorkloadResolver {
  private readonly namespaces = new Map<string, Promise<NamespaceOwners | undefined>>();
  private readonly readAt = new Map<string, number>();

  constructor(private readonly access: ClusterAccess) {}

  private owners(namespace: string): Promise<NamespaceOwners | undefined> {
    const now = Date.now();
    const cached = this.namespaces.get(namespace);

    if (cached && now - (this.readAt.get(namespace) ?? 0) < maxAgeMs) {
      return cached;
    }

    const encoded = encodeURIComponent(namespace);
    const read = (async (): Promise<NamespaceOwners | undefined> => {
      try {
        const [pods, replicaSets, jobs] = await Promise.all([
          this.access.list(`/api/v1/namespaces/${encoded}/pods`),
          this.access.list(`/apis/apps/v1/namespaces/${encoded}/replicasets`).catch(() => []),
          this.access.list(`/apis/batch/v1/namespaces/${encoded}/jobs`).catch(() => []),
        ]);
        const byName = (objects: KubeObjectJson[]) => new Map(objects.map((object) => [object.metadata.name, object]));
        const replicaSetsByName = byName(replicaSets);
        const jobsByName = byName(jobs);

        return {
          pods: new Map(pods.map((pod) => [pod.metadata.name, workloadOfPod(pod, replicaSetsByName, jobsByName)])),
        };
      } catch {
        // Without the right to list the pods of the namespace, the pods keep what the source said.
        return undefined;
      }
    })();

    this.namespaces.set(namespace, read);
    this.readAt.set(namespace, now);

    return read;
  }

  /**
   * Whether the endpoint is a pod whose workload the source did not name, or
   * named as the ReplicaSet or Job in between rather than what runs it.
   */
  private static needsWorkload(endpoint: TrafficEndpoint): boolean {
    return (
      endpoint.kind === "Pod" &&
      Boolean(endpoint.namespace) &&
      (!endpoint.workload || endpoint.workloadKind === "ReplicaSet" || endpoint.workloadKind === "Job")
    );
  }

  /** Sets the workload of the pod endpoints of the flows that need one, in place. */
  async resolve(flows: readonly TrafficFlow[]): Promise<void> {
    const namespaces = new Set<string>();

    for (const flow of flows) {
      for (const endpoint of [flow.source, flow.destination]) {
        if (WorkloadResolver.needsWorkload(endpoint)) {
          namespaces.add(endpoint.namespace);
        }
      }
    }

    if (namespaces.size === 0) {
      return;
    }

    const owners = new Map(
      await Promise.all([...namespaces].map(async (namespace) => [namespace, await this.owners(namespace)] as const)),
    );

    for (const flow of flows) {
      for (const endpoint of [flow.source, flow.destination]) {
        if (!WorkloadResolver.needsWorkload(endpoint)) continue;

        const owner = owners.get(endpoint.namespace)?.pods.get(endpoint.name);

        if (owner) {
          endpoint.workload = owner.name;
          endpoint.workloadKind = owner.kind;
        }
      }
    }
  }
}
