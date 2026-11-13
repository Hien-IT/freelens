/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { loggerInjectionToken } from "@freelensapp/logger";
import { describe, expect, it, vi } from "vitest";
import { getDiForUnitTesting } from "../../../main/getDiForUnitTesting";
import persistStateToConfigInjectable from "./persist-state-to-config.injectable";

import type { Logger } from "@freelensapp/logger";

import type Config from "conf";

describe("persist-state-to-config in main", () => {
  it("saves every key even when one fails, and deletes keys whose value is undefined", () => {
    const di = getDiForUnitTesting();
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), silly: vi.fn() };

    di.override(loggerInjectionToken, () => logger as unknown as Logger);

    const set = vi.fn((key: string) => {
      if (key === "failing") {
        throw new Error("EACCES");
      }
    });
    const del = vi.fn();
    const config = { path: "/some/config.json", set, delete: del } as unknown as Config<Record<string, unknown>>;

    di.inject(persistStateToConfigInjectable)(config, { failing: 1, cleared: undefined, last: 2 });

    expect(set).toHaveBeenCalledWith("last", 2);
    expect(set).not.toHaveBeenCalledWith("cleared", undefined);
    expect(del).toHaveBeenCalledWith("cleared");
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('"failing" to /some/config.json'),
      expect.any(Error),
    );
  });
});
