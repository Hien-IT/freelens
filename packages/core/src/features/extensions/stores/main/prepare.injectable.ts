/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import directoryForUserDataInjectable from "../../../../common/app-paths/directory-for-user-data/directory-for-user-data.injectable";
import joinPathsInjectable from "../../../../common/path/join-paths.injectable";
import { prepareExtensionStoreInjectionToken } from "../common/prepare";

const prepareExtensionStoreInjectable = getInjectable({
  id: "prepare-extension-store-for-main",
  instantiate: (di) => {
    const joinPaths = di.inject(joinPathsInjectable);
    const directoryForUserData = di.inject(directoryForUserDataInjectable);

    return ({ cwd, storeName }) => cwd ?? joinPaths(directoryForUserData, "extension-store", storeName);
  },
  injectionToken: prepareExtensionStoreInjectionToken,
});

export default prepareExtensionStoreInjectable;
