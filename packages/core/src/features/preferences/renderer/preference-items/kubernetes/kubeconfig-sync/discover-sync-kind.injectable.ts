/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { requestFromChannelInjectionToken } from "@freelensapp/messaging";
import { getInjectable } from "@ogre-tools/injectable";
import { discoverKubeconfigSyncKindChannel } from "../../../../../kubeconfig-sync-kind/common/channel";

export interface SyncKind {
  type: "file" | "folder" | "unknown";
}

export type DiscoverKubeconfigSyncKind = (path: string) => Promise<[string, SyncKind]>;

/** Main reads the kind of the path, and logs what it cannot tell. */
const discoverKubeconfigSyncKindInjectable = getInjectable({
  id: "discover-kubeconfig-sync-kind",
  instantiate: (di): DiscoverKubeconfigSyncKind => {
    const requestFromChannel = di.inject(requestFromChannelInjectionToken);

    return async (path) => {
      const answer = await requestFromChannel(discoverKubeconfigSyncKindChannel, path);

      if ("kind" in answer) {
        return [path, { type: answer.kind === "dir" ? "folder" : "file" }];
      }

      return [path, { type: "unknown" }];
    };
  },
});

export default discoverKubeconfigSyncKindInjectable;
