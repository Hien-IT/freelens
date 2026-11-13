/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import logStoreInjectable from "./store.injectable";
import logTabStoreInjectable from "./tab-store.injectable";

import type { TabId } from "../dock/store";

const clearLogTabDataInjectable = getInjectable({
  id: "clear-log-tab-data",

  instantiate: (di) => {
    const logTabStore = di.inject(logTabStoreInjectable);

    return (tabId: TabId): void => {
      // Injected only when a logs tab closes: the log store needs the pod API,
      // which the dock store, the one that injects this, does not.
      di.inject(logStoreInjectable).clearLogs(tabId);
      logTabStore.clearData(tabId);
    };
  },
});

export default clearLogTabDataInjectable;
