/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { KubeObject, type KubeObjectMetadata } from "@freelensapp/kube-object";
import { type BackendRef, type CommonRouteSpec, type GatewayKubeObjectCRD, type RouteStatus } from "./types";

export interface TLSRouteRule {
  name?: string;
  backendRefs: BackendRef[];
}

export interface TLSRouteSpec extends CommonRouteSpec {
  /** required by v1, but v1alpha2 serves the same objects and does not require it; unset: any hostname */
  hostnames?: string[];
  rules: TLSRouteRule[];
}

export interface TLSRouteStatus extends RouteStatus {}

export class TLSRoute extends KubeObject<KubeObjectMetadata, TLSRouteStatus, TLSRouteSpec> {
  declare kind: "TLSRoute";
  declare apiVersion: "gateway.networking.k8s.io/v1";

  static readonly kind = "TLSRoute";
  static readonly namespaced = true;
  static readonly apiBase = "/apis/gateway.networking.k8s.io/v1/tlsroutes";
  static readonly crd: GatewayKubeObjectCRD = {
    apiVersions: ["gateway.networking.k8s.io/v1"],
    plural: "tlsroutes",
    singular: "tlsroute",
    title: "TLS Routes",
  };
}
