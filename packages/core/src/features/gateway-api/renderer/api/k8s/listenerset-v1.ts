/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { type Condition, KubeObject, type KubeObjectMetadata } from "@freelensapp/kube-object";
import { type AllowedRoutes, type ListenerTLSConfig, type ProtocolType, type RouteGroupKind } from "./gateway-v1";
import { type GatewayKubeObjectCRD } from "./types";

export interface ParentGatewayReference {
  /** default: `"gateway.networking.k8s.io"` */
  group?: string;
  /** default: `"Gateway"` */
  kind?: string;
  name: string;
  namespace?: string;
}

export interface ListenerEntry {
  name: string;
  hostname?: string;
  port: number;
  protocol: ProtocolType;
  tls?: ListenerTLSConfig;
  allowedRoutes?: AllowedRoutes;
}

export interface ListenerSetSpec {
  parentRef: ParentGatewayReference;
  listeners: ListenerEntry[];
}

export interface ListenerEntryStatus {
  name: string;
  supportedKinds?: RouteGroupKind[];
  attachedRoutes: number;
  conditions: Condition[];
}

export interface ListenerSetStatus {
  conditions?: Condition[];
  listeners?: ListenerEntryStatus[];
}

export class ListenerSet extends KubeObject<KubeObjectMetadata, ListenerSetStatus, ListenerSetSpec> {
  declare kind: "ListenerSet";
  declare apiVersion: "gateway.networking.k8s.io/v1";

  static readonly kind = "ListenerSet";
  static readonly namespaced = true;
  static readonly apiBase = "/apis/gateway.networking.k8s.io/v1/listenersets";
  static readonly crd: GatewayKubeObjectCRD = {
    apiVersions: ["gateway.networking.k8s.io/v1"],
    plural: "listenersets",
    singular: "listenerset",
    shortNames: ["lset"],
    title: "Listener Sets",
  };
}
