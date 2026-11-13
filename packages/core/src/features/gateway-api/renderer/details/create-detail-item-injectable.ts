/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { computed } from "mobx";
import currentKubeObjectInDetailsInjectable from "../../../../renderer/components/kube-object-details/current-kube-object-in-details.injectable";
import { kubeObjectDetailItemInjectionToken } from "../../../../renderer/components/kube-object-details/kube-object-detail-items/kube-object-detail-item-injection-token";
import { kubeObjectMatchesToKindAndApiVersion } from "../../../../renderer/components/kube-object-details/kube-object-detail-items/kube-object-matches-to-kind-and-api-version";

import type React from "react";

import type { KubeObjectDetailsProps } from "../../../../renderer/components/kube-object-details";
import type { GatewayApiResource } from "../api/available-resource";

/** The details of the objects of a model class, in every one of its `crd.apiVersions`. */
export function createDetailItemInjectable(
  id: string,
  resource: GatewayApiResource,
  Component: React.ElementType<KubeObjectDetailsProps<any>>,
) {
  const matches = kubeObjectMatchesToKindAndApiVersion(resource.kind, resource.crd.apiVersions);

  return getInjectable({
    id: `gateway-api-${id}-detail-item`,

    instantiate: (di) => {
      const kubeObject = di.inject(currentKubeObjectInDetailsInjectable);

      return {
        Component,
        enabled: computed(() => matches(kubeObject.value.get()?.object)),
        orderNumber: 10,
      };
    },

    injectionToken: kubeObjectDetailItemInjectionToken,
  });
}
