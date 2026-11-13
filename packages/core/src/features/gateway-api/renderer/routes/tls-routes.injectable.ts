/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { tlsRoutesPage } from "../pages/page-definitions";
import { createGatewayApiPageInjectables } from "./create-page-injectables";

export const {
  routeInjectable: gatewayApiTLSRoutesRouteInjectable,
  navigateInjectable: navigateToGatewayApiTLSRoutesInjectable,
  routeComponentInjectable: gatewayApiTLSRoutesRouteComponentInjectable,
  sidebarItemInjectable: gatewayApiTLSRoutesSidebarItemInjectable,
} = createGatewayApiPageInjectables({ ...tlsRoutesPage, orderNumber: 70 });
