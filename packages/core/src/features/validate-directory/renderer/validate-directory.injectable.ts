/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { requestFromChannelInjectionToken } from "@freelensapp/messaging";
import { getInjectable } from "@ogre-tools/injectable";
import { validateDirectoryChannel } from "../common/channels";

import type { AsyncResult } from "@freelensapp/utilities";

export type ValidateDirectory = (path: string) => AsyncResult<undefined>;

const validateDirectoryInjectable = getInjectable({
  id: "request-validate-directory",
  instantiate: (di): ValidateDirectory => {
    const requestFromChannel = di.inject(requestFromChannelInjectionToken);

    return async (path) => {
      const validation = await requestFromChannel(validateDirectoryChannel, path);

      return validation.ok
        ? { callWasSuccessful: true, response: undefined }
        : { callWasSuccessful: false, error: validation.error };
    };
  },
});

export default validateDirectoryInjectable;
