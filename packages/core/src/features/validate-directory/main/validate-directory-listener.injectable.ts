/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannelListenerInjectable } from "@freelensapp/messaging";
import validateDirectoryInjectable from "../../../common/fs/main/validate-directory.injectable";
import resolveTildeInjectable from "../../../common/path/resolve-tilde.injectable";
import { validateDirectoryChannel } from "../common/channels";

const validateDirectoryListenerInjectable = getRequestChannelListenerInjectable({
  id: "validate-directory-listener",
  channel: validateDirectoryChannel,
  getHandler: (di) => {
    const validateDirectory = di.inject(validateDirectoryInjectable);
    const resolveTilde = di.inject(resolveTildeInjectable);

    return async (path) => {
      const result = await validateDirectory(resolveTilde(path));

      return result.callWasSuccessful ? { ok: true } : { ok: false, error: result.error };
    };
  },
});

export default validateDirectoryListenerInjectable;
