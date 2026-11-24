/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { withInjectables } from "@ogre-tools/injectable-react";
import { observer } from "mobx-react";
import React from "react";
import revealClusterKubeconfigInjectable from "../../../features/cluster/reveal-kubeconfig/renderer/reveal-cluster-kubeconfig.injectable";
import { Notice } from "../extensions/notice";
import { SubTitle } from "../layout/sub-title";

import type { Cluster } from "../../../common/cluster/cluster";
import type { RevealClusterKubeconfig } from "../../../features/cluster/reveal-kubeconfig/renderer/reveal-cluster-kubeconfig.injectable";

export interface ClusterKubeconfigProps {
  cluster: Cluster;
}

interface Dependencies {
  revealClusterKubeconfig: RevealClusterKubeconfig;
}

@observer
class NonInjectedClusterKubeconfig extends React.Component<ClusterKubeconfigProps & Dependencies> {
  openKubeconfig = () => {
    const { cluster, revealClusterKubeconfig } = this.props;

    void revealClusterKubeconfig(cluster.id);
  };

  render() {
    return (
      <Notice className="mb-14 mt-3">
        <SubTitle title="Kubeconfig" />
        <span>
          <a className="link value" onClick={this.openKubeconfig}>
            {this.props.cluster.kubeConfigPath.get()}
          </a>
        </span>
      </Notice>
    );
  }
}

export const ClusterKubeconfig = withInjectables<Dependencies, ClusterKubeconfigProps>(NonInjectedClusterKubeconfig, {
  getProps: (di, props) => ({
    ...props,
    revealClusterKubeconfig: di.inject(revealClusterKubeconfigInjectable),
  }),
});
