/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import podFilesTabStoreInjectable from "./tab-store.injectable";

import type { TabId } from "../../../renderer/components/dock/dock/store";

/**
 * A restored tab whose data is gone, or was stored by an incompatible
 * version, is closed rather than shown broken.
 */
const isPodFilesTabDataValidInjectable = getInjectable({
  id: "is-pod-files-tab-data-valid",

  instantiate: (di) => {
    const tabStore = di.inject(podFilesTabStoreInjectable);

    return (tabId: TabId): boolean => {
      const data = tabStore.getData(tabId);

      return (
        typeof data?.namespace === "string" &&
        typeof data.pod === "string" &&
        typeof data.container === "string" &&
        typeof data.directory === "string" &&
        Array.isArray(data.containers)
      );
    };
  },
});

export default isPodFilesTabDataValidInjectable;
