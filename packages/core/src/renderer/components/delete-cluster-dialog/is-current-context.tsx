/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import type { Cluster } from "../../../common/cluster/cluster";
import type { DeleteClusterDialogKubeconfig } from "./state.injectable";

export function isCurrentContext(config: DeleteClusterDialogKubeconfig, cluster: Cluster) {
  return config.currentContext == cluster.contextName.get();
}
