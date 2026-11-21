/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Stand-ins for the models in unit tests: plain objects with the kind, the
// metadata and the methods that the maps call, typed as the real models. They
// are no instances of the model classes: the tooltip of the map is the default one for each.
import type { Deployment, KubeObject, Pod, Secret } from "@freelensapp/kube-object";

export interface Metadata {
  name: string;
  namespace: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

// The labels as KubeObject.stringifyLabels gives them, "key=value".
const stringify = (labels: Record<string, string> = {}) =>
  Object.entries(labels).map(([key, value]) => `${key}=${value}`);

/** An object of `kind`, with the members the maps read added to it. */
export function kubeObject<T extends KubeObject>(kind: string, metadata: Metadata, members: object = {}): T {
  return {
    kind,
    metadata,
    getName: () => metadata.name,
    getNs: () => metadata.namespace,
    // The uid of the real objects: one per object, the same in every instance of it.
    getId: () => `${kind}/${metadata.namespace}/${metadata.name}`,
    getLabels: () => stringify(metadata.labels),
    ...members,
  } as T;
}

/**
 * The state of a fake pod: a phase of the model, or a running pod that is
 * crash-looping, not ready, or being deleted, or an evicted one.
 */
export type FakePodStatus =
  | "Running"
  | "Pending"
  | "Succeeded"
  | "Failed"
  | "Unknown"
  | "CrashLoopBackOff"
  | "NotReady"
  | "Terminating"
  | "Evicted";

export interface PodSpec {
  /** `Running` by default. */
  status?: FakePodStatus;
  labels?: Record<string, string>;
  /** The kind and name of its owner, such as a StatefulSet, whose uid is the one `kubeObject` gives it. */
  owner?: { kind: string; name: string };
  containers?: unknown[];
  volumes?: { name: string; secret?: { secretName?: string }; [source: string]: unknown }[];
}

const phaseOf: Record<FakePodStatus, string> = {
  Running: "Running",
  Pending: "Pending",
  Succeeded: "Succeeded",
  Failed: "Failed",
  Unknown: "Unknown",
  CrashLoopBackOff: "Running",
  NotReady: "Running",
  Terminating: "Running",
  Evicted: "Failed",
};

/**
 * A pod; like the real one, it takes the names of its secrets from its secret
 * volumes. Its phase, reason, container states, deletion and `hasIssues()`
 * follow its `status` as the model's would.
 */
export function pod(name: string, namespace: string, spec: PodSpec = {}) {
  const volumes = spec.volumes ?? [];
  const status = spec.status ?? "Running";
  const metadata = {
    name,
    namespace,
    labels: spec.labels,
    ...(status === "Terminating" ? { deletionTimestamp: "2026-01-01T00:00:00Z" } : {}),
  };
  return kubeObject<Pod>("Pod", metadata, {
    getStatusMessage: () => (status === "Evicted" || status === "Terminating" ? status : phaseOf[status]),
    getStatusPhase: () => phaseOf[status],
    getReason: () => (status === "Evicted" ? "Evicted" : ""),
    getContainerStatuses: () => [
      {
        name,
        ready: status === "Running" || status === "Terminating",
        state: status === "CrashLoopBackOff" ? { waiting: { reason: "CrashLoopBackOff" } } : { running: {} },
      },
    ],
    hasIssues: () => !["Running", "Succeeded", "Terminating"].includes(status),
    getContainers: () => spec.containers ?? [],
    getVolumes: () => volumes,
    getSecrets: () => volumes.flatMap((volume) => (volume.secret?.secretName ? [volume.secret.secretName] : [])),
    getOwnerRefs: () =>
      spec.owner ? [{ ...spec.owner, namespace, uid: `${spec.owner.kind}/${namespace}/${spec.owner.name}` }] : [],
  });
}

/**
 * A Deployment, whose selectors are its `matchLabels`, as
 * `getSelectors()` gives them, and the labels of whose pod template are the
 * same, as `getTemplateLabels()` gives them.
 */
export function deployment(name: string, namespace: string, matchLabels?: Record<string, string>) {
  return kubeObject<Deployment>(
    "Deployment",
    { name, namespace },
    {
      spec: { selector: { matchLabels } },
      getSelectors: () => stringify(matchLabels),
      getTemplateLabels: () => stringify(matchLabels),
    },
  );
}

export function secret(name: string, namespace: string, type = "Opaque", labels?: Record<string, string>) {
  return kubeObject<Secret>("Secret", { name, namespace, labels }, { type });
}
