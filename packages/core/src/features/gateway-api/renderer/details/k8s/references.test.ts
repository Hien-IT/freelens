/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { describe, expect, it, vi } from "vitest";
import * as k8s from "../../api/k8s";
import * as xK8s from "../../api/x-k8s";
import { createFakeRegistry } from "../../test-utils/fake-registry";
import { getReferenceApiVersion } from "./references";

describe("getReferenceApiVersion", () => {
  it("links the core group to v1", () => {
    const { registry } = createFakeRegistry();
    const getApi = vi.spyOn(registry, "getApi");

    expect(getReferenceApiVersion(registry, "", "Service")).toBe("v1");
    expect(getApi).not.toHaveBeenCalled();
  });

  it("takes the first served version of a kind of the Gateway API", () => {
    const { registry, serve } = createFakeRegistry();

    serve(k8s.TCPRoute_v1);
    serve(k8s.TCPRoute_v1alpha2);

    expect(getReferenceApiVersion(registry, "gateway.networking.k8s.io", "TCPRoute")).toBe(
      "gateway.networking.k8s.io/v1",
    );
  });

  it("falls back to a later version of a modeled kind when an earlier one is not served", () => {
    const { registry, serve } = createFakeRegistry();

    serve(k8s.UDPRoute_v1alpha2);

    expect(getReferenceApiVersion(registry, "gateway.networking.k8s.io", "UDPRoute")).toBe(
      "gateway.networking.k8s.io/v1alpha2",
    );
  });

  it("links a reference to XBackend to the version the cluster serves", () => {
    const { registry, serve } = createFakeRegistry();

    serve(xK8s.XBackend_v1alpha1);

    expect(getReferenceApiVersion(registry, "gateway.networking.x-k8s.io", "XBackend")).toBe(
      "gateway.networking.x-k8s.io/v1alpha1",
    );
  });

  it("asks the registry for a kind of another group", () => {
    const { registry, register } = createFakeRegistry();

    register({
      apiGroup: "gateway.envoyproxy.io",
      kind: "Backend",
      apiVersionWithGroup: "gateway.envoyproxy.io/v1alpha1",
    });

    expect(getReferenceApiVersion(registry, "gateway.envoyproxy.io", "Backend")).toBe("gateway.envoyproxy.io/v1alpha1");
  });

  it("matches a modeled kind by its group, not by its kind alone", () => {
    const { registry, serve, register } = createFakeRegistry();

    serve(k8s.TCPRoute_v1);
    register({ apiGroup: "example.com", kind: "TCPRoute", apiVersionWithGroup: "example.com/v2" });

    expect(getReferenceApiVersion(registry, "example.com", "TCPRoute")).toBe("example.com/v2");
  });

  it("asks the registry for a modeled kind that the cluster serves in no modeled version", () => {
    const { registry, register } = createFakeRegistry();

    register({
      apiGroup: "gateway.networking.k8s.io",
      kind: "TCPRoute",
      apiVersionWithGroup: "gateway.networking.k8s.io/v2",
    });

    expect(getReferenceApiVersion(registry, "gateway.networking.k8s.io", "TCPRoute")).toBe(
      "gateway.networking.k8s.io/v2",
    );
  });

  it("returns undefined when the cluster serves no API for the group and kind", () => {
    const { registry, register } = createFakeRegistry();

    register({ apiGroup: "example.com", kind: "Other", apiVersionWithGroup: "example.com/v1" });

    expect(getReferenceApiVersion(registry, "example.com", "Backend")).toBeUndefined();
    expect(getReferenceApiVersion(registry, "gateway.networking.k8s.io", "TCPRoute")).toBeUndefined();
  });
});
