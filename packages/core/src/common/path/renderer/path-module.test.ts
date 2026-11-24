/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { describe, expect, it } from "vitest";
import { getDiForUnitTesting } from "../../../renderer/getDiForUnitTesting";
import platformInjectable from "../../vars/platform.injectable";
import { pathModuleInjectionToken } from "../path-module-injection-token";

describe("the path module of the renderer", () => {
  it.each([
    ["win32", "a\\b", "\\"],
    ["darwin", "a/b", "/"],
    ["linux", "a/b", "/"],
  ] as const)("on %s, joins and separates as node:path does there", (platform, joined, sep) => {
    const di = getDiForUnitTesting();

    di.override(platformInjectable, () => platform);

    const pathModule = di.inject(pathModuleInjectionToken);

    expect(pathModule.join("a", "b")).toBe(joined);
    expect(pathModule.sep).toBe(sep);
  });
});
