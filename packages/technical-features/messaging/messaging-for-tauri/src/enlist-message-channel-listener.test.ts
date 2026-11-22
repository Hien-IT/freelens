/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { enlistMessageChannelListenerInjectionToken, getMessageChannel } from "@freelensapp/messaging";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createView } from "./test-utils/create-view";
import { clusterHost, getCoreFake, mainHost } from "./test-utils/get-core-fake";

import type { DiContainer } from "@ogre-tools/injectable";

import type { CoreFake } from "./test-utils/get-core-fake";

const someChannel = getMessageChannel<unknown>("some-channel");

const enlist = (view: DiContainer, handler: (message: unknown) => void) =>
  view.inject(enlistMessageChannelListenerInjectionToken)({ id: "some-listener", channel: someChannel, handler });

describe("listening to messages from the core", () => {
  let core: CoreFake;
  let view: DiContainer;

  const polls = () => core.calls.filter(({ route }) => route === "/ipc/poll");

  beforeEach(() => {
    vi.useFakeTimers();
    core = getCoreFake();
    view = createView(core, mainHost);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts polling at the first listener, with a random session and after 0", async () => {
    expect(polls()).toEqual([]);

    enlist(view, () => {});
    await core.messagePropagation();

    expect(polls()).toEqual([
      { route: "/ipc/poll", view: "main", body: { session: expect.stringMatching(/^[A-Za-z0-9-]{1,64}$/), after: 0 } },
    ]);
  });

  it("hands the core's messages to the listeners of their channel in order, each once", async () => {
    const received: unknown[] = [];

    enlist(view, (message) => received.push(message));
    await core.messagePropagation();

    core.send("some-channel", "a");
    core.send("other-channel", "x");
    core.send("some-channel", "b");
    await core.messagePropagation();

    expect(received).toEqual(["a", "b"]);
  });

  it("acknowledges what it handled in the next poll", async () => {
    enlist(view, () => {});
    await core.messagePropagation();

    core.send("some-channel", "a");
    await core.messagePropagation();

    expect(polls().at(-1)?.body).toEqual({ session: expect.any(String), after: 1 });
  });

  it("ignores a sequence number it has already handled", async () => {
    const received: unknown[] = [];

    enlist(view, (message) => received.push(message));
    await core.messagePropagation();
    core.send("some-channel", "a");
    await core.messagePropagation();

    core.failNext("/ipc/poll", {
      status: 200,
      statusText: "OK",
      body: { messages: [{ seq: 1, channel: "some-channel", payload: "a" }] },
    });
    await vi.advanceTimersByTimeAsync(25_000);
    await core.messagePropagation();

    expect(received).toEqual(["a"]);
  });

  it("polls again at once after an empty answer at 25 seconds", async () => {
    enlist(view, () => {});
    await core.messagePropagation();

    await vi.advanceTimersByTimeAsync(24_999);
    expect(polls()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    await core.messagePropagation();
    expect(polls()).toHaveLength(2);
  });

  it("retries a failed poll after 100 ms, doubling up to 2 s, with the same session and after", async () => {
    for (let failure = 0; failure < 7; failure++) {
      core.failNext("/ipc/poll", new Error("Load failed"));
    }

    enlist(view, () => {});
    await core.messagePropagation();

    const waits: number[] = [];

    for (const wait of [100, 200, 400, 800, 1_600, 2_000, 2_000]) {
      const before = polls().length;

      await vi.advanceTimersByTimeAsync(wait - 1);
      expect(polls()).toHaveLength(before);
      await vi.advanceTimersByTimeAsync(1);
      await core.messagePropagation();
      expect(polls()).toHaveLength(before + 1);
      waits.push(wait);
    }

    expect(new Set(polls().map(({ body }) => JSON.stringify(body))).size).toBe(1);
    expect(waits).toHaveLength(7);
  });

  it("delivers a message the core sends once to each of three views", async () => {
    const received: string[] = [];
    const views = [mainHost, clusterHost("one"), clusterHost("two")];

    for (const host of views) {
      enlist(host === mainHost ? view : createView(core, host), () => received.push(host));
    }

    await core.messagePropagation();
    core.send("some-channel", "everyone");
    await core.messagePropagation();

    expect(received.sort()).toEqual([...views].sort());
  });

  it("hands nothing more to a disposed listener", async () => {
    const handler = vi.fn();
    const dispose = enlist(view, handler);

    await core.messagePropagation();
    dispose();
    core.send("some-channel", "late");
    await core.messagePropagation();

    expect(handler).not.toHaveBeenCalled();
  });
});
