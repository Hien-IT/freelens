/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { sidebarItemInjectionToken } from "@freelensapp/cluster-sidebar";
import { getInjectable } from "@ogre-tools/injectable";
import { noop } from "es-toolkit";
import { SidebarMenuItem, sidebarMenuItemIds } from "../../../../common/sidebar-menu-items-starting-order";
import { getClusterPageMenuOrderInjectable } from "../../../user-preferences/common/cluster-page-menu-order.injectable";
import { GatewayApiIcon } from "../components/gateway-api-icon";

const id = SidebarMenuItem.GatewayApi;

/**
 * The top-level "Gateway API" item. It has no page of its own and is visible
 * while any of its children is, that is while the cluster serves any kind of the
 * Gateway API.
 */
const gatewayApiSidebarItemInjectable = getInjectable({
  id,

  instantiate: (di) => {
    const getClusterPageMenuOrder = di.inject(getClusterPageMenuOrderInjectable);

    return {
      parentId: null,
      getIcon: () => <GatewayApiIcon />,
      title: "Gateway API",
      onClick: noop,
      orderNumber: getClusterPageMenuOrder(id, sidebarMenuItemIds[id]),
    };
  },

  injectionToken: sidebarItemInjectionToken,
});

export default gatewayApiSidebarItemInjectable;
