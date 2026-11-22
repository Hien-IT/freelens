/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { registerFeature } from "@freelensapp/feature-core";
import { sendMessageToWindowInjectionToken } from "@freelensapp/messaging";
import { createContainer } from "@ogre-tools/injectable";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { messagingFeatureForMain } from "../feature";
import getWebContentsByIdInjectable from "./get-web-contents-by-id.injectable";

import type { SendMessageToWindow } from "@freelensapp/messaging";

import type { WebContents } from "electron";

describe("send message to window", () => {
  let sendMessageToWindow: SendMessageToWindow;
  let contents: { send: ReturnType<typeof vi.fn>; sendToFrame: ReturnType<typeof vi.fn>; isDestroyed: () => boolean };

  beforeEach(() => {
    const di = createContainer("irrelevant");

    registerFeature(di, messagingFeatureForMain);

    contents = { send: vi.fn(), sendToFrame: vi.fn(), isDestroyed: () => false };
    di.override(
      getWebContentsByIdInjectable,
      () => (id: number) => (id === 1 ? (contents as unknown as WebContents) : undefined),
    );

    sendMessageToWindow = di.inject(sendMessageToWindowInjectionToken);
  });

  it("sends to the main frame of the window without a frame", () => {
    sendMessageToWindow({ windowId: 1 }, "some-channel", "some-message");

    expect(contents.send).toHaveBeenCalledWith("some-channel", "some-message");
    expect(contents.sendToFrame).not.toHaveBeenCalled();
  });

  it("sends to the frame of the window", () => {
    sendMessageToWindow({ windowId: 1, frame: { processId: 7, frameId: 42 } }, "some-channel", "some-message");

    expect(contents.sendToFrame).toHaveBeenCalledWith([7, 42], "some-channel", "some-message");
    expect(contents.send).not.toHaveBeenCalled();
  });

  it("sends nothing to a window that is gone", () => {
    contents.isDestroyed = () => true;

    sendMessageToWindow({ windowId: 1 }, "some-channel", "some-message");
    sendMessageToWindow({ windowId: 2 }, "some-channel", "some-message");

    expect(contents.send).not.toHaveBeenCalled();
  });
});
