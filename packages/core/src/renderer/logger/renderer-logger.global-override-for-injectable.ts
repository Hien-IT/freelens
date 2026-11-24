/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { rendererLoggerInjectable } from "@freelensapp/logger/renderer";
import { getGlobalOverride } from "@freelensapp/test-utils";
import { noop } from "@freelensapp/utilities";

export default getGlobalOverride(rendererLoggerInjectable, () => ({
  remove: noop,

  warn: noop,
  debug: noop,
  error: noop,
  info: noop,
  silly: noop,
}));
