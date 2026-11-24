/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { logWriterInjectionToken } from "../common/logger.injectable";
import { buildEntry, levels } from "./entry";
import { loggerTransportInjectionToken } from "./transports";

import type { Logger } from "../common/logger.injectable";
import type { LoggerTransport } from "./transports";

export interface RendererLogger extends Logger {
  /** Stops writing to the transport, and closes it, as winston's `remove` does. */
  remove(transport: LoggerTransport): void;
}

/** The level of winston's logger when none is given. */
const loggerLevel = "info";

const writes = (transport: LoggerTransport, level: string) => levels[transport.level ?? loggerLevel] >= levels[level];

export const createRendererLogger = (initialTransports: LoggerTransport[]): RendererLogger => {
  const transports = [...initialTransports];

  const writerFor =
    (level: keyof Logger) =>
    (message: string, ...data: unknown[]) => {
      const writing = transports.filter((transport) => writes(transport, level));

      if (writing.length === 0) {
        return;
      }

      const entry = buildEntry(level, message, data);

      for (const transport of writing) {
        if (entry.exception === true && !transport.handleExceptions) continue;

        transport.log(entry, () => {});
      }
    };

  return {
    error: writerFor("error"),
    warn: writerFor("warn"),
    info: writerFor("info"),
    debug: writerFor("debug"),
    silly: writerFor("silly"),
    remove: (transport) => {
      const index = transports.indexOf(transport);

      if (index !== -1) {
        transports.splice(index, 1);
        transport.close?.();
      }
    },
  };
};

export const rendererLoggerInjectable = getInjectable({
  id: "renderer-logger",
  instantiate: (di) => createRendererLogger(di.injectMany(loggerTransportInjectionToken)),
  injectionToken: logWriterInjectionToken,
});
