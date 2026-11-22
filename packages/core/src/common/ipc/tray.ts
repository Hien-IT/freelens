/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getMessageChannel } from "@freelensapp/messaging";

// The typed channel of the legacy name (specs/002-messaging-for-tauri, research R11).
export const setTrayVisibleChannel = getMessageChannel<boolean>("tray:set-visible");
