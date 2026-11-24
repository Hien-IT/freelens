/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import directoryForLensLocalStorageInjectable from "../../../common/directory-for-lens-local-storage/directory-for-lens-local-storage.injectable";
import joinPathsInjectable from "../../../common/path/join-paths.injectable";
import getClusterByIdInjectable from "../../cluster/storage/common/get-by-id.injectable";

import type { ClusterId } from "../../../common/cluster-types";

/** The file of a frame's state; main computes it, and only for a cluster it has. */
const lensLocalStorageFilePathInjectable = getInjectable({
  id: "lens-local-storage-file-path",
  instantiate: (di) => {
    const joinPaths = di.inject(joinPathsInjectable);
    const directory = di.inject(directoryForLensLocalStorageInjectable);
    const getClusterById = di.inject(getClusterByIdInjectable);

    return (clusterId: ClusterId | undefined) => {
      if (clusterId !== undefined && !getClusterById(clusterId)) {
        throw new Error(`Cannot use the local storage of cluster "${clusterId}", which is not registered`);
      }

      return joinPaths(directory, `${clusterId || "app"}.json`);
    };
  },
});

export default lensLocalStorageFilePathInjectable;
