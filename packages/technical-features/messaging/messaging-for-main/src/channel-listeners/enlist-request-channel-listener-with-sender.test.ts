/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { registerFeature } from "@freelensapp/feature-core";
import { createContainer } from "@ogre-tools/injectable";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { messagingFeatureForMain } from "../feature";
import ipcMainInjectable from "../ipc-main/ipc-main.injectable";
import enlistRequestChannelListenerInjectable from "./enlist-request-channel-listener.injectable";

import type { RequestChannel } from "@freelensapp/messaging";

import type { IpcMain, IpcMainInvokeEvent } from "electron";
import type { Mock } from "vitest";

import type { EnlistRequestChannelListener } from "./enlist-request-channel-listener.injectable";

const testRequestChannel: RequestChannel<unknown, unknown> = {
  id: "some-channel-id",
};

const event = { frameId: 42, processId: 7 } as IpcMainInvokeEvent;

describe("enlist request channel listener in main, for a listener that asks for its sender", () => {
  let enlistRequestChannelListener: EnlistRequestChannelListener;
  let handleMock: Mock;

  beforeEach(() => {
    const di = createContainer("irrelevant");

    registerFeature(di, messagingFeatureForMain);

    handleMock = vi.fn();
    di.override(ipcMainInjectable, () => ({ handle: handleMock, off: vi.fn() }) as unknown as IpcMain);

    enlistRequestChannelListener = di.inject(enlistRequestChannelListenerInjectable);
  });

  it("calls the handler with the request and the frame and process of its sender", async () => {
    const handler = vi.fn().mockReturnValue("some-response");

    enlistRequestChannelListener({ id: "some-listener", channel: testRequestChannel, handler, withSender: true });

    expect(await handleMock.mock.calls[0][1](event, "some-request")).toBe("some-response");
    expect(handler).toHaveBeenCalledWith("some-request", { frameId: 42, processId: 7 });
  });

  it("calls a handler that does not ask for its sender with the request only", async () => {
    const handler = vi.fn();

    enlistRequestChannelListener({ id: "some-listener", channel: testRequestChannel, handler });
    await handleMock.mock.calls[0][1](event, "some-request");

    expect(handler.mock.calls).toEqual([["some-request"]]);
  });
});
