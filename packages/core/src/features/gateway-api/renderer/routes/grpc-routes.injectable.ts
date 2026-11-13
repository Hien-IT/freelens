/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { grpcRoutesPage } from "../pages/page-definitions";
import { createGatewayApiPageInjectables } from "./create-page-injectables";

export const {
  routeInjectable: gatewayApiGRPCRoutesRouteInjectable,
  navigateInjectable: navigateToGatewayApiGRPCRoutesInjectable,
  routeComponentInjectable: gatewayApiGRPCRoutesRouteComponentInjectable,
  sidebarItemInjectable: gatewayApiGRPCRoutesSidebarItemInjectable,
} = createGatewayApiPageInjectables({ ...grpcRoutesPage, orderNumber: 50 });
