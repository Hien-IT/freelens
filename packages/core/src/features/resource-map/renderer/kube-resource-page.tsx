/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { TabLayout } from "../../../renderer/components/layout/tab-layout";
import { NamespaceSelectFilter } from "../../../renderer/components/namespaces/namespace-select-filter";
import { KubeResourceMap } from "./kube-resource-map";
import styles from "./kube-resource-page.module.scss";

import type { ResourceMapDependencies } from "./dependencies";

export interface KubeResourcePageProps {
  dependencies: ResourceMapDependencies;
}

/** The Resource Map page of a cluster: the map of the namespaces that its filter selects. */
export function KubeResourcePage({ dependencies }: KubeResourcePageProps) {
  return (
    <TabLayout className={styles.kubeResourcePage}>
      <header className={styles.header}>
        <h2 className={styles.title}>Resource Map</h2>
        <div className={styles.namespaceFilter}>
          <NamespaceSelectFilter id="resource-map-namespace-filter" />
        </div>
      </header>

      <div className={styles.map}>
        <KubeResourceMap dependencies={dependencies} />
      </div>
    </TabLayout>
  );
}

/** The Resource Map in the Workloads Overview of a cluster. */
export function KubeResourceOverviewDetail({ dependencies }: KubeResourcePageProps) {
  return (
    <div className={styles.overviewDetail}>
      <div className={styles.overviewHeader}>
        <h5>Resources</h5>
      </div>
      <div className={styles.overviewContent}>
        <KubeResourceMap dependencies={dependencies} />
      </div>
    </div>
  );
}
