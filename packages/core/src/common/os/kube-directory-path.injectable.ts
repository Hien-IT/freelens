/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { machineValuesInjectionToken } from "../../features/machine-values/common/token";

const kubeDirectoryPathInjectable = getInjectable({
  id: "kube-directory-path",
  instantiate: (di) => di.inject(machineValuesInjectionToken).kubeDirectory,
});

export default kubeDirectoryPathInjectable;
