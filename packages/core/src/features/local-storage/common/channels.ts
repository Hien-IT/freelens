/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannel } from "@freelensapp/messaging";

import type { ClusterId } from "../../../common/cluster-types";

/** The state of a frame, of the root frame when `clusterId` is left out; `{}` when there is none yet. */
export const lensLocalStorageReadChannel = getRequestChannel<{ clusterId?: ClusterId }, Record<string, unknown>>(
  "lens-local-storage:read",
);

export const lensLocalStorageWriteChannel = getRequestChannel<
  { clusterId?: ClusterId; state: Record<string, unknown> },
  void
>("lens-local-storage:write");
