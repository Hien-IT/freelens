/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannel } from "@freelensapp/messaging";

export type KubeconfigSyncKind = { kind: "file" | "dir" } | { error: string };

/** What a path the user typed or picked for kubeconfig syncing is; main reads only its kind. */
export const discoverKubeconfigSyncKindChannel = getRequestChannel<string, KubeconfigSyncKind>(
  "discover-kubeconfig-sync-kind",
);
