/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { sidebarItemsInjectable } from "@freelensapp/cluster-sidebar";
import { beforeEach, describe, expect, it } from "vitest";
import { SidebarMenuItem } from "../../../../common/sidebar-menu-items-starting-order";
import { getApplicationBuilder } from "../../../../renderer/components/test-utils/get-application-builder";
import { gatewayApiGatewaysRouteInjectable } from "./gateways.injectable";
import { gatewayApiOverviewRouteInjectable } from "./overview.injectable";
import { gatewayApiTCPRoutesRouteInjectable } from "./tcp-routes.injectable";
import { gatewayApiXMeshesRouteInjectable } from "./x-meshes.injectable";

import type { SidebarItemDeclaration } from "@freelensapp/cluster-sidebar";

import type { RenderResult } from "@testing-library/react";

import type { ApplicationBuilder } from "../../../../renderer/components/test-utils/get-application-builder";

describe("the routes and the sidebar items of the Gateway API", () => {
  let builder: ApplicationBuilder;
  let rendered: RenderResult;

  const getGatewayApiItem = () =>
    builder.applicationWindow.only.di
      .inject(sidebarItemsInjectable)
      .get()
      .find((item) => item.id === SidebarMenuItem.GatewayApi);

  const visibleChildren = (item: SidebarItemDeclaration | undefined) =>
    item?.children.filter((child) => child.isVisible.get()).map((child) => child.title);

  beforeEach(async () => {
    builder = getApplicationBuilder();
    builder.setEnvironmentToClusterFrame();
    rendered = await builder.render();
  });

  it("serves the pages under /gateway-api in the cluster frame, also without the CRDs", () => {
    const di = builder.applicationWindow.only.di;

    for (const [injectable, path] of [
      [gatewayApiOverviewRouteInjectable, "/gateway-api/overview"],
      [gatewayApiGatewaysRouteInjectable, "/gateway-api/gateways"],
      [gatewayApiTCPRoutesRouteInjectable, "/gateway-api/tcproutes"],
      [gatewayApiXMeshesRouteInjectable, "/gateway-api/xmeshes"],
    ] as const) {
      const route = di.inject(injectable);

      expect(route.path).toBe(path);
      expect(route.clusterFrame).toBe(true);
      expect(route.isEnabled.get()).toBe(true);
    }
  });

  it("lists Overview and the kinds in the order of the extension it replaces", () => {
    expect(getGatewayApiItem()?.children.map((child) => child.title)).toEqual([
      "Overview",
      "Gateway Classes",
      "Gateways",
      "HTTP Routes",
      "gRPC Routes",
      "TCP Routes",
      "TLS Routes",
      "UDP Routes",
      "Reference Grants",
      "Listener Sets",
      "Backend TLS Policies",
      "Backend Traffic Policies",
      "Backends",
      "Meshes",
    ]);
  });

  it("hides the Gateway API item while the cluster serves none of its resources", () => {
    expect(getGatewayApiItem()?.isVisible.get()).toBe(false);
    expect(rendered.queryByTestId(SidebarMenuItem.GatewayApi)).toBeNull();
  });

  describe("when the cluster serves some of its resources", () => {
    beforeEach(() => {
      builder.allowKubeResource({ group: "gateway.networking.k8s.io", apiName: "gateways" });
      builder.allowKubeResource({ group: "gateway.networking.x-k8s.io", apiName: "xmeshes" });
    });

    it("shows the Gateway API item with Overview and the kinds the cluster serves", () => {
      const item = getGatewayApiItem();

      expect(item?.isVisible.get()).toBe(true);
      expect(visibleChildren(item)).toEqual(["Overview", "Gateways", "Meshes"]);
      expect(rendered.queryByTestId(SidebarMenuItem.GatewayApi)).not.toBeNull();
    });
  });
});
