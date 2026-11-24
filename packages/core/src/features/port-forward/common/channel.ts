/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannel } from "@freelensapp/messaging";

/** Waits until nothing listens on the local port any more, after a port forward stopped. */
export const waitUntilPortFreeChannel = getRequestChannel<{ port: number }, void>("wait-until-port-free");
