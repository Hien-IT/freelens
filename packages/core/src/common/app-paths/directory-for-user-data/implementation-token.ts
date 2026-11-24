/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectionToken } from "@ogre-tools/injectable";

/** The user data directory as each process computes it. */
export const directoryForUserDataImplementationInjectionToken = getInjectionToken<string>({
  id: "directory-for-user-data-implementation",
});
