/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { pathToFileURL } from "node:url";
import { getInjectable } from "@ogre-tools/injectable";
import { fileUrlOfPathInjectionToken } from "../file-url-of-path";

const fileUrlOfPathInjectable = getInjectable({
  id: "file-url-of-path",
  instantiate: () => pathToFileURL,
  injectionToken: fileUrlOfPathInjectionToken,
});

export default fileUrlOfPathInjectable;
