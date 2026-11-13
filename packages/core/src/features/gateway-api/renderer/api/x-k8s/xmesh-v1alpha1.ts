/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { type Condition, KubeObject, type KubeObjectMetadata } from "@freelensapp/kube-object";
import { type ParametersReference, type SupportedFeature } from "../k8s/gateway-class-v1";
import { type GatewayKubeObjectCRD } from "../k8s/types";

export interface MeshSpec {
  controllerName: string;
  parametersRef?: ParametersReference;
  description?: string;
}

export interface MeshStatus {
  conditions?: Condition[];
  supportedFeatures?: SupportedFeature[];
}

export class XMesh extends KubeObject<KubeObjectMetadata, MeshStatus, MeshSpec> {
  declare kind: "XMesh";
  declare apiVersion: "gateway.networking.x-k8s.io/v1alpha1";

  static readonly kind = "XMesh";
  static readonly namespaced = false;
  static readonly apiBase = "/apis/gateway.networking.x-k8s.io/v1alpha1/xmeshes";
  static readonly crd: GatewayKubeObjectCRD = {
    apiVersions: ["gateway.networking.x-k8s.io/v1alpha1"],
    plural: "xmeshes",
    singular: "xmesh",
    shortNames: ["mesh"],
    title: "Meshes",
  };
}
