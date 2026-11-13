/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { type Condition, KubeObject, type KubeObjectMetadata, type LabelSelector } from "@freelensapp/kube-object";
import {
  type GatewayCondition,
  type GatewayDefaultScope,
  type GatewayKubeObjectCRD,
  type ObjectReference,
  type SecretObjectReference,
} from "./types";

export type ProtocolType = "HTTP" | "HTTPS" | "TCP" | "TLS" | "UDP";

export type FromNamespaces = "All" | "Selector" | "Same" | "None";

export type TLSModeType = "Terminate" | "Passthrough";

export interface ListenerTLSConfig {
  /** default: `"Terminate"` */
  mode?: TLSModeType;
  certificateRefs?: SecretObjectReference[];
  options?: Record<string, string>;
}

export interface RouteNamespaces {
  from?: FromNamespaces;
  selector?: LabelSelector;
}

export interface RouteGroupKind {
  /** default: `"gateway.networking.k8s.io"` */
  group?: string;
  kind: string;
}

export interface AllowedRoutes {
  namespaces?: RouteNamespaces;
  kinds?: RouteGroupKind[];
}

export interface Listener {
  name: string;
  hostname?: string;
  port: number;
  protocol: ProtocolType;
  tls?: ListenerTLSConfig;
  allowedRoutes?: AllowedRoutes;
}

export interface ListenerNamespaces {
  from?: FromNamespaces;
  selector?: LabelSelector;
}

export interface AllowedListeners {
  namespaces?: ListenerNamespaces;
}

export interface GatewaySpecAddress {
  /** default: `"IPAddress"` */
  type?: string;
  value?: string;
}

export interface LocalParametersReference {
  group: string;
  kind: string;
  name: string;
}

export interface GatewayInfrastructure {
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  parametersRef?: LocalParametersReference;
}

export interface GatewayBackendTLS {
  clientCertificateRef?: SecretObjectReference;
}

export type FrontendValidationModeType = "AllowValidOnly" | "AllowInsecureFallback";

export interface FrontendTLSValidation {
  caCertificateRefs: ObjectReference[];
  /** default: `"AllowValidOnly"` */
  mode?: FrontendValidationModeType;
}

export interface TLSConfig {
  validation?: FrontendTLSValidation;
}

export interface TLSPortConfig {
  port: number;
  tls: TLSConfig;
}

export interface FrontendTLSConfig {
  default: TLSConfig;
  perPort?: TLSPortConfig[];
}

export interface GatewayTLSConfig {
  backend?: GatewayBackendTLS;
  frontend?: FrontendTLSConfig;
}

export interface GatewaySpec {
  gatewayClassName: string;
  listeners: Listener[];
  addresses?: GatewaySpecAddress[];
  infrastructure?: GatewayInfrastructure;
  allowedListeners?: AllowedListeners;
  tls?: GatewayTLSConfig;
  /** default: `"None"` */
  defaultScope?: GatewayDefaultScope;
}

export interface GatewayStatusAddress {
  /** default: `"IPAddress"` */
  type?: string;
  value: string;
}

export interface ListenerStatus {
  name: string;
  supportedKinds?: RouteGroupKind[];
  attachedRoutes: number;
  conditions: Condition[];
}

export interface GatewayStatus {
  addresses?: GatewayStatusAddress[];
  conditions?: GatewayCondition[];
  listeners?: ListenerStatus[];
  attachedListenerSets?: number;
}

export class Gateway extends KubeObject<KubeObjectMetadata, GatewayStatus, GatewaySpec> {
  declare kind: "Gateway";
  declare apiVersion: "gateway.networking.k8s.io/v1";

  static readonly kind = "Gateway";
  static readonly namespaced = true;
  static readonly apiBase = "/apis/gateway.networking.k8s.io/v1/gateways";
  static readonly crd: GatewayKubeObjectCRD = {
    apiVersions: ["gateway.networking.k8s.io/v1"],
    plural: "gateways",
    singular: "gateway",
    shortNames: ["gtw"],
    title: "Gateways",
  };
}
