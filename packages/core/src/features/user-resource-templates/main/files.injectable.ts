/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { observable } from "mobx";

/** The contents of each template file, by its path. */
const userResourceTemplateFilesInjectable = getInjectable({
  id: "user-resource-template-files",
  instantiate: () => observable.map<string, string>(),
});

export default userResourceTemplateFilesInjectable;
