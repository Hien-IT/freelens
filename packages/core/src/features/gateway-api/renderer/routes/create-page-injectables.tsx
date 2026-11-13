/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { sidebarItemInjectionToken } from "@freelensapp/cluster-sidebar";
import { computedOr } from "@freelensapp/utilities";
import { getInjectable } from "@ogre-tools/injectable";
import { computed } from "mobx";
import { frontEndRouteInjectionToken } from "../../../../common/front-end-routing/front-end-route-injection-token";
import { navigateToRouteInjectionToken } from "../../../../common/front-end-routing/navigate-to-route-injection-token";
import { getCustomResourcesOfRegistration } from "../../../../renderer/components/custom-resource-definitions/custom-resource-registration";
import { SiblingsInTabLayout } from "../../../../renderer/components/layout/siblings-in-tab-layout";
import routeIsActiveInjectable from "../../../../renderer/routes/route-is-active.injectable";
import { routeSpecificComponentInjectionToken } from "../../../../renderer/routes/route-specific-component-injection-token";
import { shouldShowResourceInjectionToken } from "../../../cluster/showing-kube-resources/common/allowed-resources-injection-token";
import { getGatewayApiPagePath } from "../pages/page-paths";
import gatewayApiSidebarItemInjectable from "../sidebar/gateway-api-sidebar-item.injectable";

import type React from "react";

import type { GatewayApiResource } from "../api/available-resource";

export interface GatewayApiPageInjectablesOptions {
  /** `overview` or the plural of the kind, the last segment of the path of the page. */
  id: string;
  title: string;
  Component: React.ComponentType;
  /** The model classes whose resources make the page's sidebar item visible when the cluster serves any of them. */
  resources: GatewayApiResource[];
  orderNumber: number;
}

/**
 * The route of a page of the Gateway API, how to navigate to it, its component and its item under "Gateway API" in
 * the sidebar.
 *
 * The route is always enabled, so that the page tells that the CRDs are not installed rather than not being found.
 * The item is visible while the cluster serves, and the user can list, any of the resources of the page.
 */
export function createGatewayApiPageInjectables({
  id,
  title,
  Component,
  resources,
  orderNumber,
}: GatewayApiPageInjectablesOptions) {
  const routeInjectable = getInjectable({
    id: `gateway-api-${id}-route`,

    instantiate: () => ({
      path: getGatewayApiPagePath(id),
      clusterFrame: true,
      isEnabled: computed(() => true),
    }),

    injectionToken: frontEndRouteInjectionToken,
  });

  const navigateInjectable = getInjectable({
    id: `navigate-to-gateway-api-${id}`,

    instantiate: (di) => {
      const navigateToRoute = di.inject(navigateToRouteInjectionToken);
      const route = di.inject(routeInjectable);

      return () => navigateToRoute(route);
    },
  });

  const RouteComponent = () => (
    <SiblingsInTabLayout>
      <Component />
    </SiblingsInTabLayout>
  );

  const routeComponentInjectable = getInjectable({
    id: `gateway-api-${id}-route-component`,

    instantiate: (di) => ({
      route: di.inject(routeInjectable),
      Component: RouteComponent,
    }),

    injectionToken: routeSpecificComponentInjectionToken,
  });

  const sidebarItemInjectable = getInjectable({
    id: `sidebar-item-gateway-api-${id}`,

    instantiate: (di) => {
      const route = di.inject(routeInjectable);
      // The versions of a kind share their group and plural.
      const resourceKeys = new Map(
        resources
          .flatMap((resource) => getCustomResourcesOfRegistration(resource))
          .map(({ group, plural }) => [`${group}/${plural}`, { group, apiName: plural }]),
      );

      return {
        parentId: gatewayApiSidebarItemInjectable.id,
        title,
        onClick: di.inject(navigateInjectable),
        isActive: di.inject(routeIsActiveInjectable, route),
        isVisible: computedOr(
          ...Array.from(resourceKeys.values(), (resource) => di.inject(shouldShowResourceInjectionToken, resource)),
        ),
        orderNumber,
      };
    },

    injectionToken: sidebarItemInjectionToken,
  });

  return { routeInjectable, navigateInjectable, routeComponentInjectable, sidebarItemInjectable };
}
