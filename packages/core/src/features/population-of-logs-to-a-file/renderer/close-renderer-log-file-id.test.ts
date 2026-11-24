/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { rendererLoggerInjectable } from "@freelensapp/logger/renderer";
import { sendMessageToChannelInjectionToken } from "@freelensapp/messaging";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDiForUnitTesting } from "../../../renderer/getDiForUnitTesting";
import closeRendererLogFileInjectable from "./close-renderer-log-file.injectable";
import ipcLogTransportInjectable from "./ipc-transport.injectable";
import rendererLogFileIdInjectable from "./renderer-log-file-id.injectable";

import type { RendererLogger } from "@freelensapp/logger/renderer";
import type { SendMessageToChannel } from "@freelensapp/messaging";

import type { DiContainer } from "@ogre-tools/injectable";

import type IpcLogTransport from "./ipc-transport";

describe("close renderer file logging", () => {
  let di: DiContainer;
  let sendIpcMock: SendMessageToChannel;
  let winstonMock: RendererLogger;
  let ipcTransportMock: IpcLogTransport;

  beforeEach(() => {
    di = getDiForUnitTesting();
    sendIpcMock = vi.fn();
    winstonMock = {
      remove: vi.fn(),
    } as any as RendererLogger;
    ipcTransportMock = { name: "ipc-renderer-transport" } as IpcLogTransport;

    di.override(rendererLoggerInjectable, () => winstonMock);
    di.override(sendMessageToChannelInjectionToken, () => sendIpcMock);
    di.override(rendererLogFileIdInjectable, () => "some-log-id");
    di.override(ipcLogTransportInjectable, () => ipcTransportMock);
  });

  it("removes the transport to prevent further logging to closed file", () => {
    const closeLog = di.inject(closeRendererLogFileInjectable);

    closeLog();

    expect(winstonMock.remove).toHaveBeenCalledWith({
      name: "ipc-renderer-transport",
    });
  });
});
