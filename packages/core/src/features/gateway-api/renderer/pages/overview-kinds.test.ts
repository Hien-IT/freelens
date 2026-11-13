/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { KubeObject } from "@freelensapp/kube-object";
import { describe, expect, it } from "vitest";
import { getAvailableResource } from "../api/available-resource";
import * as k8s from "../api/k8s";
import * as xK8s from "../api/x-k8s";
import { createFakeRegistry } from "../test-utils/fake-registry";
import { kinds } from "./overview-kinds";

import type { GatewayApiResource } from "../api/available-resource";

// Every model class the API modules export, each once although most are
// exported under two names.
const models = [...new Set<unknown>([...Object.values(k8s), ...Object.values(xK8s)])].filter(
  (value): value is GatewayApiResource => typeof value === "function" && value.prototype instanceof KubeObject,
);

describe("kinds", () => {
  it("holds the versions of one kind in each entry", () => {
    for (const versions of kinds) {
      expect(new Set(versions.map((resource) => resource.kind)).size).toBe(1);
      expect(new Set(versions.map((resource) => resource.crd.plural)).size).toBe(1);
    }
  });

  it("lists each kind once, so its chart has a unique key", () => {
    const plurals = kinds.map((versions) => versions[0].crd.plural);

    expect(new Set(plurals).size).toBe(plurals.length);
  });

  it("lists every model except ReferenceGrant, which has no status", () => {
    const listed = new Set<GatewayApiResource>(kinds.flat());
    const missing = models
      .filter((model) => !listed.has(model))
      .map((model) => `${model.kind} ${model.crd.apiVersions.join()}`)
      .sort();

    expect(missing).toEqual([
      "ReferenceGrant gateway.networking.k8s.io/v1",
      "ReferenceGrant gateway.networking.k8s.io/v1beta1",
    ]);
  });

  it("prefers v1 to v1alpha2 for TCPRoute and UDPRoute, as the cluster pages do", () => {
    const versionsOf = (kind: string) =>
      kinds.find((versions) => versions[0].kind === kind)?.map((resource) => resource.crd.apiVersions.join());

    expect(versionsOf("TCPRoute")).toEqual(["gateway.networking.k8s.io/v1", "gateway.networking.k8s.io/v1alpha2"]);
    expect(versionsOf("UDPRoute")).toEqual(["gateway.networking.k8s.io/v1", "gateway.networking.k8s.io/v1alpha2"]);
  });

  it("shows a kind served in v1 and v1alpha2 once, from v1", () => {
    const { registry, serve } = createFakeRegistry();
    const store = serve(k8s.TCPRoute_v1);

    serve(k8s.TCPRoute_v1alpha2);

    const shown = kinds.map((versions) => getAvailableResource(registry, versions)).filter((available) => available);

    expect(shown).toEqual([{ resource: k8s.TCPRoute_v1, store }]);
  });

  it("shows a kind served in v1alpha2 only from v1alpha2", () => {
    const { registry, serve } = createFakeRegistry();
    const store = serve(k8s.UDPRoute_v1alpha2);

    const shown = kinds.map((versions) => getAvailableResource(registry, versions)).filter((available) => available);

    expect(shown).toEqual([{ resource: k8s.UDPRoute_v1alpha2, store }]);
  });
});
