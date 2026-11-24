/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getGlobalOverride } from "@freelensapp/test-utils";
import machineValuesStateInjectable from "./state.injectable";

import type { MachineValues } from "../common/channel";

/**
 * The values main has in unit tests, until the startup of a test application
 * replaces them with what its main answers.
 */
export default getGlobalOverride(machineValuesStateInjectable, () => {
  let values: MachineValues = {
    platform: "darwin",
    isDebugging: false,
    isSnap: false,
    isFlatpak: false,
    homeDirectory: "/some-home-dir",
    kubeDirectory: "/some-home-dir/.kube",
    bundledHelmPath: "/some-bundled-binaries-dir/helm",
  };

  return {
    get: () => values,
    set: (newValues) => {
      values = newValues;
    },
  };
});
