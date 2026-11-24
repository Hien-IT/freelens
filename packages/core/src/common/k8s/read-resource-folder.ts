/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectionToken } from "@ogre-tools/injectable";

export interface ResourceFile {
  name: string;
  contents: string;
}

/** The files of a folder of resources an extension names: read by main, asked for by the renderer. */
export const readResourceFolderInjectionToken = getInjectionToken<(folderPath: string) => Promise<ResourceFile[]>>({
  id: "read-resource-folder",
});
