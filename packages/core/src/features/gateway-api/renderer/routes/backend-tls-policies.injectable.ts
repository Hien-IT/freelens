/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { backendTLSPoliciesPage } from "../pages/page-definitions";
import { createGatewayApiPageInjectables } from "./create-page-injectables";

export const {
  routeInjectable: gatewayApiBackendTLSPoliciesRouteInjectable,
  navigateInjectable: navigateToGatewayApiBackendTLSPoliciesInjectable,
  routeComponentInjectable: gatewayApiBackendTLSPoliciesRouteComponentInjectable,
  sidebarItemInjectable: gatewayApiBackendTLSPoliciesSidebarItemInjectable,
} = createGatewayApiPageInjectables({ ...backendTLSPoliciesPage, orderNumber: 110 });
