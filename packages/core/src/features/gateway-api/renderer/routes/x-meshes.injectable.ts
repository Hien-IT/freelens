/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { xMeshesPage } from "../pages/page-definitions";
import { createGatewayApiPageInjectables } from "./create-page-injectables";

export const {
  routeInjectable: gatewayApiXMeshesRouteInjectable,
  navigateInjectable: navigateToGatewayApiXMeshesInjectable,
  routeComponentInjectable: gatewayApiXMeshesRouteComponentInjectable,
  sidebarItemInjectable: gatewayApiXMeshesSidebarItemInjectable,
} = createGatewayApiPageInjectables({ ...xMeshesPage, orderNumber: 140 });
