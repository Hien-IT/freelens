/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import {
  getMessageChannel,
  getRequestChannel,
  requestFromChannelInjectionToken,
  sendMessageToChannelInjectionToken,
} from "@freelensapp/messaging";
import { beforeEach, describe, expect, it } from "vitest";
import { createView } from "./test-utils/create-view";
import { clusterHost, getCoreFake, mainHost } from "./test-utils/get-core-fake";

import type { RequestFromChannel } from "@freelensapp/messaging";

import type { DiContainer } from "@ogre-tools/injectable";

import type { CoreFake } from "./test-utils/get-core-fake";

const doubleChannel = getRequestChannel<number, number>("double");
const anyChannel = (id: string) => getRequestChannel<unknown, unknown>(id);
const voidChannel = (id: string) => getRequestChannel<void, unknown>(id);

describe("requesting from the core", () => {
  let core: CoreFake;
  let view: DiContainer;
  let request: RequestFromChannel;

  beforeEach(() => {
    core = getCoreFake();
    view = createView(core, mainHost);
    request = view.inject(requestFromChannelInjectionToken);
  });

  it("resolves with the core's answer", async () => {
    core.answer("double", (value) => (value as number) * 2);

    expect(await request(doubleChannel, 21)).toBe(42);
  });

  it("resolves with undefined when the answer has no value", async () => {
    core.answer("nothing", () => undefined);

    expect(await request(voidChannel("nothing"))).toBeUndefined();
  });

  it("resolves with null when the answer is null", async () => {
    core.answer("null", () => null);

    expect(await request(voidChannel("null"))).toBeNull();
  });

  it("passes a request without a value as undefined", async () => {
    let received: unknown = "unset";

    core.answer("void", (value) => {
      received = value;
    });
    await request(voidChannel("void"));

    expect(received).toBeUndefined();
  });

  it("rejects as Electron does when the core answers no handler", async () => {
    await expect(request(voidChannel("missing"))).rejects.toThrow(
      "Error invoking remote method 'missing': Error: No handler registered for 'missing'",
    );
  });

  it("rejects with the message of the handler's error", async () => {
    core.answer("failing", () => {
      throw new Error("boom");
    });

    await expect(request(voidChannel("failing"))).rejects.toThrow(
      "Error invoking remote method 'failing': Error: boom",
    );
  });

  it("rejects with the message of a request the core cannot parse", async () => {
    core.failNext("/ipc/request", { status: 400, statusText: "Bad Request", body: { error: { message: "bad" } } });

    await expect(request(voidChannel("parse"))).rejects.toThrow("Error invoking remote method 'parse': Error: bad");
  });

  it("rejects with the status of any other answer", async () => {
    core.failNext("/ipc/request", { status: 403, statusText: "Forbidden", body: undefined });

    await expect(request(voidChannel("refused"))).rejects.toThrow(
      "Error invoking remote method 'refused': 403 Forbidden",
    );
  });

  it("rejects with the message of a failed fetch", async () => {
    core.failNext("/ipc/request", new Error("Load failed"));

    await expect(request(voidChannel("gone"))).rejects.toThrow("Error invoking remote method 'gone': Load failed");
  });

  it("rejects a request value JSON would change, naming the channel", async () => {
    await expect(request(anyChannel("dated"), new Date(0))).rejects.toThrow(/"dated"/);
    expect(core.calls).toEqual([]);
  });

  it("waits until the batch of a message sent before it is accepted", async () => {
    const order: string[] = [];
    const release = core.delayNext("/ipc/messages");

    core.listen("note", () => order.push("message"));
    core.answer("ask", () => order.push("request"));

    view.inject(sendMessageToChannelInjectionToken)(getMessageChannel("note"), "first");

    const answer = request(voidChannel("ask"));

    await Promise.resolve();
    expect(core.calls.map(({ route }) => route)).toEqual(["/ipc/messages"]);

    release();
    await answer;

    expect(order).toEqual(["message", "request"]);
  });

  it("does not make concurrent requests wait for each other", async () => {
    let releaseSlow = () => {};

    core.answer(
      "slow",
      () =>
        new Promise((resolve) => {
          releaseSlow = () => resolve("slow");
        }),
    );
    core.answer("fast", () => "fast");

    const slow = request(voidChannel("slow"));

    expect(await request(voidChannel("fast"))).toBe("fast");

    releaseSlow();
    expect(await slow).toBe("slow");
  });

  it("reaches the core as the cluster frame that asked", async () => {
    core.answer("who", (_, sender) => sender);

    const clusterRequest = createView(core, clusterHost("some-cluster")).inject(requestFromChannelInjectionToken);

    expect(await clusterRequest(voidChannel("who"))).toBe("cluster some-cluster");
  });
});
