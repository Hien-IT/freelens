/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { createContainer, getInjectionToken } from "@ogre-tools/injectable";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nodeEnvInjectable } from "./node-env.injectable";

// The renderer library needs a DOM, which this project's node environment lacks.
vi.mock("@freelensapp/core/renderer", () => ({
  nodeEnvInjectionToken: getInjectionToken({ id: "node-env-injection-token" }),
}));

describe("node-env in the renderer", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is development in a development build", () => {
    vi.stubEnv("DEV", true);

    expect(nodeEnvInjectable.instantiate(createContainer("test"))).toBe("development");
  });

  it("is production in a production build", () => {
    vi.stubEnv("DEV", false);

    expect(nodeEnvInjectable.instantiate(createContainer("test"))).toBe("production");
  });
});
