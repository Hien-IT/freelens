/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectionToken } from "@ogre-tools/injectable";

import type { LogEntry } from "./entry";

export interface LoggerTransportOptions {
  /** The least severe level it writes; the logger's level when left out. */
  level?: string;
  handleExceptions?: boolean;
}

/**
 * A transport of the renderer's logger: what `winston-transport` is to winston,
 * without the Node streams it is built on.
 */
export abstract class LoggerTransport extends EventTarget {
  readonly level?: string;
  readonly handleExceptions?: boolean;

  constructor({ level, handleExceptions }: LoggerTransportOptions = {}) {
    super();
    this.level = level;
    this.handleExceptions = handleExceptions;
  }

  abstract log(entry: LogEntry, next: () => void): void;

  /** Called when the logger removes the transport. */
  close?(): void;

  /** Signals `logged` once the entry is written, after the current task, as `winston-transport` does. */
  protected emitLogged(entry: LogEntry) {
    setTimeout(() => this.dispatchEvent(new CustomEvent("logged", { detail: entry })), 0);
  }
}

export const loggerTransportInjectionToken = getInjectionToken<LoggerTransport>({
  id: "renderer-logger-transport",
});
