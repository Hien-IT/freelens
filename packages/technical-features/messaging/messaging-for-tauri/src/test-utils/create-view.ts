/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { registerFeature } from "@freelensapp/feature-core";
import { createContainer } from "@ogre-tools/injectable";
import { registerMobX } from "@ogre-tools/injectable-extension-for-mobx";
import { runInAction } from "mobx";
import { messagingFeatureForTauri } from "../feature";

import type { DiContainer } from "@ogre-tools/injectable";

import type { CoreFake } from "./get-core-fake";

/** A view container with messaging-for-tauri, connected to the fake core as the view of `host`. */
export const createView = (core: CoreFake, host: string): DiContainer => {
  const di = createContainer(host);

  registerMobX(di);

  runInAction(() => {
    registerFeature(di, messagingFeatureForTauri);
  });

  core.involve(di, host);

  return di;
};
