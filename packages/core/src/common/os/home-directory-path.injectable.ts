/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { machineValuesInjectionToken } from "../../features/machine-values/common/token";

/** In main, the home directory of the user, or a directory of its own in an integration test. */
const homeDirectoryPathInjectable = getInjectable({
  id: "home-directory-path",
  instantiate: (di) => di.inject(machineValuesInjectionToken).homeDirectory,
});

export default homeDirectoryPathInjectable;
