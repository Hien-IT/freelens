/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectionToken } from "@ogre-tools/injectable";

export interface ParsedPath {
  root: string;
  dir: string;
  base: string;
  ext: string;
  name: string;
}

/** What the path injectables take from `node:path`, for the platform the application runs on. */
export interface PathModule {
  join(...paths: string[]): string;
  basename(path: string, suffix?: string): string;
  dirname(path: string): string;
  parse(path: string): ParsedPath;
  readonly sep: string;
}

/** `node:path` in main, and its port in the renderer, which has no Node. */
export const pathModuleInjectionToken = getInjectionToken<PathModule>({
  id: "path-module",
});
