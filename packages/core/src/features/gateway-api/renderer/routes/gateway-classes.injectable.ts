/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { gatewayClassesPage } from "../pages/page-definitions";
import { createGatewayApiPageInjectables } from "./create-page-injectables";

export const {
  routeInjectable: gatewayApiGatewayClassesRouteInjectable,
  navigateInjectable: navigateToGatewayApiGatewayClassesInjectable,
  routeComponentInjectable: gatewayApiGatewayClassesRouteComponentInjectable,
  sidebarItemInjectable: gatewayApiGatewayClassesSidebarItemInjectable,
} = createGatewayApiPageInjectables({ ...gatewayClassesPage, orderNumber: 20 });
