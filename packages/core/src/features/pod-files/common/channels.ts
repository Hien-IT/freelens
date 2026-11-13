/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannel } from "@freelensapp/messaging";

import type { PodFilesRequest, PodFilesResponse } from "./types";

/**
 * Runs one file operation in a container of a pod, through `kubectl exec`.
 */
export const podFilesChannel = getRequestChannel<PodFilesRequest, PodFilesResponse>("pod-files");
