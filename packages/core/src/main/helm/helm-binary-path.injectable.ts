/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import bundledBinaryPathInjectable from "../../common/utils/bundled-binary-path.injectable";
import userPreferencesStateInjectable from "../../features/user-preferences/common/state.injectable";

/**
 * The helm to run: the one set in the preferences, otherwise the bundled one.
 * Read on every call, so that a changed preference applies to the next one.
 */
export type GetHelmBinaryPath = () => string;

const helmBinaryPathInjectable = getInjectable({
  id: "helm-binary-path",
  instantiate: (di): GetHelmBinaryPath => {
    const bundledPath = di.inject(bundledBinaryPathInjectable, "helm");
    const state = di.inject(userPreferencesStateInjectable);

    return () => state.helmBinariesPath || bundledPath;
  },
});

export default helmBinaryPathInjectable;
