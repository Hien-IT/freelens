/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { BackendTLSPolicy as BackendTLSPolicy_v1 } from "../api/k8s/backend-tls-policy-v1";
import { GatewayClass as GatewayClass_v1 } from "../api/k8s/gateway-class-v1";
import { Gateway as Gateway_v1 } from "../api/k8s/gateway-v1";
import { GRPCRoute as GRPCRoute_v1 } from "../api/k8s/grpc-route-v1";
import { HTTPRoute as HTTPRoute_v1 } from "../api/k8s/http-route-v1";
import { ListenerSet as ListenerSet_v1 } from "../api/k8s/listenerset-v1";
import { ReferenceGrant as ReferenceGrant_v1 } from "../api/k8s/reference-grant-v1";
import { ReferenceGrant as ReferenceGrant_v1beta1 } from "../api/k8s/reference-grant-v1beta1";
import { TCPRoute as TCPRoute_v1 } from "../api/k8s/tcp-route-v1";
import { TCPRoute as TCPRoute_v1alpha2 } from "../api/k8s/tcp-route-v1alpha2";
import { TLSRoute as TLSRoute_v1 } from "../api/k8s/tls-route-v1";
import { UDPRoute as UDPRoute_v1 } from "../api/k8s/udp-route-v1";
import { UDPRoute as UDPRoute_v1alpha2 } from "../api/k8s/udp-route-v1alpha2";
import { XBackendTrafficPolicy as XBackendTrafficPolicy_v1alpha1 } from "../api/x-k8s/x-backend-traffic-policy-v1alpha1";
import { XBackend as XBackend_v1alpha1 } from "../api/x-k8s/xbackend-v1alpha1";
import { XMesh as XMesh_v1alpha1 } from "../api/x-k8s/xmesh-v1alpha1";
import { createDetailItemInjectable } from "./create-detail-item-injectable";
import { BackendTLSPolicyDetails as BackendTLSPolicyDetails_v1 } from "./k8s/backend-tls-policy-details-v1";
import { GatewayClassDetails as GatewayClassDetails_v1 } from "./k8s/gateway-class-details-v1";
import { GatewayDetails as GatewayDetails_v1 } from "./k8s/gateway-details-v1";
import { GRPCRouteDetails as GRPCRouteDetails_v1 } from "./k8s/grpc-route-details-v1";
import { HTTPRouteDetails as HTTPRouteDetails_v1 } from "./k8s/http-route-details-v1";
import { ListenerSetDetails as ListenerSetDetails_v1 } from "./k8s/listener-set-details-v1";
import { ReferenceGrantDetails as ReferenceGrantDetails_v1 } from "./k8s/reference-grant-details-v1";
import { ReferenceGrantDetails as ReferenceGrantDetails_v1beta1 } from "./k8s/reference-grant-details-v1beta1";
import { TCPRouteDetails as TCPRouteDetails_v1 } from "./k8s/tcp-route-details-v1";
import { TCPRouteDetails as TCPRouteDetails_v1alpha2 } from "./k8s/tcp-route-details-v1alpha2";
import { TLSRouteDetails as TLSRouteDetails_v1 } from "./k8s/tls-route-details-v1";
import { UDPRouteDetails as UDPRouteDetails_v1 } from "./k8s/udp-route-details-v1";
import { UDPRouteDetails as UDPRouteDetails_v1alpha2 } from "./k8s/udp-route-details-v1alpha2";
import { XBackendTrafficPolicyDetails as XBackendTrafficPolicyDetails_v1alpha1 } from "./x-k8s/x-backend-traffic-policy-details-v1alpha1";
import { XBackendDetails as XBackendDetails_v1alpha1 } from "./x-k8s/xbackend-details-v1alpha1";
import { XMeshDetails as XMeshDetails_v1alpha1 } from "./x-k8s/xmesh-details-v1alpha1";

// One item per kind and version, as the details of a version may differ.

export const gatewayClassV1DetailItemInjectable = createDetailItemInjectable(
  "gateway-class-v1",
  GatewayClass_v1,
  GatewayClassDetails_v1,
);

export const gatewayV1DetailItemInjectable = createDetailItemInjectable("gateway-v1", Gateway_v1, GatewayDetails_v1);

export const httpRouteV1DetailItemInjectable = createDetailItemInjectable(
  "http-route-v1",
  HTTPRoute_v1,
  HTTPRouteDetails_v1,
);

export const grpcRouteV1DetailItemInjectable = createDetailItemInjectable(
  "grpc-route-v1",
  GRPCRoute_v1,
  GRPCRouteDetails_v1,
);

export const tcpRouteV1DetailItemInjectable = createDetailItemInjectable(
  "tcp-route-v1",
  TCPRoute_v1,
  TCPRouteDetails_v1,
);

export const tcpRouteV1alpha2DetailItemInjectable = createDetailItemInjectable(
  "tcp-route-v1alpha2",
  TCPRoute_v1alpha2,
  TCPRouteDetails_v1alpha2,
);

export const tlsRouteV1DetailItemInjectable = createDetailItemInjectable(
  "tls-route-v1",
  TLSRoute_v1,
  TLSRouteDetails_v1,
);

export const udpRouteV1DetailItemInjectable = createDetailItemInjectable(
  "udp-route-v1",
  UDPRoute_v1,
  UDPRouteDetails_v1,
);

export const udpRouteV1alpha2DetailItemInjectable = createDetailItemInjectable(
  "udp-route-v1alpha2",
  UDPRoute_v1alpha2,
  UDPRouteDetails_v1alpha2,
);

export const referenceGrantV1DetailItemInjectable = createDetailItemInjectable(
  "reference-grant-v1",
  ReferenceGrant_v1,
  ReferenceGrantDetails_v1,
);

export const referenceGrantV1beta1DetailItemInjectable = createDetailItemInjectable(
  "reference-grant-v1beta1",
  ReferenceGrant_v1beta1,
  ReferenceGrantDetails_v1beta1,
);

export const listenerSetV1DetailItemInjectable = createDetailItemInjectable(
  "listener-set-v1",
  ListenerSet_v1,
  ListenerSetDetails_v1,
);

export const backendTLSPolicyV1DetailItemInjectable = createDetailItemInjectable(
  "backend-tls-policy-v1",
  BackendTLSPolicy_v1,
  BackendTLSPolicyDetails_v1,
);

export const xBackendTrafficPolicyV1alpha1DetailItemInjectable = createDetailItemInjectable(
  "x-backend-traffic-policy-v1alpha1",
  XBackendTrafficPolicy_v1alpha1,
  XBackendTrafficPolicyDetails_v1alpha1,
);

export const xBackendV1alpha1DetailItemInjectable = createDetailItemInjectable(
  "x-backend-v1alpha1",
  XBackend_v1alpha1,
  XBackendDetails_v1alpha1,
);

export const xMeshV1alpha1DetailItemInjectable = createDetailItemInjectable(
  "x-mesh-v1alpha1",
  XMesh_v1alpha1,
  XMeshDetails_v1alpha1,
);
