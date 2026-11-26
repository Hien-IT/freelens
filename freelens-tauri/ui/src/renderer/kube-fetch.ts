/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// `fetch` for the /api-kube proxy of a cluster frame, with its watches
// (specs/009-main-cluster-connection/contracts/kube-watch.md). The scheme
// answers a request in one piece, so a watch travels over the view's message
// queue: `kube-watch:open` answers its head, and its body arrives on
// `kube-watch:data` and `kube-watch:end`. The answer is a `Response` whose body
// streams, as the Electron build's proxy gives it.

import {
  enlistMessageChannelListenerInjectionToken,
  getMessageChannel,
  getRequestChannel,
  requestFromChannelInjectionToken,
  sendMessageToChannelInjectionToken,
} from "@freelensapp/messaging";

import type { DiContainer } from "@ogre-tools/injectable";

interface OpenRequest {
  id: string;
  path: string;
  headers: [string, string][];
}

interface OpenAnswer {
  status: number;
  headers: [string, string][];
  body?: string;
}

interface WatchData {
  id: string;
  text: string;
}

interface WatchEnd {
  id: string;
  error?: string;
}

const kubeWatchOpenChannel = getRequestChannel<OpenRequest, OpenAnswer>("kube-watch:open");
const kubeWatchDataChannel = getMessageChannel<WatchData>("kube-watch:data");
const kubeWatchEndChannel = getMessageChannel<WatchEnd>("kube-watch:end");
const kubeWatchCloseChannel = getMessageChannel<{ id: string }>("kube-watch:close");

/** `watch` or `follow` present and not `false`, `f` or `0`, as the proxy decides. */
export function isWatch(search: URLSearchParams): boolean {
  return ["watch", "follow"].some((name) =>
    search.getAll(name).some((value) => !["false", "f", "0"].includes(value.toLowerCase())),
  );
}

interface Feed {
  data(text: string): void;
  end(error: string | undefined): void;
}

/** A `fetch` that carries the watches of /api-kube over the messaging of `di`. */
export function createKubeFetch(di: DiContainer): typeof fetch {
  const request = di.inject(requestFromChannelInjectionToken);
  const send = di.inject(sendMessageToChannelInjectionToken);
  const enlist = di.inject(enlistMessageChannelListenerInjectionToken);
  const feeds = new Map<string, Feed>();
  let next = 0;

  enlist({
    id: "kube-watch-data",
    channel: kubeWatchDataChannel,
    handler: ({ id, text }) => feeds.get(id)?.data(text),
  });
  enlist({
    id: "kube-watch-end",
    channel: kubeWatchEndChannel,
    handler: ({ id, error }) => feeds.get(id)?.end(error),
  });

  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (!url.pathname.startsWith("/api-kube/") || !isWatch(url.searchParams)) {
      return fetch(input, init);
    }

    const id = `w-${Date.now().toString(36)}-${(next++).toString(36)}`;
    const encoder = new TextEncoder();
    const close = () => {
      if (feeds.delete(id)) {
        send(kubeWatchCloseChannel, { id });
      }
    };
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start: (started) => {
        controller = started;
      },
      cancel: close,
    });
    // Registered before the request: data can arrive before the answer.
    feeds.set(id, {
      data: (text) => controller.enqueue(encoder.encode(text)),
      end: (error) => {
        feeds.delete(id);
        if (error) {
          controller.error(new TypeError(error));
        } else {
          controller.close();
        }
      },
    });
    init?.signal?.addEventListener(
      "abort",
      () => {
        close();
        controller.error(new DOMException("The watch was aborted.", "AbortError"));
      },
      { once: true },
    );

    const headers: [string, string][] = [...new Headers(init?.headers).entries()];
    let answer: OpenAnswer;
    try {
      answer = await request(kubeWatchOpenChannel, {
        id,
        path: url.pathname.slice("/api-kube".length) + url.search,
        headers,
      });
    } catch (error) {
      feeds.delete(id);
      throw new TypeError(`Failed to open the watch: ${String(error)}`);
    }
    if (answer.body !== undefined) {
      feeds.delete(id);
      return new Response(answer.body, { status: answer.status, headers: answer.headers });
    }
    return new Response(body, { status: answer.status, headers: answer.headers });
  };
}
