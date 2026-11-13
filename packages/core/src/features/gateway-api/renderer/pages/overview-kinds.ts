/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import {
  BackendTLSPolicy as BackendTLSPolicy_v1,
  Gateway as Gateway_v1,
  GatewayClass as GatewayClass_v1,
  GRPCRoute as GRPCRoute_v1,
  HTTPRoute as HTTPRoute_v1,
  ListenerSet as ListenerSet_v1,
  TCPRoute_v1,
  TCPRoute_v1alpha2,
  TLSRoute as TLSRoute_v1,
  UDPRoute_v1,
  UDPRoute_v1alpha2,
} from "../api/k8s";
import {
  XBackend as XBackend_v1alpha1,
  XBackendTrafficPolicy as XBackendTrafficPolicy_v1alpha1,
  XMesh as XMesh_v1alpha1,
} from "../api/x-k8s";

import type { GatewayApiResource } from "../api/available-resource";

// Kinds whose status can be summarized, each with its model classes in the
// order the cluster pages prefer them. ReferenceGrant is omitted because it has
// no status subresource.
export const kinds: GatewayApiResource[][] = [
  [GatewayClass_v1],
  [Gateway_v1],
  [HTTPRoute_v1],
  [GRPCRoute_v1],
  [TCPRoute_v1, TCPRoute_v1alpha2],
  [TLSRoute_v1],
  [UDPRoute_v1, UDPRoute_v1alpha2],
  [ListenerSet_v1],
  [BackendTLSPolicy_v1],
  [XBackendTrafficPolicy_v1alpha1],
  [XBackend_v1alpha1],
  [XMesh_v1alpha1],
];
