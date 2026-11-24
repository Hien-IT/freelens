/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { requestFromChannelInjectionToken } from "@freelensapp/messaging";
import { getInjectable } from "@ogre-tools/injectable";
import { pathExistsChannel } from "../common/channels";

export type RequestPathExists = (path: string) => Promise<boolean>;

const requestPathExistsInjectable = getInjectable({
  id: "request-path-exists",
  instantiate: (di): RequestPathExists => {
    const requestFromChannel = di.inject(requestFromChannelInjectionToken);

    return (path) => requestFromChannel(pathExistsChannel, path);
  },
});

export default requestPathExistsInjectable;
