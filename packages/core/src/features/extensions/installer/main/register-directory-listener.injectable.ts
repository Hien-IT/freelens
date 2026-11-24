/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannelListenerInjectable } from "@freelensapp/messaging";
import readJsonFileInjectable from "../../../../common/fs/main/read-json-file.injectable";
import joinPathsInjectable from "../../../../common/path/join-paths.injectable";
import { registerExtensionDirectoryChannel } from "../common/install-channels";
import { manifestFilename, validateExtensionManifest } from "../common/manifest";
import activateInstalledBuildInjectable from "./activate-installed-build.injectable";

/** Records the directory as an unverified extension loaded from where it is; main reads its manifest again. */
const registerExtensionDirectoryListenerInjectable = getRequestChannelListenerInjectable({
  id: "register-extension-directory-listener",
  channel: registerExtensionDirectoryChannel,
  getHandler: (di) => {
    const readJsonFile = di.inject(readJsonFileInjectable);
    const joinPaths = di.inject(joinPathsInjectable);
    const activateInstalledBuild = di.inject(activateInstalledBuildInjectable);

    return async ({ path }) => {
      const { name } = validateExtensionManifest(await readJsonFile(joinPaths(path, manifestFilename)));

      await activateInstalledBuild({ name, path, source: { kind: "directory", path }, verified: false });

      return { id: name };
    };
  },
});

export default registerExtensionDirectoryListenerInjectable;
