/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { loggerInjectionToken } from "@freelensapp/logger";
import { getRequestChannelListenerInjectable } from "@freelensapp/messaging";
import statInjectable from "../../../common/fs/main/stat.injectable";
import { discoverKubeconfigSyncKindChannel } from "../common/channel";

const discoverKubeconfigSyncKindListenerInjectable = getRequestChannelListenerInjectable({
  id: "discover-kubeconfig-sync-kind-listener",
  channel: discoverKubeconfigSyncKindChannel,
  getHandler: (di) => {
    const stat = di.inject(statInjectable);
    const logger = di.inject(loggerInjectionToken);

    return async (path) => {
      try {
        // stat follows the stat(2) linux syscall spec, namely it follows symlinks
        const stats = await stat(path);

        if (stats.isFile()) {
          return { kind: "file" };
        }

        if (stats.isDirectory()) {
          return { kind: "dir" };
        }

        logger.warn("[KUBECONFIG-SYNCS]: unknown stat entry", { stats });

        return { error: "unknown stat entry" };
      } catch (error) {
        logger.warn(`[KUBECONFIG-SYNCS]: failed to stat entry: ${error}`, { error });

        return { error: String(error) };
      }
    };
  },
});

export default discoverKubeconfigSyncKindListenerInjectable;
