/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getMessageChannel, sendMessageToChannelInjectionToken } from "@freelensapp/messaging";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createView } from "./test-utils/create-view";
import { clusterHost, getCoreFake, mainHost } from "./test-utils/get-core-fake";

import type { SendMessageToChannel } from "@freelensapp/messaging";

import type { CoreFake } from "./test-utils/get-core-fake";

const someChannel = getMessageChannel<unknown>("some-channel");

describe("sending a message to the core", () => {
  let core: CoreFake;
  let send: SendMessageToChannel;

  beforeEach(() => {
    core = getCoreFake();
    send = createView(core, mainHost).inject(sendMessageToChannelInjectionToken);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reaches the core's listener once, with the sending view", async () => {
    const listener = vi.fn();

    core.listen("some-channel", listener);
    send(someChannel, "hello");
    await core.messagePropagation();

    expect(listener.mock.calls).toEqual([["hello", "main"]]);
  });

  it("reaches the core as the cluster frame that sent it", async () => {
    const listener = vi.fn();
    const clusterSend = createView(core, clusterHost("some-cluster")).inject(sendMessageToChannelInjectionToken);

    core.listen("some-channel", listener);
    clusterSend(someChannel, "hello");
    await core.messagePropagation();

    expect(listener.mock.calls).toEqual([["hello", "cluster some-cluster"]]);
  });

  it("sends messages that come while a batch is in flight in the next batch, in sending order", async () => {
    const received: unknown[] = [];

    core.listen("some-channel", (message) => received.push(message));
    send(someChannel, 1);
    send(someChannel, 2);
    send(someChannel, 3);
    await core.messagePropagation();

    expect(received).toEqual([1, 2, 3]);
    expect(core.calls.filter(({ route }) => route === "/ipc/messages").map(({ body }) => body)).toEqual([
      { messages: [{ channel: "some-channel", payload: 1 }] },
      {
        messages: [
          { channel: "some-channel", payload: 2 },
          { channel: "some-channel", payload: 3 },
        ],
      },
    ]);
  });

  it("logs a batch the core refuses with its channel ids, and does not send it again", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    core.failNext("/ipc/messages", { status: 403, statusText: "Forbidden", body: undefined });
    send(someChannel, "refused");
    await core.messagePropagation();

    expect(error).toHaveBeenCalledWith(expect.stringContaining("some-channel"));
    expect(core.calls.filter(({ route }) => route === "/ipc/messages")).toHaveLength(1);
  });

  it("raises nothing in the sender for a channel nobody listens to", async () => {
    expect(() => send(getMessageChannel("nobody-listens"), "x")).not.toThrow();
    await core.messagePropagation();
  });

  it("sends a message without a value with no payload", async () => {
    const listener = vi.fn();

    core.listen("some-channel", listener);
    send(someChannel, undefined);
    await core.messagePropagation();

    expect(listener).toHaveBeenCalledWith(undefined, "main");
  });

  it("throws before sending anything a value JSON would change", () => {
    expect(() => send(someChannel, new Date(0))).toThrow(TypeError);
    expect(core.calls).toEqual([]);
  });
});
