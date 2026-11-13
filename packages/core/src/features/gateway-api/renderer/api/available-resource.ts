/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import type { KubeApi } from "@freelensapp/kube-api";
import type { KubeObject } from "@freelensapp/kube-object";

import type { KubeObjectStore } from "../../../../common/k8s-api/kube-object.store";
import type { GatewayKubeObjectCRD } from "./k8s/types";

/** The model class of one kind of the Gateway API in one API version. */
export type GatewayApiResource = (new (
  ...args: any[]
) => KubeObject) & {
  readonly kind: string;
  readonly namespaced: boolean;
  readonly apiBase: string;
  readonly crd: GatewayKubeObjectCRD;
};

/**
 * What the Gateway API pages read of the registry of APIs and stores, which the
 * `apiManager` of the cluster frame implements. It registers an API and a store
 * for every served version of every custom resource definition, and it is
 * observable, so a component that reads it is an `observer`.
 */
export interface GatewayApiRegistry {
  getApi(callback: (api: KubeApi<KubeObject>) => boolean): KubeApi<KubeObject> | undefined;
  getApiByKind(kind: string, apiVersion: string): KubeApi<KubeObject> | undefined;
  getStore(api: KubeApi<KubeObject>): KubeObjectStore<KubeObject> | undefined;
}

/**
 * The store of a model class: the store of the first of its `crd.apiVersions`
 * the cluster serves, or `undefined` when it serves none of them.
 *
 * The objects in the store are plain `KubeObject`s, not instances of the model
 * class, so only the methods of `KubeObject` can be called on them.
 */
export function getAvailableStore(
  registry: GatewayApiRegistry,
  resource: GatewayApiResource,
): KubeObjectStore<KubeObject> | undefined {
  for (const apiVersion of resource.crd.apiVersions) {
    const api = registry.getApiByKind(resource.kind, apiVersion);
    const store = api && registry.getStore(api);

    if (store) {
      return store;
    }
  }

  return undefined;
}

/**
 * The first version of a kind that has a store, with the store. The registry
 * has a store for every served version, so a kind served in two versions is
 * taken from the first of `versions` only.
 */
export function getAvailableResource<T extends GatewayApiResource>(
  registry: GatewayApiRegistry,
  versions: readonly T[],
): { resource: T; store: KubeObjectStore<KubeObject> } | undefined {
  for (const resource of versions) {
    const store = getAvailableStore(registry, resource);

    if (store) {
      return { resource, store };
    }
  }

  return undefined;
}
