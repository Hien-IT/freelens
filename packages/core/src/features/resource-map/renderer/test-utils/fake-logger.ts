/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { vi } from "vitest";

import type { Logger } from "@freelensapp/logger";

/** A logger whose functions record their calls. */
export function fakeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    silly: vi.fn(),
  } satisfies Logger;
}
