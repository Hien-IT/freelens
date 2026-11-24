/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getGlobalOverride } from "@freelensapp/test-utils";
import { noop } from "@freelensapp/utilities";
import showItemInFolderInjectable from "./show-item-in-folder.injectable";

export default getGlobalOverride(showItemInFolderInjectable, () => noop);
