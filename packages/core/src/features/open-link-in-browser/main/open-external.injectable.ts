/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { shell } from "electron";

const openExternalInjectable = getInjectable({
  id: "open-external",
  instantiate: () => (url: string) => shell.openExternal(url),
  causesSideEffects: true,
});

export default openExternalInjectable;
