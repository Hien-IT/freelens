/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { getDiForUnitTesting } from "../getDiForUnitTesting";
import currentlyInClusterFrameInjectable from "./currently-in-cluster-frame.injectable";

describe("currently-in-cluster-frame", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is false in the root frame, which is its own top", () => {
    expect(currentlyInClusterFrameInjectable.instantiate(getDiForUnitTesting())).toBe(false);
  });

  it("is true in a frame whose top is another window", () => {
    vi.spyOn(window, "top", "get").mockReturnValue({} as Window);

    expect(currentlyInClusterFrameInjectable.instantiate(getDiForUnitTesting())).toBe(true);
  });
});
