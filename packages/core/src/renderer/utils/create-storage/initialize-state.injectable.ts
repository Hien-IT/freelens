/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { beforeApplicationIsLoadingInjectionToken } from "@freelensapp/application";
import { loggerInjectionToken } from "@freelensapp/logger";
import { requestFromChannelInjectionToken } from "@freelensapp/messaging";
import { getInjectable } from "@ogre-tools/injectable";
import { compareStructural, reaction, runInAction, toJS } from "mobx";
import AwaitLock from "../../../common/utils/await-lock";
import {
  lensLocalStorageReadChannel,
  lensLocalStorageWriteChannel,
} from "../../../features/local-storage/common/channels";
import setupMachineValuesInjectable from "../../../features/machine-values/renderer/setup.injectable";
import setupAppPathsInjectable from "../../app-paths/setup-app-paths.injectable";
import hostedClusterIdInjectable from "../../cluster-frame-context/hosted-cluster-id.injectable";
import { storageHelperLogPrefix } from "../storage-helper";
import lensLocalStorageStateInjectable from "./state.injectable";
import storageSaveDelayInjectable from "./storage-save-delay.injectable";

const initializeStateInjectable = getInjectable({
  id: "initialize-lens-local-storage-state",
  instantiate: (di) => ({
    run: async () => {
      const hostedClusterId = di.inject(hostedClusterIdInjectable);
      const lensLocalStorageState = di.inject(lensLocalStorageStateInjectable);
      const requestFromChannel = di.inject(requestFromChannelInjectionToken);
      const logger = di.inject(loggerInjectionToken);
      const storageSaveDelay = di.inject(storageSaveDelayInjectable);
      const lock = new AwaitLock();

      // main reads and writes the file of this frame
      const clusterId = hostedClusterId || undefined;
      const storageName = `the local storage of ${hostedClusterId || "app"}`;

      try {
        const localFile = await requestFromChannel(lensLocalStorageReadChannel, { clusterId });

        runInAction(() => {
          Object.assign(lensLocalStorageState, localFile);
        });
      } catch {
        // do nothing
      } finally {
        logger.info(`${storageHelperLogPrefix} loading finished for ${storageName}`);
      }

      reaction(() => toJS(lensLocalStorageState), saveFile, {
        delay: storageSaveDelay, // lazy, avoid excessive writes to fs
        equals: compareStructural, // save only when something really changed
      });

      async function saveFile(state: Record<string, unknown>) {
        try {
          await lock.acquireAsync();
          logger.info(`${storageHelperLogPrefix} saving ${storageName}`);
          await requestFromChannel(lensLocalStorageWriteChannel, { clusterId, state });
        } catch (error) {
          logger.error(`${storageHelperLogPrefix} saving failed: ${error}`, {
            storage: storageName,
          });
        } finally {
          lock.release();
        }
      }
    },
    // the path injectables read the platform
    runAfter: [setupAppPathsInjectable, setupMachineValuesInjectable],
  }),
  injectionToken: beforeApplicationIsLoadingInjectionToken,
});

export default initializeStateInjectable;
