/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { observable } from "mobx";

import type { Cluster } from "../../../common/cluster/cluster";

/** What the dialog shows of a kubeconfig, which main reads: the names of its contexts and the current one. */
export interface DeleteClusterDialogKubeconfig {
  readonly contexts: readonly { readonly name: string }[];
  readonly currentContext?: string;
}

export interface DeleteClusterDialogState {
  config: DeleteClusterDialogKubeconfig;
  cluster: Cluster;
  showContextSwitch: boolean;
  newCurrentContext: string;
}

const deleteClusterDialogStateInjectable = getInjectable({
  id: "delete-cluster-dialog-state",
  instantiate: () => observable.box<DeleteClusterDialogState | undefined>(),
});

export default deleteClusterDialogStateInjectable;
