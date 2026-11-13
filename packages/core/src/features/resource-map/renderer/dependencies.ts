/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import type {
  ConfigMapApi,
  DaemonSetApi,
  DeploymentApi,
  IngressApi,
  PersistentVolumeClaimApi,
  PodApi,
  SecretApi,
  ServiceApi,
  StatefulSetApi,
} from "@freelensapp/kube-api";
import type { Logger } from "@freelensapp/logger";

import type { KubeResource } from "../../../common/rbac";
import type { ConfigMapStore } from "../../../renderer/components/config-maps/store";
import type { SecretStore } from "../../../renderer/components/config-secrets/store";
import type { NamespaceStore } from "../../../renderer/components/namespaces/store";
import type { IngressStore } from "../../../renderer/components/network-ingresses/ingress-store";
import type { ServiceStore } from "../../../renderer/components/network-services/store";
import type { PersistentVolumeClaimStore } from "../../../renderer/components/storage-volume-claims/store";
import type { DaemonSetStore } from "../../../renderer/components/workloads-daemonsets/store";
import type { DeploymentStore } from "../../../renderer/components/workloads-deployments/store";
import type { PodStore } from "../../../renderer/components/workloads-pods/store";
import type { StatefulSetStore } from "../../../renderer/components/workloads-statefulsets/store";
import type { SubscribeStores } from "../../../renderer/kube-watch-api/kube-watch-api";

/**
 * The stores of the kinds that the maps draw, in the order the maps load
 * them. They are the application's singletons: the maps load and watch them,
 * and read their items, but never replace them.
 */
export interface MapStores {
  pods: PodStore;
  deployments: DeploymentStore;
  statefulSets: StatefulSetStore;
  daemonSets: DaemonSetStore;
  services: ServiceStore;
  ingresses: IngressStore;
  pvcs: PersistentVolumeClaimStore;
  configMaps: ConfigMapStore;
  secrets: SecretStore;
}

/**
 * The APIs of the kinds of the stores. A details map lists with them the
 * objects of a namespace that the stores do not hold, which leaves the stores
 * as the other views expect them.
 */
export interface MapApis {
  pods: PodApi;
  deployments: DeploymentApi;
  statefulSets: StatefulSetApi;
  daemonSets: DaemonSetApi;
  services: ServiceApi;
  ingresses: IngressApi;
  pvcs: PersistentVolumeClaimApi;
  configMaps: ConfigMapApi;
  secrets: SecretApi;
}

/** The resource of the kind of each store, as RBAC names it. */
export const mapStoreResources: Record<keyof MapStores, KubeResource> = {
  pods: "pods",
  deployments: "deployments",
  statefulSets: "statefulsets",
  daemonSets: "daemonsets",
  services: "services",
  ingresses: "ingresses",
  pvcs: "persistentvolumeclaims",
  configMaps: "configmaps",
  secrets: "secrets",
};

/** The colours that the maps paint on their canvas. */
export interface CanvasColors {
  /** The fill of the outer ring of a controller. */
  background: string;
  /** The labels of the nodes. */
  text: string;
}

/** A Helm release, by its namespace and name, as a map node stands for it. */
export interface HelmReleaseRef {
  namespace?: string;
  name: string;
}

/**
 * What the maps take from the rest of the application. The entry components
 * inject it and hand it down, so that the charts stay plain components that a
 * test renders with fakes.
 */
export interface ResourceMapDependencies {
  readonly stores: MapStores;
  readonly apis: MapApis;
  /** The namespace store, whose selection the maps follow. */
  readonly namespaceStore: NamespaceStore;
  readonly logger: Logger;
  /**
   * Loads and watches stores for the namespaces of the filter, with one watch
   * of a store shared by every view that follows it, until the disposer it
   * returns is called.
   */
  readonly subscribeStores: SubscribeStores;
  /**
   * Whether the user may list the objects of the kind of a store in this
   * cluster. A map neither loads nor watches a store whose kind the user
   * cannot list, such as the secrets for a user of a restricted role, and
   * draws the other kinds without it.
   */
  canListMapStore(key: keyof MapStores): boolean;
  /**
   * The canvas colours of the active theme. Read while an observer renders, a
   * theme change renders it again, and the canvas is painted with the new
   * colours.
   */
  getCanvasColors(): CanvasColors;
  /** Opens the details of the object of a node. */
  showDetails(selfLink: string): void;
  /** Opens the details of a Helm release on its route. */
  showHelmRelease(release: HelmReleaseRef): void;
}

/** The prefix of what the maps log. */
export const logPrefix = "[RESOURCE-MAP]";
