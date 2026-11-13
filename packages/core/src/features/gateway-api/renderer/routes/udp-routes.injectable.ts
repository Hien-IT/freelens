/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { udpRoutesPage } from "../pages/page-definitions";
import { createGatewayApiPageInjectables } from "./create-page-injectables";

export const {
  routeInjectable: gatewayApiUDPRoutesRouteInjectable,
  navigateInjectable: navigateToGatewayApiUDPRoutesInjectable,
  routeComponentInjectable: gatewayApiUDPRoutesRouteComponentInjectable,
  sidebarItemInjectable: gatewayApiUDPRoutesSidebarItemInjectable,
} = createGatewayApiPageInjectables({ ...udpRoutesPage, orderNumber: 80 });
