/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannel } from "@freelensapp/messaging";

import type { ClusterId } from "../cluster-types";

// Typed channels of the legacy shell token requests (specs/002-messaging-for-tauri, research R11).
// The token is binary, so the Tauri build needs another type for it (contracts/channel-list.md).
export const clusterShellTokenChannel = getRequestChannel<[clusterId: ClusterId, tabId: string], Uint8Array>(
  "cluster:shell-api",
);
export const standaloneShellTokenChannel = getRequestChannel<string, Uint8Array>("app:standalone-shell-api");
