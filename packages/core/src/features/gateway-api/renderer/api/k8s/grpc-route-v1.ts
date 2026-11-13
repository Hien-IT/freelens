/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { KubeObject, type KubeObjectMetadata } from "@freelensapp/kube-object";
import {
  type BackendRef,
  type CommonRouteSpec,
  type GatewayKubeObjectCRD,
  type LocalObjectReference,
  type RouteStatus,
  type SessionPersistence,
} from "./types";

import type { HTTPHeaderFilter, HTTPRequestMirrorFilter } from "./http-route-v1";

export type GRPCMethodMatchType = "Exact" | "RegularExpression";

export type GRPCRouteFilterType = "RequestHeaderModifier" | "ResponseHeaderModifier" | "RequestMirror" | "ExtensionRef";

export interface GRPCMethodMatch {
  type?: GRPCMethodMatchType;
  service?: string;
  method?: string;
}

export type GRPCHeaderMatchType = "Exact" | "RegularExpression";

export interface GRPCHeaderMatch {
  /** default: `"Exact"` */
  type?: GRPCHeaderMatchType;
  name: string;
  value: string;
}

export interface GRPCRouteMatch {
  method?: GRPCMethodMatch;
  headers?: GRPCHeaderMatch[];
}

export interface GRPCRouteFilter {
  type: GRPCRouteFilterType;
  requestHeaderModifier?: HTTPHeaderFilter;
  responseHeaderModifier?: HTTPHeaderFilter;
  requestMirror?: HTTPRequestMirrorFilter;
  extensionRef?: LocalObjectReference;
}

export interface GRPCBackendRef extends BackendRef {
  filters?: GRPCRouteFilter[];
}

export interface GRPCRouteRule {
  name?: string;
  matches?: GRPCRouteMatch[];
  filters?: GRPCRouteFilter[];
  backendRefs?: GRPCBackendRef[];
  sessionPersistence?: SessionPersistence;
}

export interface GRPCRouteSpec extends CommonRouteSpec {
  hostnames?: string[];
  rules?: GRPCRouteRule[];
}

export interface GRPCRouteStatus extends RouteStatus {}

export class GRPCRoute extends KubeObject<KubeObjectMetadata, GRPCRouteStatus, GRPCRouteSpec> {
  declare kind: "GRPCRoute";
  declare apiVersion: "gateway.networking.k8s.io/v1";

  static readonly kind = "GRPCRoute";
  static readonly namespaced = true;
  static readonly apiBase = "/apis/gateway.networking.k8s.io/v1/grpcroutes";
  static readonly crd: GatewayKubeObjectCRD = {
    apiVersions: ["gateway.networking.k8s.io/v1"],
    plural: "grpcroutes",
    singular: "grpcroute",
    title: "gRPC Routes",
  };
}
