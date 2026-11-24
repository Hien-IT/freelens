/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

export { MESSAGE, SPLAT } from "./src/renderer/entry";
export { loggerFeatureForRenderer } from "./src/renderer/feature";
export { createRendererLogger, rendererLoggerInjectable } from "./src/renderer/renderer-logger.injectable";
export { LoggerTransport, loggerTransportInjectionToken } from "./src/renderer/transports";

export type { LogEntry } from "./src/renderer/entry";
export type { RendererLogger } from "./src/renderer/renderer-logger.injectable";
export type { LoggerTransportOptions } from "./src/renderer/transports";
