/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { directoryForUserDataImplementationInjectionToken } from "./implementation-token";

const directoryForUserDataInjectable = getInjectable({
  id: "directory-for-user-data",
  instantiate: (di) => di.inject(directoryForUserDataImplementationInjectionToken),
});

export default directoryForUserDataInjectable;
