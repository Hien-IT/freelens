/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { readFile } from "node:fs/promises";
import { prefixedLoggerInjectable } from "@freelensapp/logger";
import { delay, isErrnoException } from "@freelensapp/utilities";
import { getInjectable } from "@ogre-tools/injectable";
import watchInjectable from "../../../common/fs/main/watch.injectable";
import { waitForPath } from "../../../common/utils/main/wait-for-path";
import userResourceTemplateFilesInjectable from "./files.injectable";
import userResourceTemplatesFolderInjectable from "./folder.injectable";
import { hasCorrectExtension } from "./has-correct-extension";

/** Starts keeping the template files up to date with the folder, once it exists. */
const watchUserResourceTemplatesInjectable = getInjectable({
  id: "watch-user-resource-templates",
  instantiate: (di) => () => {
    const watch = di.inject(watchInjectable);
    const logger = di.inject(prefixedLoggerInjectable, "USER-CREATE-RESOURCE-TEMPLATES");
    const files = di.inject(userResourceTemplateFilesInjectable);
    const userTemplatesFolder = di.inject(userResourceTemplatesFolderInjectable);

    const onAddOrChange = async (filePath: string) => {
      if (!hasCorrectExtension(filePath)) {
        // ignore non yaml or json files
        return;
      }

      try {
        const contents = await readFile(filePath, "utf-8");

        files.set(filePath, contents);
      } catch (error) {
        if (isErrnoException(error) && error.code === "ENOENT") {
          // ignore, file disappeared
        } else {
          logger.warn(`encountered error while reading ${filePath}`, error);
        }
      }
    };
    const onUnlink = (filePath: string) => {
      files.delete(filePath);
    };

    (async () => {
      for (let i = 1; ; i *= 2) {
        try {
          await waitForPath(userTemplatesFolder);
          break;
        } catch (error) {
          logger.warn(
            `encountered error while waiting for ${userTemplatesFolder} to exist, waiting and trying again`,
            error,
          );
          await delay(i * 1000); // exponential backoff in seconds
        }
      }

      /**
       * NOTE: There is technically a race condition here of the form "time-of-check to time-of-use"
       */
      watch(userTemplatesFolder, {
        ignorePermissionErrors: true,
        usePolling: false,
        awaitWriteFinish: {
          pollInterval: 100,
          stabilityThreshold: 1000,
        },
        ignoreInitial: false,
        atomic: 150, // for "atomic writes"
      })
        .on("add", onAddOrChange)
        .on("change", onAddOrChange)
        .on("unlink", onUnlink)
        .on("error", (error) => {
          logger.warn(`encountered error while watching files under ${userTemplatesFolder}`, error);
        });
    })();
  },
  causesSideEffects: true,
});

export default watchUserResourceTemplatesInjectable;
