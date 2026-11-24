/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { loggerTransportInjectionToken } from "@freelensapp/logger/main";
import { getInjectable } from "@ogre-tools/injectable";
import { transports } from "winston";
import directoryForLogsInjectable from "../../common/app-paths/directory-for-logs.injectable";

import type TransportStream from "winston-transport";

const fileLoggerTransportInjectable = getInjectable({
  id: "file-logger-transport",
  // typed by name, as the declaration of the extension API has to write the type
  instantiate: (di): TransportStream =>
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
