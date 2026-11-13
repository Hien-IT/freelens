/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { KubeObject, type KubeObjectMetadata } from "@freelensapp/kube-object";
import { type GatewayKubeObjectCRD } from "./types";

export interface ReferenceGrantFrom {
  group: string;
  kind: string;
  namespace: string;
}

export interface ReferenceGrantTo {
  group: string;
  kind: string;
  name?: string;
}

export interface ReferenceGrantSpec {
  from: ReferenceGrantFrom[];
  to: ReferenceGrantTo[];
}

export class ReferenceGrant extends KubeObject<KubeObjectMetadata, void, ReferenceGrantSpec> {
  declare kind: "ReferenceGrant";
  declare apiVersion: "gateway.networking.k8s.io/v1beta1";

  static readonly kind = "ReferenceGrant";
  static readonly namespaced = true;
  static readonly apiBase = "/apis/gateway.networking.k8s.io/v1beta1/referencegrants";
  static readonly crd: GatewayKubeObjectCRD = {
    apiVersions: ["gateway.networking.k8s.io/v1beta1"],
    plural: "referencegrants",
    singular: "referencegrant",
    shortNames: ["refgrant"],
    title: "Reference Grants",
  };
}
