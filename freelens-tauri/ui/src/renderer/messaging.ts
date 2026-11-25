/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The messaging of a page of the Tauri build: a container with
// messaging-for-tauri, listening and announced to the core
// (specs/004-cluster-frames/research.md, R7).

import { registerFeature } from "@freelensapp/feature-core";
import {
  getMessageChannel,
  listeningOfChannelsInjectionToken,
  sendMessageToChannelInjectionToken,
} from "@freelensapp/messaging";
import { messagingFeatureForTauri } from "@freelensapp/messaging-for-tauri";
import { createContainer } from "@ogre-tools/injectable";
import { registerMobX } from "@ogre-tools/injectable-extension-for-mobx";
import { runInAction } from "mobx";

import type { DiContainer } from "@ogre-tools/injectable";

// Declared by id: the pages do not depend on packages/core, where it is defined.
export const frameCommunicationAdminChannel = getMessageChannel<undefined>("frame-communication-admin-channel");

export async function startMessaging(name: string): Promise<DiContainer> {
  const di = createContainer(name);

  di.permitSideEffects();
  runInAction(() => {
    registerMobX(di);
    registerFeature(di, messagingFeatureForTauri);
  });

  // What the application's start does for messaging: listen, then announce.
  // The start itself runs @freelensapp/run-many, which needs Node's
  // EventEmitter until spec 003 makes the renderer run without Node.
  await di.inject(listeningOfChannelsInjectionToken).start();
  di.inject(sendMessageToChannelInjectionToken)(frameCommunicationAdminChannel, undefined);

  return di;
}
