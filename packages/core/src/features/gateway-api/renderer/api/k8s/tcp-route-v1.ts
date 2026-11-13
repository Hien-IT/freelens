/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { KubeObject, type KubeObjectMetadata } from "@freelensapp/kube-object";
import { type BackendRef, type CommonRouteSpec, type GatewayKubeObjectCRD, type RouteStatus } from "./types";

export interface TCPRouteRule {
  name?: string;
  backendRefs: BackendRef[];
}

export interface TCPRouteSpec extends CommonRouteSpec {
  rules: TCPRouteRule[];
}

export interface TCPRouteStatus extends RouteStatus {}

export class TCPRoute extends KubeObject<KubeObjectMetadata, TCPRouteStatus, TCPRouteSpec> {
  declare kind: "TCPRoute";
  declare apiVersion: "gateway.networking.k8s.io/v1";

  static readonly kind = "TCPRoute";
  static readonly namespaced = true;
  static readonly apiBase = "/apis/gateway.networking.k8s.io/v1/tcproutes";
  static readonly crd: GatewayKubeObjectCRD = {
    apiVersions: ["gateway.networking.k8s.io/v1"],
    plural: "tcproutes",
    singular: "tcproute",
    title: "TCP Routes",
  };
}
