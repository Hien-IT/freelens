/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { requestFromChannelInjectionToken } from "@freelensapp/messaging";
import { getInjectable } from "@ogre-tools/injectable";
import messageBatchesInjectable from "./message-batches.injectable";
import postToCoreInjectable from "./post-to-core.injectable";
import { fromEnvelope, toEnvelope } from "./wire";

import type { RequestChannel, RequestFromChannel } from "@freelensapp/messaging";

import type { CoreResponse } from "./post-to-core.injectable";
import type { Envelope } from "./wire";

const errorMessageOf = (body: unknown): string | undefined => {
  const message = (body as { error?: { message?: unknown } } | undefined)?.error?.message;

  return typeof message === "string" ? message : undefined;
};

// The rejections of Electron's ipcRenderer.invoke (research R6, contracts/ipc-routes.md).
const toResult = (channelId: string, { status, statusText, body }: CoreResponse): unknown => {
  if (status === 200) {
    return fromEnvelope((body ?? {}) as Envelope);
  }

  const message = errorMessageOf(body);

  if ((status === 400 || status === 404 || status === 500) && message !== undefined) {
    throw new Error(`Error invoking remote method '${channelId}': Error: ${message}`);
  }

  throw new Error(`Error invoking remote method '${channelId}': ${status} ${statusText}`);
};

const requestFromChannelInjectable = getInjectable({
  id: "request-from-channel-for-tauri",

  instantiate: (di) => {
    const postToCore = di.inject(postToCoreInjectable);
    const batches = di.inject(messageBatchesInjectable);

    return (async (channel: RequestChannel<unknown, unknown>, request?: unknown) => {
      const envelope = toEnvelope(channel.id, request);

      // A request never overtakes a message sent before it (research R5).
      await batches.settled();

      let response: CoreResponse;

      try {
        response = await postToCore("/ipc/request", { channel: channel.id, ...envelope });
      } catch (error) {
        throw new Error(
          `Error invoking remote method '${channel.id}': ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      return toResult(channel.id, response);
    }) as RequestFromChannel;
  },

  injectionToken: requestFromChannelInjectionToken,
});

export default requestFromChannelInjectable;
