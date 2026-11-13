/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { BackendTLSPolicy as BackendTLSPolicy_v1 } from "./backend-tls-policy-v1";
import { GatewayClass as GatewayClass_v1 } from "./gateway-class-v1";
import { Gateway as Gateway_v1 } from "./gateway-v1";
import { GRPCRoute as GRPCRoute_v1 } from "./grpc-route-v1";
import { HTTPRoute as HTTPRoute_v1 } from "./http-route-v1";
import { ListenerSet as ListenerSet_v1 } from "./listenerset-v1";
import { ReferenceGrant as ReferenceGrant_v1 } from "./reference-grant-v1";
import { ReferenceGrant as ReferenceGrant_v1beta1 } from "./reference-grant-v1beta1";
import { TCPRoute as TCPRoute_v1 } from "./tcp-route-v1";
import { TCPRoute as TCPRoute_v1alpha2 } from "./tcp-route-v1alpha2";
import { TLSRoute as TLSRoute_v1 } from "./tls-route-v1";
import { UDPRoute as UDPRoute_v1 } from "./udp-route-v1";
import { UDPRoute as UDPRoute_v1alpha2 } from "./udp-route-v1alpha2";

export * from "./statuses";
export * from "./types";
export {
  BackendTLSPolicy_v1,
  BackendTLSPolicy_v1 as BackendTLSPolicy,
  Gateway_v1,
  Gateway_v1 as Gateway,
  GatewayClass_v1,
  GatewayClass_v1 as GatewayClass,
  GRPCRoute_v1,
  GRPCRoute_v1 as GRPCRoute,
  HTTPRoute_v1,
  HTTPRoute_v1 as HTTPRoute,
  ListenerSet_v1,
  ListenerSet_v1 as ListenerSet,
  ReferenceGrant_v1,
  ReferenceGrant_v1 as ReferenceGrant,
  ReferenceGrant_v1beta1,
  TCPRoute_v1,
  TCPRoute_v1 as TCPRoute,
  TCPRoute_v1alpha2,
  TLSRoute_v1,
  TLSRoute_v1 as TLSRoute,
  UDPRoute_v1,
  UDPRoute_v1 as UDPRoute,
  UDPRoute_v1alpha2,
};
