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
import navigateToTrafficMapInjectable from "./navigate-to-traffic-map.injectable";
import trafficMapRouteInjectable from "./traffic-map-route.injectable";

const id = SidebarMenuItem.TrafficMap;

const trafficMapSidebarItemInjectable = getInjectable({
  id,

  instantiate: (di) => {
    const route = di.inject(trafficMapRouteInjectable);
    const getClusterPageMenuOrder = di.inject(getClusterPageMenuOrderInjectable);

    return {
      parentId: null,
      getIcon: () => <Icon material="device_hub" />,
      title: "Traffic Map",
      onClick: di.inject(navigateToTrafficMapInjectable),
      isActive: di.inject(routeIsActiveInjectable, route),
      isVisible: route.isEnabled,
      orderNumber: getClusterPageMenuOrder(id, sidebarMenuItemIds[id]),
    };
  },

  injectionToken: sidebarItemInjectionToken,
});

export default trafficMapSidebarItemInjectable;
