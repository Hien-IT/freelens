/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getGlobalOverride } from "@freelensapp/test-utils";
import directoryForUserDataInjectable from "../../../../common/app-paths/directory-for-user-data/directory-for-user-data.injectable";
import joinPathsInjectable from "../../../../common/path/join-paths.injectable";
import prepareExtensionStoreInjectable from "./prepare.injectable";

/** In unit tests the store's folder is the one main would give, and its file is the fake of the file model. */
export default getGlobalOverride(prepareExtensionStoreInjectable, (di) => {
  const joinPaths = di.inject(joinPathsInjectable);
  const directoryForUserData = di.inject(directoryForUserDataInjectable);

  return ({ cwd, storeName }) => cwd ?? joinPaths(directoryForUserData, "extension-store", storeName);
});
