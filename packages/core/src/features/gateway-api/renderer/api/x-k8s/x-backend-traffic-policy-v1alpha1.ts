/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { KubeObject, type KubeObjectMetadata } from "@freelensapp/kube-object";
import { type LocalPolicyTargetReference } from "../k8s/backend-tls-policy-v1";
import { type GatewayKubeObjectCRD, type PolicyStatus, type SessionPersistence } from "../k8s/types";

export interface RequestRate {
  /** default: `10` */
  count?: number;
  /** default: `"1s"` */
  interval?: string;
}

export interface BudgetDetails {
  /** default: `20` */
  percent?: number;
  /** default: `"10s"` */
  interval?: string;
}

export interface RetryConstraint {
  budget?: BudgetDetails;
  minRetryRate?: RequestRate;
}

export interface BackendTrafficPolicySpec {
  targetRefs: LocalPolicyTargetReference[];
  retryConstraint?: RetryConstraint;
  sessionPersistence?: SessionPersistence;
}

export interface XBackendTrafficPolicyStatus extends PolicyStatus {}

export class XBackendTrafficPolicy extends KubeObject<
  KubeObjectMetadata,
  XBackendTrafficPolicyStatus,
  BackendTrafficPolicySpec
> {
  declare kind: "XBackendTrafficPolicy";
  declare apiVersion: "gateway.networking.x-k8s.io/v1alpha1";

  static readonly kind = "XBackendTrafficPolicy";
  static readonly namespaced = true;
  static readonly apiBase = "/apis/gateway.networking.x-k8s.io/v1alpha1/xbackendtrafficpolicies";
  static readonly crd: GatewayKubeObjectCRD = {
    apiVersions: ["gateway.networking.x-k8s.io/v1alpha1"],
    plural: "xbackendtrafficpolicies",
    singular: "xbackendtrafficpolicy",
    shortNames: ["xbtrafficpolicy"],
    title: "Backend Traffic Policies",
  };
}
