/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { beforeElectronIsReadyInjectionToken } from "@freelensapp/application-for-electron-main";
import { getInjectable } from "@ogre-tools/injectable";
import forceAppExitInjectable from "../features/force-app-exit.injectable";
import isTauriBuildRunningInjectable from "../features/is-tauri-build-running.injectable";
import requestSingleInstanceLockInjectable from "../features/request-single-instance-lock.injectable";
import showErrorPopupInjectable from "../features/show-error-popup.injectable";

const enforceSingleApplicationInstanceInjectable = getInjectable({
  id: "enforce-single-application-instance",

  instantiate: (di) => ({
    run: () => {
      const requestSingleInstanceLock = di.inject(requestSingleInstanceLockInjectable);
      const forceAppExit = di.inject(forceAppExitInjectable);

      if (!requestSingleInstanceLock()) {
        forceAppExit();

        return undefined;
      }

      // Both builds write the same files, so only one of them may run on a data directory.
      const tauriBuild = di.inject(isTauriBuildRunningInjectable)();

      if (tauriBuild) {
        di.inject(showErrorPopupInjectable)(
          "Freelens is already running",
          `The Tauri build of Freelens is using ${tauriBuild.dataDirectory}. Quit it, then start this one again. If it is not running, delete ${tauriBuild.linkPath}.`,
        );
        forceAppExit();
      }

      return undefined;
    },
  }),

  injectionToken: beforeElectronIsReadyInjectionToken,
});

export default enforceSingleApplicationInstanceInjectable;
