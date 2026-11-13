/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { sidebarItemInjectionToken } from "@freelensapp/cluster-sidebar";
import { Icon } from "@freelensapp/icon";
import { getInjectable } from "@ogre-tools/injectable";
import { SidebarMenuItem, sidebarMenuItemIds } from "../../../common/sidebar-menu-items-starting-order";
import routeIsActiveInjectable from "../../../renderer/routes/route-is-active.injectable";
import { getClusterPageMenuOrderInjectable } from "../../user-preferences/common/cluster-page-menu-order.injectable";
import navigateToResourceMapInjectable from "./navigate-to-resource-map.injectable";
import resourceMapRouteInjectable from "./resource-map-route.injectable";

const id = SidebarMenuItem.ResourceMap;

const resourceMapSidebarItemInjectable = getInjectable({
  id,

  instantiate: (di) => {
    const route = di.inject(resourceMapRouteInjectable);
    const getClusterPageMenuOrder = di.inject(getClusterPageMenuOrderInjectable);

    return {
      parentId: null,
      getIcon: () => <Icon material="bubble_chart" />,
      title: "Resource Map",
      onClick: di.inject(navigateToResourceMapInjectable),
      isActive: di.inject(routeIsActiveInjectable, route),
      isVisible: route.isEnabled,
      orderNumber: getClusterPageMenuOrder(id, sidebarMenuItemIds[id]),
    };
  },

  injectionToken: sidebarItemInjectionToken,
});

export default resourceMapSidebarItemInjectable;
