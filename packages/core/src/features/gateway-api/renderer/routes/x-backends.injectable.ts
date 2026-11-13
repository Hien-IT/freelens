/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { xBackendsPage } from "../pages/page-definitions";
import { createGatewayApiPageInjectables } from "./create-page-injectables";

export const {
  routeInjectable: gatewayApiXBackendsRouteInjectable,
  navigateInjectable: navigateToGatewayApiXBackendsInjectable,
  routeComponentInjectable: gatewayApiXBackendsRouteComponentInjectable,
  sidebarItemInjectable: gatewayApiXBackendsSidebarItemInjectable,
} = createGatewayApiPageInjectables({ ...xBackendsPage, orderNumber: 130 });
