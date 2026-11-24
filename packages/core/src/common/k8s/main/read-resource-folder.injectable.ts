/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import readDirectoryInjectable from "../../fs/main/read-directory.injectable";
import readFileInjectable from "../../fs/main/read-file.injectable";
import joinPathsInjectable from "../../path/join-paths.injectable";
import { readResourceFolderInjectionToken } from "../read-resource-folder";

const readResourceFolderInjectable = getInjectable({
  id: "read-resource-folder-in-main",
  instantiate: (di) => {
    const readDirectory = di.inject(readDirectoryInjectable);
    const readFile = di.inject(readFileInjectable);
    const joinPaths = di.inject(joinPathsInjectable);

    return async (folderPath: string) => {
      const files = [];

      for (const name of await readDirectory(folderPath)) {
        files.push({ name, contents: await readFile(joinPaths(folderPath, name)) });
      }

      return files;
    };
  },
  injectionToken: readResourceFolderInjectionToken,
});

export default readResourceFolderInjectable;
