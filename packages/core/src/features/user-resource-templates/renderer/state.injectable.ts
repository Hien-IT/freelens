/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { observable } from "mobx";

import type { UserResourceTemplateGroup } from "../common/channels";

const userResourceTemplatesStateInjectable = getInjectable({
  id: "user-resource-templates-state",
  instantiate: () => observable.box<UserResourceTemplateGroup[] | undefined>(undefined, { deep: false }),
});

export default userResourceTemplatesStateInjectable;
