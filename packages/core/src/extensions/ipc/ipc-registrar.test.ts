/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { IpcPrefix, IpcRegistrar } from "./ipc-registrar";

import type { LensExtension } from "../lens-extension";

describe("IpcRegistrar", () => {
  it.each(["@some/extension", "some-extension", "ünïcödé-extension"])(
    "prefixes the channels of %s as main does with node:crypto",
    (id) => {
      // a class of its own per case, as each is a singleton, which needs a name
      class SomeRegistrar extends IpcRegistrar {}

      const registrar = SomeRegistrar.createInstance({ id } as LensExtension);

      expect(registrar[IpcPrefix]).toBe(createHash("sha256").update(id).digest("hex"));
    },
  );
});
