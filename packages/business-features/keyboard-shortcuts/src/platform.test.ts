/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { describe, expect, it } from "vitest";
import { platformOfNavigator } from "./platform.injectable";

describe("platformOfNavigator", () => {
  it.each([
    ["MacIntel", "darwin"],
    ["Win32", "win32"],
    ["Linux x86_64", "linux"],
    ["Linux aarch64", "linux"],
  ])("takes %s for %s", (navigatorPlatform, platform) => {
    expect(platformOfNavigator(navigatorPlatform)).toBe(platform);
  });
});
