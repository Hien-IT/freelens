/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { enlistMessageChannelListenerInjectionToken } from "@freelensapp/messaging";
import { getInjectable } from "@ogre-tools/injectable";
import { action } from "mobx";
import { historyCanGoBackChannel, historyCanGoForwardChannel } from "../../../../common/ipc/window";
import { beforeFrameStartsSecondInjectionToken } from "../../../before-frame-starts/tokens";
import topBarStateInjectable from "./state.injectable";

// TODO: replace with a SyncBox
const startTopbarStateSyncInjectable = getInjectable({
  id: "start-topbar-state-sync",
  instantiate: (di) => ({
    run: () => {
      const state = di.inject(topBarStateInjectable);
      const enlistMessageChannelListener = di.inject(enlistMessageChannelListenerInjectionToken);

      enlistMessageChannelListener({
        id: "top-bar-can-go-back",
        channel: historyCanGoBackChannel,
        handler: action((canGoBack: boolean) => {
          state.prevEnabled = canGoBack;
        }),
      });

      enlistMessageChannelListener({
        id: "top-bar-can-go-forward",
        channel: historyCanGoForwardChannel,
        handler: action((canGoForward: boolean) => {
          state.nextEnabled = canGoForward;
        }),
      });
    },
  }),
  injectionToken: beforeFrameStartsSecondInjectionToken,
  causesSideEffects: true,
});

export default startTopbarStateSyncInjectable;
