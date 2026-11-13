/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { KubeObject } from "@freelensapp/kube-object";
import { observable, runInAction } from "mobx";

import type { KubeApi } from "@freelensapp/kube-api";

import type { KubeObjectStore } from "../../../../common/k8s-api/kube-object.store";
import type { GatewayApiRegistry, GatewayApiResource } from "../api/available-resource";

export interface RegisteredApi {
  apiGroup: string;
  kind: string;
  apiVersionWithGroup: string;
}

/**
 * A registry of APIs and stores that serves nothing until a test serves a
 * version or registers an API. It is observable, as the `apiManager` is.
 */
export function createFakeRegistry() {
  const served = observable.map<string, KubeObjectStore<KubeObject>>({}, { deep: false });
  const apis = observable.array<RegisteredApi>([], { deep: false });
  const keyOf = (kind: string, apiVersion: string) => `${kind} ${apiVersion}`;

  const registry: GatewayApiRegistry = {
    getApi: (callback) => apis.find((api) => callback(api as unknown as KubeApi<KubeObject>)) as KubeApi<KubeObject>,
    getApiByKind: (kind, apiVersion) =>
      served.has(keyOf(kind, apiVersion))
        ? ({ kind, apiVersionWithGroup: apiVersion } as unknown as KubeApi<KubeObject>)
        : undefined,
    getStore: (api) => served.get(keyOf(api.kind, api.apiVersionWithGroup)),
  };

  return {
    registry,

    /** Serves a version of a model class, by default its first, with a store of its own, which it returns. */
    serve(resource: GatewayApiResource, apiVersion = resource.crd.apiVersions[0]) {
      const store = { apiVersion } as unknown as KubeObjectStore<KubeObject>;

      runInAction(() => served.set(keyOf(resource.kind, apiVersion), store));

      return store;
    },

    /** Registers an API that `getApi` finds. */
    register(...registered: RegisteredApi[]) {
      runInAction(() => apis.push(...registered));
    },
  };
}

/** A model class of a kind that is not of the Gateway API, for the tests of version selection. */
export const createRouteClass = (apiVersion: string) =>
  class Route extends KubeObject {
    static readonly kind = "Route";
    static readonly namespaced = true;
    static readonly apiBase = `/apis/${apiVersion}/routes`;
    static readonly crd = {
      apiVersions: [apiVersion],
      plural: "routes",
      singular: "route",
      title: "Routes",
    };
  };
