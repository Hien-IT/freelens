/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { requestFromChannelInjectionToken, sendMessageToChannelInjectionToken } from "@freelensapp/messaging";
import { setClusterFrameIdChannel } from "../../common/ipc/cluster";
import {
  locationChangedChannel,
  openAppMenuAsContextMenuChannel,
  type WindowAction,
  windowActionChannel,
} from "../../common/ipc/window";
import { toJS } from "../../common/utils";
import { getDiForExtensionApi } from "../../extensions/extension-api-di";

import type { Location } from "@freelensapp/routing";

import type { ClusterId } from "../../common/cluster-types";

export function emitOpenAppMenuAsContextMenu(): void {
  getDiForExtensionApi().inject(sendMessageToChannelInjectionToken)(openAppMenuAsContextMenuChannel);
}

// `Partial<Location>` accepts both the history v5 `Location` and the
// `mobx-observable-history` (history v4) location object; the payload is only
// serialized and forwarded, the main process ignores its contents.
export function emitWindowLocationChanged(location: Partial<Location>): void {
  getDiForExtensionApi().inject(sendMessageToChannelInjectionToken)(locationChangedChannel, toJS(location));
}

export function requestWindowAction(type: WindowAction): Promise<void> {
  return getDiForExtensionApi().inject(requestFromChannelInjectionToken)(windowActionChannel, type);
}

export function requestSetClusterFrameId(clusterId: ClusterId): Promise<void> {
  return getDiForExtensionApi().inject(requestFromChannelInjectionToken)(setClusterFrameIdChannel, clusterId);
}
