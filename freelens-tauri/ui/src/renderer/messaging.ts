/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The messaging of a page of the Tauri build: a container with
// messaging-for-tauri, listening and announced to the core
// (specs/004-cluster-frames/research.md, R7).

import { registerFeature } from "@freelensapp/feature-core";
import {
  enlistMessageChannelListenerInjectionToken,
  getMessageChannel,
  getRequestChannel,
  listeningOfChannelsInjectionToken,
  sendMessageToChannelInjectionToken,
} from "@freelensapp/messaging";
import { messagingFeatureForTauri } from "@freelensapp/messaging-for-tauri";
import { createContainer } from "@ogre-tools/injectable";
import { registerMobX } from "@ogre-tools/injectable-extension-for-mobx";
import { runInAction } from "mobx";

import type { DiContainer } from "@ogre-tools/injectable";

// Declared by id: the pages do not depend on packages/core, where they are defined.
export const frameCommunicationAdminChannel = getMessageChannel<undefined>("frame-communication-admin-channel");
// A cluster frame announces itself with its own cluster's id (FR-016).
export const setClusterFrameIdChannel = getRequestChannel<string, void>("cluster:set-frame-id");
// The main window names the visible cluster, or none (FR-017).
export const currentVisibleClusterChannel = getMessageChannel<string | undefined>("current-visible-cluster");

/** The view of this page: `main`, or the id of its cluster, read from its own host. */
export const viewOfPage = (): string =>
  location.hostname === "renderer.freelens.app" ? "main" : location.hostname.split(".")[0];

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
  // messaging-for-tauri polls only once a listener is enlisted (research R3 of
  // spec 002), and the core has a queue for a view only while it polls: without
  // one, it cannot tell a closed frame or a reloaded main window (research R5).
  // These pages have no listener of their own, so they listen on a channel
  // that only views send, which keeps the poll running and does nothing else.
  di.inject(enlistMessageChannelListenerInjectionToken)({
    id: "keep-polling",
    channel: frameCommunicationAdminChannel,
    handler: () => {},
  });
  di.inject(sendMessageToChannelInjectionToken)(frameCommunicationAdminChannel, undefined);

  return di;
}
