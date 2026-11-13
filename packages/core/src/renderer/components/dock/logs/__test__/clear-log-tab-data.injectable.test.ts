/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { describe, expect, it, vi } from "vitest";
import { getDiForUnitTesting } from "../../../../getDiForUnitTesting";
import clearLogTabDataInjectable from "../clear-log-tab-data.injectable";
import logStoreInjectable from "../store.injectable";

import type { LogStore } from "../store";

describe("clear log tab data", () => {
  it("clears the lines of the tab and stops loading them", () => {
    const di = getDiForUnitTesting();
    const clearLogs = vi.fn();

    di.override(logStoreInjectable, () => ({ clearLogs }) as Partial<LogStore> as LogStore);

    di.inject(clearLogTabDataInjectable)("some-tab-id");

    expect(clearLogs).toHaveBeenCalledWith("some-tab-id");
  });
});
