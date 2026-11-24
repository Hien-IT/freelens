/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { shell } from "electron";

const showItemInFolderInjectable = getInjectable({
  id: "show-item-in-folder",
  instantiate: () => (path: string) => shell.showItemInFolder(path),
  causesSideEffects: true,
});

export default showItemInFolderInjectable;
