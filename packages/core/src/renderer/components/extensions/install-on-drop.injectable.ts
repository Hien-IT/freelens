/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { loggerInjectionToken } from "@freelensapp/logger";
import { getInjectable } from "@ogre-tools/injectable";
import attemptInstallsInjectable from "./attempt-installs.injectable";

// Electron extends the browser File interface with a path property
export type InstallOnDrop = (files: File[]) => Promise<void>;

const installOnDropInjectable = getInjectable({
  id: "install-on-drop",

  instantiate: (di): InstallOnDrop => {
    const attemptInstalls = di.inject(attemptInstallsInjectable);
    const logger = di.inject(loggerInjectionToken);

    return (files) => {
      logger.info("Install from D&D");

      // the path of a dropped file, which only the preload can give
      const getPathForFile = (globalThis as { freelensViewBridge?: { getPathForFile(file: File): string } })
        .freelensViewBridge?.getPathForFile;

      return attemptInstalls(getPathForFile ? files.map((file) => getPathForFile(file)) : []);
    };
  },
});

export default installOnDropInjectable;
