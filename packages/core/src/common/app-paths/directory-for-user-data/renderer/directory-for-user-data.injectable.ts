/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import appPathsInjectable from "../../app-paths.injectable";
import { directoryForUserDataImplementationInjectionToken } from "../implementation-token";

/** Main's, which already points into the directory of an integration test. */
const directoryForUserDataForRendererInjectable = getInjectable({
  id: "directory-for-user-data-for-renderer",
  instantiate: (di) => di.inject(appPathsInjectable).userData,
  injectionToken: directoryForUserDataImplementationInjectionToken,
});

export default directoryForUserDataForRendererInjectable;
