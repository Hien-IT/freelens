/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

/* c8 ignore start */
import { getInjectable } from "@ogre-tools/injectable";
import { webContents } from "electron";

const getWebContentsByIdInjectable = getInjectable({
  id: "web-contents-by-id",
  instantiate: () => (id: number) => webContents.fromId(id),
  causesSideEffects: true,
});

export default getWebContentsByIdInjectable;
/* c8 ignore stop */
