/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { broadcastMessageImplementationInjectionToken } from "./broadcast-message-implementation-token";

export type BroadcastMessage = (channel: string, ...args: any[]) => Promise<void>;

const broadcastMessageInjectable = getInjectable({
  id: "broadcast-message",
  // Each process has its implementation on messaging (specs/002-messaging-for-tauri, research R11).
  instantiate: (di): BroadcastMessage => di.inject(broadcastMessageImplementationInjectionToken),
  causesSideEffects: true,
});

export default broadcastMessageInjectable;
