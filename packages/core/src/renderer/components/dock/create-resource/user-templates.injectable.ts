/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { requestFromChannelInjectionToken } from "@freelensapp/messaging";
import { getInjectable } from "@ogre-tools/injectable";
import { computed, runInAction } from "mobx";
import { initialUserResourceTemplatesChannel } from "../../../../features/user-resource-templates/common/channels";
import userResourceTemplatesStateInjectable from "../../../../features/user-resource-templates/renderer/state.injectable";

import type { RawTemplates } from "./create-resource-templates.injectable";

/** Main reads and watches the templates; the first request starts that, and its updates follow. */
const userCreateResourceTemplatesInjectable = getInjectable({
  id: "user-create-resource-templates",
  instantiate: (di) => {
    const requestFromChannel = di.inject(requestFromChannelInjectionToken);
    const state = di.inject(userResourceTemplatesStateInjectable);

    void requestFromChannel(initialUserResourceTemplatesChannel).then((templates) => {
      // an update that came first is newer
      if (state.get() === undefined) {
        runInAction(() => state.set(templates));
      }
    });

    return computed((): RawTemplates[] => state.get() ?? []);
  },
});

export default userCreateResourceTemplatesInjectable;
