/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannelListenerInjectable } from "@freelensapp/messaging";
import fsInjectable from "../../../../common/fs/main/fs.injectable";
import joinPathsInjectable from "../../../../common/path/join-paths.injectable";
import { writePickedFilesChannel } from "../common/channel";

const writePickedFilesListenerInjectable = getRequestChannelListenerInjectable({
  id: "write-picked-files-listener",
  channel: writePickedFilesChannel,
  getHandler: (di) => {
    const { writeFile } = di.inject(fsInjectable);
    const joinPaths = di.inject(joinPathsInjectable);

    return async ({ uploadDir, files }) => {
      // a picked file has a name, never a path, so nothing is written outside the folder
      for (const { name } of files) {
        if (/[/\\]/.test(name) || name.includes("..")) {
          throw new Error(`"${name}" is not the name of a picked file`);
        }
      }

      const paths = files.map(({ name }) => joinPaths(uploadDir, name));

      await Promise.all(files.map(({ base64 }, index) => writeFile(paths[index], Buffer.from(base64, "base64"))));

      return paths;
    };
  },
});

export default writePickedFilesListenerInjectable;
