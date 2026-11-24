/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannel } from "@freelensapp/messaging";

import type { LensExtensionId } from "../../../../extensions/installed-extension";

/** Uninstalls an extension; main finds it and its files from the id. */
export const uninstallExtensionChannel = getRequestChannel<LensExtensionId, void>("extension:uninstall");
