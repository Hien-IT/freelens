/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { requestFromChannelInjectionToken } from "@freelensapp/messaging";
import { getInjectable } from "@ogre-tools/injectable";
import { podFilesChannel } from "../common/channels";

import type { PodFilesOperation, PodFilesResponse, PodFilesResultData, PodFilesTarget } from "../common/types";

export type RequestPodFiles = <Operation extends PodFilesOperation>(
  target: PodFilesTarget,
  operation: Operation,
) => Promise<PodFilesResponse<PodFilesResultData[Operation["type"]]>>;

const requestPodFilesInjectable = getInjectable({
  id: "request-pod-files",

  instantiate: (di): RequestPodFiles => {
    const requestFromChannel = di.inject(requestFromChannelInjectionToken);

    return async (target, operation) =>
      (await requestFromChannel(podFilesChannel, { ...target, operation })) as PodFilesResponse<never>;
  },
});

export default requestPodFilesInjectable;
