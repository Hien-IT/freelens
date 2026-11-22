/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import postToCoreInjectable from "./post-to-core.injectable";
import { fromEnvelope } from "./wire";

import type { Envelope } from "./wire";

export type MessageHandler = (message: unknown) => void;

export interface Polling {
  /** Adds a listener; the first one starts the poll loop (research R3). */
  listen: (channelId: string, handler: MessageHandler) => () => void;
}

type PolledMessage = Envelope & { seq: number; channel: string };

const firstRetryDelay = 100;
const lastRetryDelay = 2_000;

const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const pollingInjectable = getInjectable({
  id: "polling",

  instantiate: (di): Polling => {
    const postToCore = di.inject(postToCoreInjectable);
    const handlers = new Map<string, Set<MessageHandler>>();
    // One page load, one session (data-model.md, Queue.session).
    const session = globalThis.crypto.randomUUID();
    let after = 0;
    let started = false;

    const deliver = (messages: PolledMessage[]) => {
      for (const message of [...messages].sort((left, right) => left.seq - right.seq)) {
        if (message.seq <= after) {
          continue;
        }

        after = message.seq;

        for (const handler of [...(handlers.get(message.channel) ?? [])]) {
          try {
            handler(fromEnvelope(message));
          } catch (error) {
            console.error(`[MESSAGING]: a listener of "${message.channel}" failed: ${String(error)}`);
          }
        }
      }
    };

    const loop = async () => {
      let retryDelay = firstRetryDelay;

      for (;;) {
        try {
          const { status, statusText, body } = await postToCore("/ipc/poll", { session, after });

          if (status !== 200) {
            throw new Error(`${status} ${statusText}`);
          }

          retryDelay = firstRetryDelay;
          deliver((body as { messages?: PolledMessage[] } | undefined)?.messages ?? []);
        } catch {
          await sleep(retryDelay);
          retryDelay = Math.min(retryDelay * 2, lastRetryDelay);
        }
      }
    };

    return {
      listen: (channelId, handler) => {
        const forChannel = handlers.get(channelId) ?? new Set();

        forChannel.add(handler);
        handlers.set(channelId, forChannel);

        if (!started) {
          started = true;
          void loop();
        }

        return () => {
          forChannel.delete(handler);
        };
      },
    };
  },
});

export default pollingInjectable;
