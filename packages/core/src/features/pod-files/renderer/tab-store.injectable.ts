/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import createStorageInjectable from "../../../renderer/utils/create-storage/create-storage.injectable";
import { PodFilesTabStore } from "./tab-store";

const podFilesTabStoreInjectable = getInjectable({
  id: "pod-files-tab-store",

  instantiate: (di) =>
    new PodFilesTabStore({
      createStorage: di.inject(createStorageInjectable),
    }),
});

export default podFilesTabStoreInjectable;
