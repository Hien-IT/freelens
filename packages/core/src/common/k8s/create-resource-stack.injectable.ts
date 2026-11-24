/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { loggerInjectionToken } from "@freelensapp/logger";
import { getInjectable } from "@ogre-tools/injectable";
import { kubectlApplyAllInjectionToken, kubectlDeleteAllInjectionToken } from "../kube-helpers/channels";
import { readResourceFolderInjectionToken } from "./read-resource-folder";
import { ResourceStack } from "./resource-stack";

import type { KubernetesCluster } from "../catalog-entities";
import type { ResourceApplyingStack, ResourceStackDependencies } from "./resource-stack";

export type CreateResourceStack = (cluster: KubernetesCluster, name: string) => ResourceApplyingStack;

const createResourceStackInjectable = getInjectable({
  id: "create-resource-stack",
  instantiate: (di): CreateResourceStack => {
    const deps: ResourceStackDependencies = {
      kubectlApplyAll: di.inject(kubectlApplyAllInjectionToken),
      kubectlDeleteAll: di.inject(kubectlDeleteAllInjectionToken),
      logger: di.inject(loggerInjectionToken),
      readFolder: di.inject(readResourceFolderInjectionToken),
    };

    return (cluster, name) => new ResourceStack(deps, cluster, name);
  },
});

export default createResourceStackInjectable;
