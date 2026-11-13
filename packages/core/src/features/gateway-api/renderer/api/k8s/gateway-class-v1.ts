/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { KubeObject, type KubeObjectMetadata } from "@freelensapp/kube-object";
import { type GatewayCondition, type GatewayKubeObjectCRD } from "./types";

export interface ParametersReference {
  group: string;
  kind: string;
  name: string;
  namespace?: string;
}

export interface GatewayClassSpec {
  controllerName: string;
  parametersRef?: ParametersReference;
  description?: string;
}

export interface SupportedFeature {
  name: string;
}

export interface GatewayClassStatus {
  conditions?: GatewayCondition[];
  supportedFeatures?: SupportedFeature[];
}

export class GatewayClass extends KubeObject<KubeObjectMetadata, GatewayClassStatus, GatewayClassSpec> {
  declare kind: "GatewayClass";
  declare apiVersion: "gateway.networking.k8s.io/v1";

  static readonly kind = "GatewayClass";
  static readonly namespaced = false;
  static readonly apiBase = "/apis/gateway.networking.k8s.io/v1/gatewayclasses";
  static readonly crd: GatewayKubeObjectCRD = {
    apiVersions: ["gateway.networking.k8s.io/v1"],
    plural: "gatewayclasses",
    singular: "gatewayclass",
    shortNames: ["gc"],
    title: "Gateway Classes",
  };
}
