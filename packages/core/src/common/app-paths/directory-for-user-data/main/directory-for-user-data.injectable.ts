/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import os from "node:os";
import path from "node:path";
import { getInjectable } from "@ogre-tools/injectable";
import appNameInjectable from "../../../vars/app-name.injectable";
import appPathsInjectable from "../../app-paths.injectable";
import { directoryForUserDataImplementationInjectionToken } from "../implementation-token";

const directoryForUserDataForMainInjectable = getInjectable({
  id: "directory-for-user-data-for-main",
  instantiate: (di) => {
    if (
      process.env.FREELENS_INTEGRATION_TESTING_DIR &&
      process.env.FREELENS_INTEGRATION_TESTING_DIR.startsWith(os.tmpdir())
    ) {
      const appName = di.inject(appNameInjectable);

      return path.join(process.env.FREELENS_INTEGRATION_TESTING_DIR, appName);
    }

    return di.inject(appPathsInjectable).userData;
  },
  injectionToken: directoryForUserDataImplementationInjectionToken,
});

export default directoryForUserDataForMainInjectable;
