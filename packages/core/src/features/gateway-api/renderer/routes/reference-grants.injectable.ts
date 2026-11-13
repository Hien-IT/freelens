/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { referenceGrantsPage } from "../pages/page-definitions";
import { createGatewayApiPageInjectables } from "./create-page-injectables";

export const {
  routeInjectable: gatewayApiReferenceGrantsRouteInjectable,
  navigateInjectable: navigateToGatewayApiReferenceGrantsInjectable,
  routeComponentInjectable: gatewayApiReferenceGrantsRouteComponentInjectable,
  sidebarItemInjectable: gatewayApiReferenceGrantsSidebarItemInjectable,
} = createGatewayApiPageInjectables({ ...referenceGrantsPage, orderNumber: 90 });
