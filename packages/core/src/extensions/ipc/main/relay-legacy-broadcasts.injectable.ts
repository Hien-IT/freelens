/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { onLoadOfApplicationInjectionToken } from "@freelensapp/application";
import { getInjectable } from "@ogre-tools/injectable";
import { ipcMain } from "electron";
import { broadcastMainChannel } from "../common/broadcast-main-channel";
import { broadcastFromMain, ipcMainHandle } from "./legacy-ipc";

// The legacy relay of a view's broadcast, which the extension system's
// \`broadcast\` uses with several arguments. The core's own broadcasts use the
// typed \`broadcast-to-views\` (specs/002-messaging-for-tauri, research R11).
const relayLegacyBroadcastsInjectable = getInjectable({
  id: "relay-legacy-broadcasts",

  instantiate: () => ({
    run: () => {
      // Registered in both processes, as the extension tree is; only main relays.
      if (!ipcMain) {
        return;
      }

      ipcMainHandle(broadcastMainChannel, (event, channel, ...args) => broadcastFromMain(channel, ...args));
    },
  }),

  injectionToken: onLoadOfApplicationInjectionToken,
  causesSideEffects: true,
});

export default relayLegacyBroadcastsInjectable;
