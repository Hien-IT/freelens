/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannel } from "@freelensapp/messaging";

import type { allPlatforms } from "../../../common/vars/platform.injectable";

/** The values of the machine that the renderer reads, which only main can compute. */
export interface MachineValues {
  platform: (typeof allPlatforms)[number];
  isDebugging: boolean;
  isSnap: boolean;
  isFlatpak: boolean;
  homeDirectory: string;
  kubeDirectory: string;
  bundledHelmPath: string;
}

export const machineValuesChannel = getRequestChannel<void, MachineValues>("machine-values");
