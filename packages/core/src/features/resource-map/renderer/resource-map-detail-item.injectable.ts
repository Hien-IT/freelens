/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { computed } from "mobx";
import currentKubeObjectInDetailsInjectable from "../../../renderer/components/kube-object-details/current-kube-object-in-details.injectable";
import { kubeObjectDetailItemInjectionToken } from "../../../renderer/components/kube-object-details/kube-object-detail-items/kube-object-detail-item-injection-token";
import { kubeObjectMatchesToKindAndApiVersion } from "../../../renderer/components/kube-object-details/kube-object-detail-items/kube-object-matches-to-kind-and-api-version";
import { ResourceMapDetails } from "./resource-map-entry-points";

import type { KubeObject } from "@freelensapp/kube-object";

// The kinds whose details panel shows a map, at the versions it draws.
const mapsDrawn = [
  kubeObjectMatchesToKindAndApiVersion("Deployment", ["apps/v1"]),
  kubeObjectMatchesToKindAndApiVersion("DaemonSet", ["apps/v1"]),
  kubeObjectMatchesToKindAndApiVersion("StatefulSet", ["apps/v1"]),
  kubeObjectMatchesToKindAndApiVersion("Pod", ["v1"]),
  kubeObjectMatchesToKindAndApiVersion("Service", ["v1"]),
  kubeObjectMatchesToKindAndApiVersion("Ingress", ["networking.k8s.io/v1", "extensions/v1beta1"]),
];

export const hasResourceMap = (object: KubeObject | undefined) => mapsDrawn.some((matches) => matches(object));

const resourceMapDetailItemInjectable = getInjectable({
  id: "resource-map-detail-item",

  instantiate: (di) => {
    const kubeObject = di.inject(currentKubeObjectInDetailsInjectable);

    return {
      Component: ResourceMapDetails,
      enabled: computed(() => hasResourceMap(kubeObject.value.get()?.object)),
      // After the built-in details of the kind and their events, where the
      // details of an extension of priority 10 go (300 - priority).
      orderNumber: 290,
    };
  },

  injectionToken: kubeObjectDetailItemInjectionToken,
});

export default resourceMapDetailItemInjectable;
