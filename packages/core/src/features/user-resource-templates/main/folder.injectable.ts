/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import homeDirectoryPathInjectable from "../../../common/os/home-directory-path.injectable";
import joinPathsInjectable from "../../../common/path/join-paths.injectable";

const userResourceTemplatesFolderInjectable = getInjectable({
  id: "user-resource-templates-folder",
  instantiate: (di) => di.inject(joinPathsInjectable)(di.inject(homeDirectoryPathInjectable), ".freelens", "templates"),
});

export default userResourceTemplatesFolderInjectable;
