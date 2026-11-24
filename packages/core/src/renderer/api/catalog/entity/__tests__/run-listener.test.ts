/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { testUtils } from "@freelensapp/messaging";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDiForUnitTesting } from "../../../../getDiForUnitTesting";
import currentlyInClusterFrameInjectable from "../../../../routes/currently-in-cluster-frame.injectable";
import catalogEntityRegistryInjectable from "../registry.injectable";

import type { DiContainer } from "@ogre-tools/injectable";

describe("catalog entity registry, listening for runs of an entity", () => {
  let di: DiContainer;
  let enlistedIds: () => (string | undefined)[];

  beforeEach(() => {
    di = getDiForUnitTesting();

    // the stub takes no argument in its type, so the listener is optional here
    const enlist = vi.fn((_listener?: { id: string }) => () => {});

    di.override(testUtils.enlistMessageChannelListenerStubInjectable, () => enlist);
    enlistedIds = () => enlist.mock.calls.map(([listener]) => listener?.id);
  });

  it("listens in the root frame", () => {
    di.override(currentlyInClusterFrameInjectable, () => false);
    di.inject(catalogEntityRegistryInjectable).init();

    expect(enlistedIds()).toEqual(["catalog-items", "catalog-entity-run"]);
  });

  it("does not listen in a cluster frame", () => {
    di.override(currentlyInClusterFrameInjectable, () => true);
    di.inject(catalogEntityRegistryInjectable).init();

    expect(enlistedIds()).toEqual(["catalog-items"]);
  });
});
