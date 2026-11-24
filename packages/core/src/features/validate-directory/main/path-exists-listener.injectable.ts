/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannelListenerInjectable } from "@freelensapp/messaging";
import pathExistsInjectable from "../../../common/fs/main/path-exists.injectable";
import resolveTildeInjectable from "../../../common/path/resolve-tilde.injectable";
import { pathExistsChannel } from "../common/channels";

const pathExistsListenerInjectable = getRequestChannelListenerInjectable({
  id: "path-exists-listener",
  channel: pathExistsChannel,
  getHandler: (di) => {
    const pathExists = di.inject(pathExistsInjectable);
    const resolveTilde = di.inject(resolveTildeInjectable);

    return (path) => pathExists(resolveTilde(path));
  },
});

export default pathExistsListenerInjectable;
