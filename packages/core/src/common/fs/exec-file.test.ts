/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { describe, expect, it } from "vitest";
import execFileInjectable from "./exec-file.injectable";

import type { DiContainerForInjection } from "@ogre-tools/injectable";

describe("execFile", () => {
  const execFile = execFileInjectable.instantiate({} as DiContainerForInjection);
  const echoStdin = ["-e", "process.stdin.pipe(process.stdout)"];

  it("writes the input to the standard input of the child, and closes it", async () => {
    expect(await execFile(process.execPath, echoStdin, { input: "some-secret" })).toEqual({
      callWasSuccessful: true,
      response: "some-secret",
    });
  });
});
