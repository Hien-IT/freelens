/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { loggerInjectionToken } from "@freelensapp/logger";
import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import apiManagerInjectable from "../../../../common/k8s-api/api-manager/manager.injectable";
import { renderFor } from "../../../../renderer/components/test-utils/renderFor";
import { getDiForUnitTesting } from "../../../../renderer/getDiForUnitTesting";
import { createFakeRegistry, createRouteClass } from "../test-utils/fake-registry";
import { createAvailableVersionPage } from "./available-version";

import type { ApiManager } from "../../../../common/k8s-api/api-manager";
import type { DiRender } from "../../../../renderer/components/test-utils/renderFor";
import type { GatewayPageProps } from "./available-version";

const Route_v1 = createRouteClass("example.com/v1");
const Route_v1alpha2 = createRouteClass("example.com/v1alpha2");

// Each version's page shows the API version of the store it is given.
const versionPage = (version: string) => (props: GatewayPageProps) => (
  <span>
    {version} page of {(props.store as unknown as { apiVersion: string }).apiVersion}
  </span>
);

const RoutesPage = createAvailableVersionPage("Routes", [
  { resource: Route_v1, PageComponent: versionPage("v1"), version: "v1" },
  { resource: Route_v1alpha2, PageComponent: versionPage("v1alpha2"), version: "v1alpha2" },
]);

describe("createAvailableVersionPage", () => {
  let render: DiRender;
  let fakeRegistry: ReturnType<typeof createFakeRegistry>;

  beforeEach(() => {
    const di = getDiForUnitTesting();

    fakeRegistry = createFakeRegistry();
    di.override(apiManagerInjectable, () => fakeRegistry.registry as unknown as ApiManager);
    di.override(loggerInjectionToken, () => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      silly: vi.fn(),
      warn: vi.fn(),
    }));
    render = renderFor(di);
  });

  it("renders the first version that has a store, with its store", () => {
    fakeRegistry.serve(Route_v1);
    fakeRegistry.serve(Route_v1alpha2);

    const { getByText, queryByText } = render(<RoutesPage />);

    expect(getByText("v1 page of example.com/v1")).toBeDefined();
    expect(queryByText(/v1alpha2 page/)).toBeNull();
  });

  it("falls back to a later version when an earlier one has no store", () => {
    fakeRegistry.serve(Route_v1alpha2);

    const { getByText } = render(<RoutesPage />);

    expect(getByText("v1alpha2 page of example.com/v1alpha2")).toBeDefined();
  });

  it("renders the not available page with the versions it tried when no version has a store", () => {
    const { getByText } = render(<RoutesPage />);

    expect(getByText("Routes Not Available")).toBeDefined();
    expect(getByText("v1, v1alpha2")).toBeDefined();
  });

  it("renders the version's page once the registry serves it after the first render", () => {
    const { getByText, queryByText } = render(<RoutesPage />);

    expect(getByText("Routes Not Available")).toBeDefined();

    act(() => {
      fakeRegistry.serve(Route_v1);
    });

    expect(getByText("v1 page of example.com/v1")).toBeDefined();
    expect(queryByText("Routes Not Available")).toBeNull();
  });
});
