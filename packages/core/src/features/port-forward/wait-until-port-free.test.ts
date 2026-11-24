/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMainAndRenderer } from "../../test-utils/channels-between-main-and-renderer";
import waitUntilPortFreeRequestListenerInjectable from "./main/request-listener.injectable";
import waitUntilFreeInjectable from "./main/wait-until-free.injectable";
import waitUntilPortFreeInjectable from "./renderer/wait-until-port-free.injectable";

import type { DiContainer } from "@ogre-tools/injectable";
import type { Mock } from "vitest";

describe("wait-until-port-free", () => {
  let rendererDi: DiContainer;
  let waitUntilFree: Mock<(port: number) => Promise<void>>;

  beforeEach(() => {
    const both = getMainAndRenderer();

    rendererDi = both.rendererDi;
    waitUntilFree = vi.fn<(port: number) => Promise<void>>().mockResolvedValue(undefined);
    both.mainDi.override(waitUntilFreeInjectable, () => waitUntilFree);
    both.listenInMain(waitUntilPortFreeRequestListenerInjectable);
  });

  it("waits in main for the port the renderer names", async () => {
    await rendererDi.inject(waitUntilPortFreeInjectable)(8080);

    expect(waitUntilFree).toHaveBeenCalledWith(8080);
  });

  it("fails in the renderer as main's wait fails", async () => {
    waitUntilFree.mockRejectedValue(new Error("timeout"));

    await expect(rendererDi.inject(waitUntilPortFreeInjectable)(8080)).rejects.toThrow("timeout");
  });

  it.each([0, 65536, 1.5, Number.NaN])("refuses %s, which is not a port", async (port) => {
    await expect(rendererDi.inject(waitUntilPortFreeInjectable)(port)).rejects.toThrow("is not a port");

    expect(waitUntilFree).not.toHaveBeenCalled();
  });
});
