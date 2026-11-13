/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { gatewaysPage } from "../pages/page-definitions";
import { createGatewayApiPageInjectables } from "./create-page-injectables";

export const {
  routeInjectable: gatewayApiGatewaysRouteInjectable,
  navigateInjectable: navigateToGatewayApiGatewaysInjectable,
  routeComponentInjectable: gatewayApiGatewaysRouteComponentInjectable,
  sidebarItemInjectable: gatewayApiGatewaysSidebarItemInjectable,
} = createGatewayApiPageInjectables({ ...gatewaysPage, orderNumber: 30 });
