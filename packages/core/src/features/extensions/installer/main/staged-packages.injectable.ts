/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";

import type { LensExtensionManifest } from "../../../../extensions/installed-extension";

export interface StagedPackage {
  fileName: string;
  /** The tarball, alone in a directory created for this install. */
  tempFile: string;
  data: Uint8Array;
  manifest: LensExtensionManifest;
}

/** The packages staged for an install, each by an id that is valid for one commit or discard. */
const stagedExtensionPackagesInjectable = getInjectable({
  id: "staged-extension-packages",
  instantiate: () => new Map<string, StagedPackage>(),
});

export default stagedExtensionPackagesInjectable;
