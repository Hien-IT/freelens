/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import os from "node:os";
import path from "node:path";
import { getInjectable } from "@ogre-tools/injectable";
import bundledBinaryPathInjectable from "../../../common/utils/main/bundled-binary-path.injectable";
import appNameInjectable from "../../../common/vars/app-name.injectable";
import userInfoInjectable from "../../../common/vars/main/user-info.injectable";
import { machineValuesInjectionToken } from "../common/token";

import type { MachineValues } from "../common/channel";

/** Each value is read when it is first asked for, as the injectables it replaces did. */
const machineValuesInjectable = getInjectable({
  id: "machine-values-for-main",
  instantiate: (di): MachineValues => ({
    get platform() {
      return process.platform as MachineValues["platform"];
    },
    get isDebugging() {
      return ["true", "1", "yes", "y", "on"].includes((process.env.DEBUG ?? "").toLowerCase());
    },
    get isSnap() {
      return Boolean(process.env.SNAP);
    },
    get isFlatpak() {
      return Boolean(process.env.FLATPAK_SANDBOX_DIR);
    },
    get homeDirectory() {
      const integrationTestingDirectory = process.env.FREELENS_INTEGRATION_TESTING_DIR;

      if (integrationTestingDirectory && integrationTestingDirectory.startsWith(os.tmpdir())) {
        return path.join(integrationTestingDirectory, di.inject(appNameInjectable), "home");
      }

      return di.inject(userInfoInjectable).homedir;
    },
    get kubeDirectory() {
      return path.join(di.inject(userInfoInjectable).homedir, ".kube");
    },
    get bundledHelmPath() {
      return di.inject(bundledBinaryPathInjectable, "helm");
    },
  }),
  injectionToken: machineValuesInjectionToken,
});

export default machineValuesInjectable;
