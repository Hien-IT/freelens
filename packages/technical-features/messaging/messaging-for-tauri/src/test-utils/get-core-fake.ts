/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import postToCoreInjectable from "../post-to-core.injectable";
import { fromEnvelope, toEnvelope } from "../wire";

import type { DiContainer } from "@ogre-tools/injectable";

import type { CoreResponse, IpcRoute, PostToCore } from "../post-to-core.injectable";
import type { Envelope } from "../wire";

export const mainHost = "renderer.freelens.app";
export const clusterHost = (clusterId: string) => `${clusterId}.renderer.freelens.app`;

/** The view a request comes from, taken from the host of the involving container (data-model.md, View). */
export type FakeView = "main" | `cluster ${string}`;

export type FakeRequestHandler = (request: unknown, view: FakeView) => unknown;
export type FakeMessageListener = (message: unknown, view: FakeView) => void;

export interface CoreFake {
  /** Connects a view container to the fake core, as the view of `host`. */
  involve: (di: DiContainer, host: string) => void;
  answer: (channelId: string, handler: FakeRequestHandler) => void;
  listen: (channelId: string, listener: FakeMessageListener) => void;
  send: (channelId: string, message?: unknown) => void;
  /** Answers the next call of `route` with `response`, or fails it with `error`. */
  failNext: (route: IpcRoute, outcome: CoreResponse | Error) => void;
  /** Holds the next call of `route` until the returned function is called, then handles it. */
  delayNext: (route: IpcRoute) => () => void;
  /** Every call the views made, in order. */
  calls: { route: IpcRoute; view: FakeView; body: unknown }[];
  /** Resolves once the requests, batches and answered polls in flight are settled. */
  messagePropagation: () => Promise<void>;
}

interface Queue {
  session: string;
  nextSeq: number;
  messages: (Envelope & { seq: number; channel: string })[];
  pending?: { after: number; resolve: (response: CoreResponse) => void; timer: ReturnType<typeof setTimeout> };
}

const pollHold = 25_000;

const ok = (body: unknown): CoreResponse => ({ status: 200, statusText: "OK", body });
const noContent: CoreResponse = { status: 204, statusText: "No Content", body: undefined };
const failure = (status: number, statusText: string, message?: string): CoreResponse => ({
  status,
  statusText,
  body: message === undefined ? undefined : { error: { message } },
});

const viewOf = (host: string): FakeView =>
  host === mainHost ? "main" : `cluster ${host.slice(0, -`.${mainHost}`.length)}`;

/**
 * A stand-in for the core, in the shape of messaging-fake-bridge (research R10).
 * It answers the routes of contracts/ipc-routes.md that a view can observe; the
 * sender is always the view of the involving host, because a view only ever
 * calls its own host.
 */
export const getCoreFake = (): CoreFake => {
  const handlers = new Map<string, FakeRequestHandler>();
  const listeners = new Map<string, FakeMessageListener[]>();
  const queues = new Map<FakeView, Queue>();
  const failures = new Map<IpcRoute, (CoreResponse | Error)[]>();
  const gates = new Map<IpcRoute, Promise<void>[]>();
  const inFlight = new Set<Promise<unknown>>();
  const calls: CoreFake["calls"] = [];

  const answerPoll = (queue: Queue) => {
    const { pending } = queue;

    if (!pending) {
      return;
    }

    const messages = queue.messages.filter(({ seq }) => seq > pending.after);

    if (messages.length > 0) {
      clearTimeout(pending.timer);
      queue.pending = undefined;
      pending.resolve(ok({ messages }));
    }
  };

  const request = async (view: FakeView, body: { channel?: unknown } & Envelope): Promise<CoreResponse> => {
    const channel = body.channel;

    if (typeof channel !== "string") {
      return failure(400, "Bad Request", "The request names no channel");
    }

    const handler = handlers.get(channel);

    if (!handler) {
      return failure(404, "Not Found", `No handler registered for '${channel}'`);
    }

    try {
      return ok(toEnvelope(channel, await handler(fromEnvelope(body), view)));
    } catch (error) {
      return failure(500, "Internal Server Error", error instanceof Error ? error.message : String(error));
    }
  };

  const messages = (view: FakeView, body: { messages?: ({ channel: string } & Envelope)[] }): CoreResponse => {
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return failure(400, "Bad Request", "The batch holds no message");
    }

    for (const message of body.messages) {
      for (const listener of listeners.get(message.channel) ?? []) {
        listener(fromEnvelope(message), view);
      }
    }

    return noContent;
  };

  const poll = (view: FakeView, body: { session?: unknown; after?: unknown }): Promise<CoreResponse> | CoreResponse => {
    const { session, after } = body;

    if (typeof session !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(session) || typeof after !== "number") {
      return failure(400, "Bad Request", "The poll has no valid session or after");
    }

    let queue = queues.get(view);

    // A new session is a reload: the queue starts afresh (data-model.md, Queue.session).
    if (!queue || queue.session !== session) {
      queue = { session, nextSeq: 1, messages: [] };
      queues.set(view, queue);
    }

    // A newer poll answers the pending one empty (data-model.md, Queue.pending poll).
    if (queue.pending) {
      clearTimeout(queue.pending.timer);
      queue.pending.resolve(ok({ messages: [] }));
      queue.pending = undefined;
    }

    queue.messages = queue.messages.filter(({ seq }) => seq > after);

    const current = queue;

    return new Promise<CoreResponse>((resolve) => {
      const timer = setTimeout(() => {
        current.pending = undefined;
        resolve(ok({ messages: [] }));
      }, pollHold);

      current.pending = { after, resolve, timer };
      answerPoll(current);
    });
  };

  const postToCoreFor =
    (view: FakeView): PostToCore =>
    async (route, body) => {
      calls.push({ route, view, body });

      const gate = gates.get(route)?.shift();

      if (gate) {
        inFlight.add(gate);
        await gate;
        inFlight.delete(gate);
      }

      const planned = failures.get(route)?.shift();

      if (planned instanceof Error) {
        throw planned;
      }

      if (planned) {
        return planned;
      }

      switch (route) {
        case "/ipc/request": {
          const answer = request(view, body as { channel?: unknown } & Envelope);

          inFlight.add(answer);
          void answer.finally(() => inFlight.delete(answer));

          return answer;
        }
        case "/ipc/messages":
          return messages(view, body as { messages?: ({ channel: string } & Envelope)[] });
        case "/ipc/poll":
          return poll(view, body as { session?: unknown; after?: unknown });
      }
    };

  return {
    involve: (di, host) => {
      di.override(postToCoreInjectable, () => postToCoreFor(viewOf(host)));
    },

    answer: (channelId, handler) => {
      handlers.set(channelId, handler);
    },

    listen: (channelId, listener) => {
      listeners.set(channelId, [...(listeners.get(channelId) ?? []), listener]);
    },

    send: (channelId, message) => {
      const envelope = toEnvelope(channelId, message);

      // Every open queue gets it, once (FR-004).
      for (const queue of queues.values()) {
        queue.messages.push({ seq: queue.nextSeq++, channel: channelId, ...envelope });
        answerPoll(queue);
      }
    },

    failNext: (route, outcome) => {
      failures.set(route, [...(failures.get(route) ?? []), outcome]);
    },

    delayNext: (route) => {
      let open = () => {};
      const gate = new Promise<void>((resolve) => {
        open = resolve;
      });

      gates.set(route, [...(gates.get(route) ?? []), gate]);

      return open;
    },

    calls,

    messagePropagation: async () => {
      // Lets the views handle what they received and send what follows from it.
      for (let round = 0; round < 20; round++) {
        await Promise.all([...inFlight]);
        await Promise.resolve();
      }
    },
  };
};
