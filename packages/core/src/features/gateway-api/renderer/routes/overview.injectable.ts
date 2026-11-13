/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { OverviewPage } from "../pages/overview";
import { kindPages } from "../pages/page-definitions";
import { createGatewayApiPageInjectables } from "./create-page-injectables";

export const {
  routeInjectable: gatewayApiOverviewRouteInjectable,
  navigateInjectable: navigateToGatewayApiOverviewInjectable,
  routeComponentInjectable: gatewayApiOverviewRouteComponentInjectable,
  sidebarItemInjectable: gatewayApiOverviewSidebarItemInjectable,
} = createGatewayApiPageInjectables({
  id: "overview",
  title: "Overview",
  Component: OverviewPage,
  resources: kindPages.flatMap((page) => page.resources),
  orderNumber: 10,
});
