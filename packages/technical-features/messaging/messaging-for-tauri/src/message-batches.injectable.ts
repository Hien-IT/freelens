/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import postToCoreInjectable from "./post-to-core.injectable";

import type { Envelope } from "./wire";

export interface MessageBatches {
  send: (channelId: string, envelope: Envelope) => void;
  /** Resolves once every message sent before the call is in a batch the core has settled (research R5). */
  settled: () => Promise<void>;
}

type WireMessage = Envelope & { channel: string };

// One batch in flight per view; messages sent meanwhile go in the next one
// (data-model.md, Message batch).
const messageBatchesInjectable = getInjectable({
  id: "message-batches",

  instantiate: (di): MessageBatches => {
    const postToCore = di.inject(postToCoreInjectable);

    let collecting: WireMessage[] = [];
    let inFlight = false;
    let sent = 0;
    let settledCount = 0;
    const waiting: { target: number; resolve: () => void }[] = [];

    const release = () => {
      for (const waiter of [...waiting]) {
        if (waiter.target <= settledCount) {
          waiting.splice(waiting.indexOf(waiter), 1);
          waiter.resolve();
        }
      }
    };

    const flush = () => {
      const messages = collecting;

      collecting = [];
      inFlight = true;

      const channels = [...new Set(messages.map(({ channel }) => channel))].join(", ");

      postToCore("/ipc/messages", { messages })
        .then(
          ({ status, statusText }) => {
            if (status !== 204) {
              console.error(`[MESSAGING]: the core refused messages on ${channels}: ${status} ${statusText}`);
            }
          },
          (error: unknown) => {
            console.error(`[MESSAGING]: failed to send messages on ${channels}: ${String(error)}`);
          },
        )
        .finally(() => {
          inFlight = false;
          settledCount += messages.length;
          release();

          if (collecting.length > 0) {
            flush();
          }
        });
    };

    return {
      send: (channel, envelope) => {
        collecting.push({ channel, ...envelope });
        sent += 1;

        if (!inFlight) {
          flush();
        }
      },

      settled: () => {
        const target = sent;

        return target <= settledCount
          ? Promise.resolve()
          : new Promise((resolve) => {
              waiting.push({ target, resolve });
            });
      },
    };
  },
});

export default messageBatchesInjectable;
