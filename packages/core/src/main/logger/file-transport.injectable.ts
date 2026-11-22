/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { loggerTransportInjectionToken } from "@freelensapp/logger";
import { getInjectable } from "@ogre-tools/injectable";
import { transports } from "winston";
import directoryForLogsInjectable from "../../common/app-paths/directory-for-logs.injectable";

const fileLoggerTransportInjectable = getInjectable({
  id: "file-logger-transport",
  instantiate: (di) =>
    new transports.File({
      handleExceptions: false,
      level: "debug",
      filename: "lens.log",
      /**
       * SAFETY: this transport is registered in the main process only
       */
      dirname: di.inject(directoryForLogsInjectable),
      maxsize: 1024 * 1024,
      maxFiles: 16,
      tailable: true,
    }),
  injectionToken: loggerTransportInjectionToken,
});

export default fileLoggerTransportInjectable;
