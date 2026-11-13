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
import { createAvailableVersionPage } from "../components/available-version";
import { BackendTLSPoliciesPage as BackendTLSPoliciesPage_v1 } from "./k8s/backend-tls-policies-page-v1";
import { GatewayClassesPage as GatewayClassesPage_v1 } from "./k8s/gateway-classes-page-v1";
import { GatewaysPage as GatewaysPage_v1 } from "./k8s/gateways-page-v1";
import { GRPCRoutesPage as GRPCRoutesPage_v1 } from "./k8s/grpc-routes-page-v1";
import { HTTPRoutesPage as HTTPRoutesPage_v1 } from "./k8s/http-routes-page-v1";
import { ListenerSetsPage as ListenerSetsPage_v1 } from "./k8s/listener-sets-page-v1";
import { ReferenceGrantsPage as ReferenceGrantsPage_v1 } from "./k8s/reference-grants/reference-grants-page-v1";
import { ReferenceGrantsPage as ReferenceGrantsPage_v1beta1 } from "./k8s/reference-grants/reference-grants-page-v1beta1";
import { TCPRoutesPage as TCPRoutesPage_v1 } from "./k8s/tcp-routes-page-v1";
import { TCPRoutesPage as TCPRoutesPage_v1alpha2 } from "./k8s/tcp-routes-page-v1alpha2";
import { TLSRoutesPage as TLSRoutesPage_v1 } from "./k8s/tls-routes-page-v1";
import { UDPRoutesPage as UDPRoutesPage_v1 } from "./k8s/udp-routes-page-v1";
import { UDPRoutesPage as UDPRoutesPage_v1alpha2 } from "./k8s/udp-routes-page-v1alpha2";
import { XBackendTrafficPoliciesPage as XBackendTrafficPoliciesPage_v1alpha1 } from "./x-k8s/x-backend-traffic-policies-page-v1alpha1";
import { XBackendsPage as XBackendsPage_v1alpha1 } from "./x-k8s/xbackends-page-v1alpha1";
import { XMeshesPage as XMeshesPage_v1alpha1 } from "./x-k8s/xmeshes-page-v1alpha1";

import type React from "react";

import type { GatewayApiResource } from "../api/available-resource";
import type { VersionVariant } from "../components/available-version";

/** A page of the Gateway API that lists one kind, in the first of its versions the cluster serves. */
export interface GatewayApiKindPage {
  /** The plural of the kind, which is also the last segment of the path of the page. */
  id: string;
  title: string;
  /** The model classes of the versions the page can list, in the order it prefers them. */
  resources: GatewayApiResource[];
  Component: React.ComponentType;
}

const defineKindPage = (title: string, variants: VersionVariant[]): GatewayApiKindPage => ({
  id: variants[0].resource.crd.plural,
  title,
  resources: variants.map((variant) => variant.resource),
  Component: createAvailableVersionPage(title, variants),
});

export const gatewayClassesPage = defineKindPage("Gateway Classes", [
  { resource: GatewayClass_v1, PageComponent: GatewayClassesPage_v1, version: "v1" },
]);

export const gatewaysPage = defineKindPage("Gateways", [
  { resource: Gateway_v1, PageComponent: GatewaysPage_v1, version: "v1" },
]);

export const httpRoutesPage = defineKindPage("HTTP Routes", [
  { resource: HTTPRoute_v1, PageComponent: HTTPRoutesPage_v1, version: "v1" },
]);

export const grpcRoutesPage = defineKindPage("gRPC Routes", [
  { resource: GRPCRoute_v1, PageComponent: GRPCRoutesPage_v1, version: "v1" },
]);

export const tcpRoutesPage = defineKindPage("TCP Routes", [
  { resource: TCPRoute_v1, PageComponent: TCPRoutesPage_v1, version: "v1" },
  { resource: TCPRoute_v1alpha2, PageComponent: TCPRoutesPage_v1alpha2, version: "v1alpha2" },
]);

export const tlsRoutesPage = defineKindPage("TLS Routes", [
  { resource: TLSRoute_v1, PageComponent: TLSRoutesPage_v1, version: "v1" },
]);

export const udpRoutesPage = defineKindPage("UDP Routes", [
  { resource: UDPRoute_v1, PageComponent: UDPRoutesPage_v1, version: "v1" },
  { resource: UDPRoute_v1alpha2, PageComponent: UDPRoutesPage_v1alpha2, version: "v1alpha2" },
]);

export const referenceGrantsPage = defineKindPage("Reference Grants", [
  { resource: ReferenceGrant_v1, PageComponent: ReferenceGrantsPage_v1, version: "v1" },
  { resource: ReferenceGrant_v1beta1, PageComponent: ReferenceGrantsPage_v1beta1, version: "v1beta1" },
]);

export const listenerSetsPage = defineKindPage("Listener Sets", [
  { resource: ListenerSet_v1, PageComponent: ListenerSetsPage_v1, version: "v1" },
]);

export const backendTLSPoliciesPage = defineKindPage("Backend TLS Policies", [
  { resource: BackendTLSPolicy_v1, PageComponent: BackendTLSPoliciesPage_v1, version: "v1" },
]);

export const xBackendTrafficPoliciesPage = defineKindPage("Backend Traffic Policies", [
  {
    resource: XBackendTrafficPolicy_v1alpha1,
    PageComponent: XBackendTrafficPoliciesPage_v1alpha1,
    version: "v1alpha1",
  },
]);

export const xBackendsPage = defineKindPage("Backends", [
  { resource: XBackend_v1alpha1, PageComponent: XBackendsPage_v1alpha1, version: "v1alpha1" },
]);

export const xMeshesPage = defineKindPage("Meshes", [
  { resource: XMesh_v1alpha1, PageComponent: XMeshesPage_v1alpha1, version: "v1alpha1" },
]);

/** The pages of the kinds, in the order of the sidebar. */
export const kindPages: GatewayApiKindPage[] = [
  gatewayClassesPage,
  gatewaysPage,
  httpRoutesPage,
  grpcRoutesPage,
  tcpRoutesPage,
  tlsRoutesPage,
  udpRoutesPage,
  referenceGrantsPage,
  listenerSetsPage,
  backendTLSPoliciesPage,
  xBackendTrafficPoliciesPage,
  xBackendsPage,
  xMeshesPage,
];
