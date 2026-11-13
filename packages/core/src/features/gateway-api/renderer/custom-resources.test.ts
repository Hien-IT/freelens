/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { KubeObject } from "@freelensapp/kube-object";
import { describe, expect, it } from "vitest";
import { getCustomResourcesOfRegistration } from "../../../renderer/components/custom-resource-definitions/custom-resource-registration";
import customResourcesPresentedByExtensionsInjectable from "../../../renderer/components/custom-resource-definitions/custom-resources-presented-by-extensions.injectable";
import { getDiForUnitTesting } from "../../../renderer/getDiForUnitTesting";
import * as k8s from "./api/k8s";
import * as xK8s from "./api/x-k8s";
import { customResources } from "./custom-resources";
import { gatewayApiPresenterName } from "./custom-resources.injectable";

import type { GatewayApiResource } from "./api/available-resource";

// Every model class the API modules export, each once although most are
// exported under two names.
const models = [...new Set<unknown>([...Object.values(k8s), ...Object.values(xK8s)])].filter(
  (value): value is GatewayApiResource => typeof value === "function" && value.prototype instanceof KubeObject,
);

const describeModel = (model: GatewayApiResource) => `${model.kind} ${model.crd.apiVersions.join()}`;

describe("customResources", () => {
  it("lists every model, since every kind and version has a page", () => {
    const listed = new Set<unknown>(customResources);
    const missing = models
      .filter((model) => !listed.has(model))
      .map(describeModel)
      .sort();

    expect(missing).toEqual([]);
  });

  it("lists each model once", () => {
    expect(new Set(customResources).size).toBe(customResources.length);
  });

  it("lists only models whose resource can be read from the class", () => {
    for (const model of customResources) {
      expect(() => getCustomResourcesOfRegistration(model), describeModel(model)).not.toThrow();
      for (const apiVersion of model.crd.apiVersions) {
        expect(apiVersion, describeModel(model)).toMatch(/^gateway\.networking\.(x-)?k8s\.io\/v\w+$/);
      }
    }
  });

  it("leaves the resource of every model out of the Custom Resources tree, and no other", () => {
    const di = getDiForUnitTesting();
    const presented = di.inject(customResourcesPresentedByExtensionsInjectable).get();
    const presentedByGatewayApi = [...presented]
      .filter(([, presenter]) => presenter === gatewayApiPresenterName)
      .map(([key]) => key)
      .sort();
    const expected = [
      ...new Set(
        customResources
          .flatMap((model) => getCustomResourcesOfRegistration(model))
          .map(({ group, plural }) => `${group}/${plural}`),
      ),
    ].sort();

    expect(presentedByGatewayApi).toEqual(expected);
  });
});
