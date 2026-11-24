/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { shell } from "electron";

const openPathInjectable = getInjectable({
  id: "open-path",
  instantiate: () => (path: string) => shell.openPath(path),
  causesSideEffects: true,
});

export default openPathInjectable;
