/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { KubeObject, type KubeObjectMetadata } from "@freelensapp/kube-object";
import { type BackendRef, type CommonRouteSpec, type GatewayKubeObjectCRD, type RouteStatus } from "./types";

export interface UDPRouteRule {
  name?: string;
  backendRefs: BackendRef[];
}

export interface UDPRouteSpec extends CommonRouteSpec {
  rules: UDPRouteRule[];
}

export interface UDPRouteStatus extends RouteStatus {}

export class UDPRoute extends KubeObject<KubeObjectMetadata, UDPRouteStatus, UDPRouteSpec> {
  declare kind: "UDPRoute";
  declare apiVersion: "gateway.networking.k8s.io/v1";

  static readonly kind = "UDPRoute";
  static readonly namespaced = true;
  static readonly apiBase = "/apis/gateway.networking.k8s.io/v1/udproutes";
  static readonly crd: GatewayKubeObjectCRD = {
    apiVersions: ["gateway.networking.k8s.io/v1"],
    plural: "udproutes",
    singular: "udproute",
    title: "UDP Routes",
  };
}
