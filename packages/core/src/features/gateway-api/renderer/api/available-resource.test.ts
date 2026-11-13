/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { describe, expect, it } from "vitest";
import { createFakeRegistry, createRouteClass } from "../test-utils/fake-registry";
import { getAvailableResource, getAvailableStore } from "./available-resource";

const Route_v1 = createRouteClass("example.com/v1");
const Route_v1alpha2 = createRouteClass("example.com/v1alpha2");

describe("getAvailableStore", () => {
  it("returns the store of the first served version of the class", () => {
    const { registry, serve } = createFakeRegistry();
    const store = serve(Route_v1);

    expect(getAvailableStore(registry, Route_v1)).toBe(store);
  });

  it("returns undefined when the version is not served", () => {
    const { registry, serve } = createFakeRegistry();

    serve(Route_v1alpha2);

    expect(getAvailableStore(registry, Route_v1)).toBeUndefined();
  });
});

describe("getAvailableResource", () => {
  it("returns the first version that has a store, with its store", () => {
    const { registry, serve } = createFakeRegistry();
    const store = serve(Route_v1);

    serve(Route_v1alpha2);

    expect(getAvailableResource(registry, [Route_v1, Route_v1alpha2])).toEqual({ resource: Route_v1, store });
  });

  it("falls back to a later version when an earlier one is not served", () => {
    const { registry, serve } = createFakeRegistry();
    const store = serve(Route_v1alpha2);

    expect(getAvailableResource(registry, [Route_v1, Route_v1alpha2])).toEqual({ resource: Route_v1alpha2, store });
  });

  it("returns undefined when no version is served", () => {
    const { registry } = createFakeRegistry();

    expect(getAvailableResource(registry, [Route_v1, Route_v1alpha2])).toBeUndefined();
    expect(getAvailableResource(registry, [])).toBeUndefined();
  });
});
