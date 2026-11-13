/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { listenerSetsPage } from "../pages/page-definitions";
import { createGatewayApiPageInjectables } from "./create-page-injectables";

export const {
  routeInjectable: gatewayApiListenerSetsRouteInjectable,
  navigateInjectable: navigateToGatewayApiListenerSetsInjectable,
  routeComponentInjectable: gatewayApiListenerSetsRouteComponentInjectable,
  sidebarItemInjectable: gatewayApiListenerSetsSidebarItemInjectable,
} = createGatewayApiPageInjectables({ ...listenerSetsPage, orderNumber: 100 });
