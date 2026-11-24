/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { beforeApplicationIsLoadingInjectionToken } from "@freelensapp/application";
import { requestFromChannelInjectionToken } from "@freelensapp/messaging";
import { getInjectable } from "@ogre-tools/injectable";
import { machineValuesChannel } from "../common/channel";
import machineValuesStateInjectable from "./state.injectable";

const setupMachineValuesInjectable = getInjectable({
  id: "setup-machine-values",
  instantiate: (di) => ({
    run: async () => {
      const requestFromChannel = di.inject(requestFromChannelInjectionToken);

      di.inject(machineValuesStateInjectable).set(await requestFromChannel(machineValuesChannel));
    },
  }),
  injectionToken: beforeApplicationIsLoadingInjectionToken,
});

export default setupMachineValuesInjectable;
