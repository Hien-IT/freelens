/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { loggerInjectionToken } from "@freelensapp/logger";
import { afterEach, describe, expect, it, vi } from "vitest";
import directoryForUserDataInjectable from "../../../common/app-paths/directory-for-user-data/directory-for-user-data.injectable";
import readFileBufferSyncInjectable from "../../../common/fs/read-file-buffer-sync.injectable";
import writeBufferSyncInjectable from "../../../common/fs/write-buffer-sync.injectable";
import getConfigurationFileModelInjectable from "../../../common/get-configuration-file-model/get-configuration-file-model.injectable";
import { getDiForUnitTesting } from "../../../main/getDiForUnitTesting";
import createPersistentStorageInjectable from "./create.injectable";

import type { Logger } from "@freelensapp/logger";

import type Config from "conf";
import type { Options } from "conf";

describe("createPersistentStorage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps a copy of a config file that is not valid JSON and starts over with the defaults", () => {
    const di = getDiForUnitTesting();
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), silly: vi.fn() };
    const calls: Options<Record<string, unknown>>[] = [];

    di.override(loggerInjectionToken, () => logger as unknown as Logger);
    di.override(directoryForUserDataInjectable, () => "/some-user-data");
    di.override(getConfigurationFileModelInjectable, () => (options) => {
      calls.push(options as Options<Record<string, unknown>>);

      if (!options.clearInvalidConfig) {
        throw new SyntaxError("The config file is not valid JSON.");
      }

      return { store: { value: "default" }, path: "/some-user-data/some-config.json" } as unknown as Config<any>;
    });
    vi.spyOn(Date, "now").mockReturnValue(1234);

    di.inject(writeBufferSyncInjectable)("/some-user-data/some-config.json", Buffer.from("{ broken"));

    const fromStore = vi.fn();
    const storage = di.inject(createPersistentStorageInjectable)({
      configName: "some-config",
      projectVersion: "1.0.0",
      fromStore,
      toJSON: () => ({ value: "default" }),
    });

    storage.loadAndStartSyncing();
    storage.stopSyncing();

    expect(calls).toHaveLength(2);
    expect(fromStore).toHaveBeenCalledWith({ value: "default" });
    expect(di.inject(readFileBufferSyncInjectable)("/some-user-data/some-config.corrupt-1234.json").toString()).toBe(
      "{ broken",
    );
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("is not valid JSON"), expect.any(SyntaxError));
  });
});
