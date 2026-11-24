/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { describe, expect, it } from "vitest";
import { packageMirrors } from "../../../../../../user-preferences/common/preferences-helpers";
import { downloadMirrorOptions } from "./kubectl-download-mirror";

describe("kubectl download mirror options", () => {
  it("offers every mirror, none of them disabled, whatever the platform", () => {
    expect(downloadMirrorOptions).toEqual(
      Array.from(packageMirrors, ([name, mirror]) => ({ value: name, label: mirror.label })),
    );
    expect(downloadMirrorOptions.some((option) => "isDisabled" in option)).toBe(false);
  });
});
