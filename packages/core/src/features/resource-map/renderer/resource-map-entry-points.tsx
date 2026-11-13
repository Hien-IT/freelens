/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { withInjectables } from "@ogre-tools/injectable-react";
import { ErrorBoundary } from "./error-boundary";
import { KubeControllerChart } from "./kube-controller-chart";
import { KubeIngressChart } from "./kube-ingress-chart";
import { KubePodChart } from "./kube-pod-chart";
import { KubeResourceOverviewDetail, KubeResourcePage } from "./kube-resource-page";
import { KubeServiceChart } from "./kube-service-chart";
import resourceMapDependenciesInjectable from "./resource-map-dependencies.injectable";

import type { DaemonSet, Deployment, Ingress, KubeObject, Pod, Service, StatefulSet } from "@freelensapp/kube-object";

import type { KubeObjectDetailsProps } from "../../../renderer/components/kube-object-details";
import type { ResourceMapDependencies } from "./dependencies";

interface Dependencies {
  dependencies: ResourceMapDependencies;
}

/** The Resource Map page, inside an error boundary, so that an error of the map leaves the sidebar rendered. */
export function NonInjectedResourceMapPage({ dependencies }: Dependencies) {
  return (
    <ErrorBoundary logger={dependencies.logger}>
      <KubeResourcePage dependencies={dependencies} />
    </ErrorBoundary>
  );
}

/**
 * The Resource Map in the Workloads Overview, inside an error boundary of its own: the overview has none around its
 * items, so an error of the map would otherwise replace the whole Workloads Overview, its other panels included.
 */
export function NonInjectedResourceMapWorkloadsOverviewItem({ dependencies }: Dependencies) {
  return (
    <ErrorBoundary logger={dependencies.logger}>
      <KubeResourceOverviewDetail dependencies={dependencies} />
    </ErrorBoundary>
  );
}

// The map of the kind of the object of a details panel, if the maps draw one for it.
function DetailsChart({ object, dependencies }: { object: KubeObject; dependencies: ResourceMapDependencies }) {
  switch (object.kind) {
    case "Deployment":
    case "DaemonSet":
    case "StatefulSet":
      return (
        <KubeControllerChart object={object as Deployment | DaemonSet | StatefulSet} dependencies={dependencies} />
      );
    case "Pod":
      return <KubePodChart object={object as Pod} dependencies={dependencies} />;
    case "Service":
      return <KubeServiceChart object={object as Service} dependencies={dependencies} />;
    case "Ingress":
      return <KubeIngressChart object={object as Ingress} dependencies={dependencies} />;
    default:
      return null;
  }
}

/**
 * The map in the details panel of an object, inside an error boundary that renders it again for a new object: the
 * details drawer has none around its items, so an error of the map would otherwise take the drawer down with it.
 */
export function NonInjectedResourceMapDetails({ object, dependencies }: KubeObjectDetailsProps & Dependencies) {
  return (
    <ErrorBoundary logger={dependencies.logger} resetKey={object}>
      <DetailsChart object={object} dependencies={dependencies} />
    </ErrorBoundary>
  );
}

export const ResourceMapPage = withInjectables<Dependencies>(NonInjectedResourceMapPage, {
  getProps: (di, props) => ({
    ...props,
    dependencies: di.inject(resourceMapDependenciesInjectable),
  }),
});

export const ResourceMapWorkloadsOverviewItem = withInjectables<Dependencies>(
  NonInjectedResourceMapWorkloadsOverviewItem,
  {
    getProps: (di, props) => ({
      ...props,
      dependencies: di.inject(resourceMapDependenciesInjectable),
    }),
  },
);

export const ResourceMapDetails = withInjectables<Dependencies, KubeObjectDetailsProps>(NonInjectedResourceMapDetails, {
  getProps: (di, props) => ({
    ...props,
    dependencies: di.inject(resourceMapDependenciesInjectable),
  }),
});
