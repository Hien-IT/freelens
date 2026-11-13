/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import podFilesTabStoreInjectable from "./tab-store.injectable";

import type { TabId } from "../../../renderer/components/dock/dock/store";

const clearPodFilesTabDataInjectable = getInjectable({
  id: "clear-pod-files-tab-data",

  instantiate: (di) => {
    const tabStore = di.inject(podFilesTabStoreInjectable);

    return (tabId: TabId): void => tabStore.clearData(tabId);
  },
});

export default clearPodFilesTabDataInjectable;
