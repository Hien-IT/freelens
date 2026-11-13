/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { xBackendTrafficPoliciesPage } from "../pages/page-definitions";
import { createGatewayApiPageInjectables } from "./create-page-injectables";

export const {
  routeInjectable: gatewayApiXBackendTrafficPoliciesRouteInjectable,
  navigateInjectable: navigateToGatewayApiXBackendTrafficPoliciesInjectable,
  routeComponentInjectable: gatewayApiXBackendTrafficPoliciesRouteComponentInjectable,
  sidebarItemInjectable: gatewayApiXBackendTrafficPoliciesSidebarItemInjectable,
} = createGatewayApiPageInjectables({ ...xBackendTrafficPoliciesPage, orderNumber: 120 });
