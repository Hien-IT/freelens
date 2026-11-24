/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { onQuitOfBackEndInjectionToken } from "../../../../main/start-main-application/runnable-tokens/phases";
import { discardTarball } from "./discard-tarball";
import stagedExtensionPackagesInjectable from "./staged-packages.injectable";

/** Removes what a view staged and never committed nor discarded. */
const discardStagedExtensionPackagesOnQuitInjectable = getInjectable({
  id: "discard-staged-extension-packages-on-quit",
  instantiate: (di) => ({
    run: async () => {
      const staged = di.inject(stagedExtensionPackagesInjectable);
      const tempFiles = [...staged.values()].map(({ tempFile }) => tempFile);

      staged.clear();
      await Promise.all(tempFiles.map(discardTarball));
    },
  }),
  injectionToken: onQuitOfBackEndInjectionToken,
});

export default discardStagedExtensionPackagesOnQuitInjectable;
