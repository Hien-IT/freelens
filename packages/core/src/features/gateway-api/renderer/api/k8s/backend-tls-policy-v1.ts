/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { KubeObject, type KubeObjectMetadata } from "@freelensapp/kube-object";
import { type BackendTLSPolicyValidation, type GatewayKubeObjectCRD, type PolicyStatus } from "./types";

export interface LocalPolicyTargetReference {
  group: string;
  kind: string;
  name: string;
}

export interface LocalPolicyTargetReferenceWithSectionName extends LocalPolicyTargetReference {
  sectionName?: string;
}

export interface BackendTLSPolicySpec {
  targetRefs: LocalPolicyTargetReferenceWithSectionName[];
  validation: BackendTLSPolicyValidation;
  options?: Record<string, string>;
}

export interface BackendTLSPolicyStatus extends PolicyStatus {}

export class BackendTLSPolicy extends KubeObject<KubeObjectMetadata, BackendTLSPolicyStatus, BackendTLSPolicySpec> {
  declare kind: "BackendTLSPolicy";
  declare apiVersion: "gateway.networking.k8s.io/v1";

  static readonly kind = "BackendTLSPolicy";
  static readonly namespaced = true;
  static readonly apiBase = "/apis/gateway.networking.k8s.io/v1/backendtlspolicies";
  static readonly crd: GatewayKubeObjectCRD = {
    apiVersions: ["gateway.networking.k8s.io/v1"],
    plural: "backendtlspolicies",
    singular: "backendtlspolicy",
    shortNames: ["btlspolicy"],
    title: "Backend TLS Policies",
  };
}
