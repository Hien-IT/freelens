/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { describe, expect, it } from "vitest";
import { getDiForUnitTesting } from "../../../../renderer/getDiForUnitTesting";
import appPathsInjectable from "../../app-paths.injectable";
import directoryForUserDataInjectable from "../directory-for-user-data.injectable";

import type { AppPaths } from "../../app-path-injection-token";

describe("directory-for-user-data in the renderer", () => {
  it("is the user data directory main answered", () => {
    const di = getDiForUnitTesting();

    di.override(appPathsInjectable, () => ({ userData: "/some-user-data" }) as AppPaths);

    expect(di.inject(directoryForUserDataInjectable)).toBe("/some-user-data");
  });
});
