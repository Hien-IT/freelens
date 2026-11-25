/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { readlinkSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { getInjectable } from "@ogre-tools/injectable";
import directoryForUserDataInjectable from "../../../common/app-paths/directory-for-user-data/directory-for-user-data.injectable";

/** The link the Tauri build holds in the data directory, in the format of Chromium's `SingletonLock`. */
export const tauriLockName = "FreelensTauriLock";

export interface TauriBuildLock {
  readonly dataDirectory: string;
  readonly linkPath: string;
}

/**
 * Whether a `<hostname>-<pid>` target names a process that may be running: one
 * of another host, as Chromium assumes for its own lock, or one `isAlive` finds.
 */
export function isLiveTarget(target: string, thisHost: string, isAlive: (pid: number) => boolean): boolean {
  const separator = target.lastIndexOf("-");
  const host = target.slice(0, separator);
  const pid = target.slice(separator + 1);

  if (separator <= 0 || !/^\d+$/.test(pid) || Number(pid) <= 0) {
    return false;
  }

  return host !== thisHost || isAlive(Number(pid));
}

const isProcessAlive = (pid: number) => {
  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

export type IsTauriBuildRunning = () => TauriBuildLock | undefined;

/**
 * The Tauri build of Freelens using the same data directory, if it runs
 * (`specs/007-main-foundation/contracts/instance-lock.md`).
 */
const isTauriBuildRunningInjectable = getInjectable({
  id: "is-tauri-build-running",

  instantiate:
    (di): IsTauriBuildRunning =>
    () => {
      const dataDirectory = di.inject(directoryForUserDataInjectable);
      const linkPath = path.join(dataDirectory, tauriLockName);
      let target: string;

      try {
        target = readlinkSync(linkPath);
      } catch {
        return undefined;
      }

      return isLiveTarget(target, hostname(), isProcessAlive) ? { dataDirectory, linkPath } : undefined;
    },

  causesSideEffects: true,
});

export default isTauriBuildRunningInjectable;
