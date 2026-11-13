/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { KubeObject } from "@freelensapp/kube-object";

/** The kind of the objects that stand for Helm releases on the maps. */
export const helmReleaseKind = "HelmRelease";

/**
 * The name of the Helm release that manages an object, from the `heritage` and
 * `release` labels that older charts set, or from the
 * `app.kubernetes.io/managed-by` label and the `meta.helm.sh/release-name`
 * annotation that Helm 3 sets.
 */
export function getHelmReleaseName(object: KubeObject): string | undefined {
  const labels = object.metadata?.labels;
  const annotations = object.metadata?.annotations;
  if (labels?.heritage === "Helm" && labels.release) {
    return labels.release;
  }
  if (labels?.["app.kubernetes.io/managed-by"] === "Helm" && annotations?.["meta.helm.sh/release-name"]) {
    return annotations["meta.helm.sh/release-name"];
  }
  return undefined;
}

/**
 * An object that stands for a Helm release, which has no object of its own in
 * the cluster. Its `uid` is empty, so nothing may be keyed on its `getId()`.
 */
export function createHelmReleaseObject(name: string, namespace: string): KubeObject {
  return new KubeObject({
    apiVersion: "v1",
    kind: helmReleaseKind,
    metadata: {
      uid: "",
      namespace,
      name,
      resourceVersion: "1",
      selfLink: `api/v1/helmreleases/${name}`,
    },
  });
}
