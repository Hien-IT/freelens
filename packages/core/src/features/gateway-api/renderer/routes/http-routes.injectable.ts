/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { httpRoutesPage } from "../pages/page-definitions";
import { createGatewayApiPageInjectables } from "./create-page-injectables";

export const {
  routeInjectable: gatewayApiHTTPRoutesRouteInjectable,
  navigateInjectable: navigateToGatewayApiHTTPRoutesInjectable,
  routeComponentInjectable: gatewayApiHTTPRoutesRouteComponentInjectable,
  sidebarItemInjectable: gatewayApiHTTPRoutesSidebarItemInjectable,
} = createGatewayApiPageInjectables({ ...httpRoutesPage, orderNumber: 40 });
