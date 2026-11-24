/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { LoggerTransport } from "@freelensapp/logger/renderer";

import type { LogEntry, LoggerTransportOptions } from "@freelensapp/logger/renderer";

interface IpcLogTransportOptions extends LoggerTransportOptions {
  sendIpcLogMessage: (entry: LogEntry) => void;
  closeIpcLogging: () => void;
}

class IpcLogTransport extends LoggerTransport {
  sendIpcLogMessage: (entry: LogEntry) => void;
  closeIpcLogging: () => void;
  name = "ipc-renderer-transport";

  constructor(options: IpcLogTransportOptions) {
    const { sendIpcLogMessage, closeIpcLogging, ...transportOptions } = options;

    super(transportOptions);

    this.sendIpcLogMessage = sendIpcLogMessage;
    this.closeIpcLogging = closeIpcLogging;
  }

  log(logEntry: LogEntry, next: () => void) {
    this.emitLogged(logEntry);
    this.sendIpcLogMessage(logEntry);
    next();
  }

  close() {
    this.closeIpcLogging();
  }
}

export default IpcLogTransport;
