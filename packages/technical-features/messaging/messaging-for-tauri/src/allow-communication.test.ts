/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { startApplicationInjectionToken } from "@freelensapp/application";
import { enlistRequestChannelListenerInjectionToken, getRequestChannel } from "@freelensapp/messaging";
import { describe, expect, it, vi } from "vitest";
import { createView } from "./test-utils/create-view";
import { clusterHost, getCoreFake } from "./test-utils/get-core-fake";

describe("a view of the Tauri build", () => {
  it("announces itself on frame-communication-admin-channel when the application loads", async () => {
    const core = getCoreFake();
    const announced = vi.fn();
    const view = createView(core, clusterHost("some-cluster"));

    core.listen("frame-communication-admin-channel", announced);
    await view.inject(startApplicationInjectionToken)();
    await core.messagePropagation();

    expect(announced).toHaveBeenCalledWith(undefined, "cluster some-cluster");
  });

  it("answers no request", () => {
    const view = createView(getCoreFake(), clusterHost("some-cluster"));

    expect(() =>
      view.inject(enlistRequestChannelListenerInjectionToken)({
        id: "some-listener",
        channel: getRequestChannel("some-channel"),
        handler: () => undefined,
      }),
    ).toThrow(/"some-channel"/);
  });
});
