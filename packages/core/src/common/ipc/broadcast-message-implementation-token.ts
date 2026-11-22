/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectionToken } from "@ogre-tools/injectable";

import type { BroadcastMessage } from "./broadcast-message.injectable";

/** How each process broadcasts to every view; `broadcastMessageInjectable` delegates to it. */
export const broadcastMessageImplementationInjectionToken = getInjectionToken<BroadcastMessage>({
  id: "broadcast-message-implementation",
});
