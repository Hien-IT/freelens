/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { withInjectables } from "@ogre-tools/injectable-react";
import { observer } from "mobx-react";
import { useCallback, useEffect, useState } from "react";
import apiManagerInjectable from "../../../../common/k8s-api/api-manager/manager.injectable";
import customResourceDefinitionStoreInjectable from "../../../../renderer/components/custom-resource-definitions/store.injectable";
import eventStoreInjectable from "../../../../renderer/components/events/store.injectable";
import { TabLayout } from "../../../../renderer/components/layout/tab-layout";
import { NamespaceSelectFilter } from "../../../../renderer/components/namespaces/namespace-select-filter";
import namespaceStoreInjectable from "../../../../renderer/components/namespaces/store.injectable";
import navigateInjectable from "../../../../renderer/navigation/navigate.injectable";
import { getAvailableResource } from "../api/available-resource";
import { GatewayApiEvents } from "../components/gateway-api-events";
import { InfoPage } from "../components/info-page";
import { PieChart } from "../components/pie-chart";
import styles from "./overview.module.scss";
import { kinds } from "./overview-kinds";
import { getGatewayApiPagePath } from "./page-paths";

import type { CustomResourceDefinition, KubeObject } from "@freelensapp/kube-object";

import type { KubeObjectStore } from "../../../../common/k8s-api/kube-object.store";
import type { CustomResourceDefinitionStore } from "../../../../renderer/components/custom-resource-definitions/store";
import type { EventStore } from "../../../../renderer/components/events/store";
import type { NamespaceStore } from "../../../../renderer/components/namespaces/store";
import type { Navigate } from "../../../../renderer/navigation/navigate.injectable";
import type { GatewayApiRegistry, GatewayApiResource } from "../api/available-resource";

interface Dependencies {
  registry: GatewayApiRegistry;
  crdStore: CustomResourceDefinitionStore;
  namespaceStore: NamespaceStore;
  eventStore: EventStore;
  navigate: Navigate;
}

const NonInjectedOverviewPage = observer(
  ({ registry, crdStore, namespaceStore, eventStore, navigate }: Dependencies) => {
    const [crds, setCrds] = useState<CustomResourceDefinition[]>([]);
    const [loaded, setLoaded] = useState(false);

    const getCrd = useCallback(
      (store: KubeObjectStore<KubeObject>) => {
        return crds.find((crd) => crd.spec.names.kind === store.api.kind && crd.spec.group === store.api.apiGroup);
      },
      [crds],
    );

    const getChart = useCallback(
      (versions: GatewayApiResource[]) => {
        const available = getAvailableResource(registry, versions);
        if (!available) return null;
        const { resource, store } = available;
        if (!getCrd(store)) return null;

        const items = store.contextItems;

        return (
          <div key={resource.crd.plural} className={styles.chartColumn} hidden={!items.length}>
            <PieChart
              title={resource.crd.title}
              objects={items}
              onTitleClick={() => navigate(getGatewayApiPagePath(resource.crd.plural))}
            />
          </div>
        );
      },
      [getCrd, registry, navigate],
    );

    useEffect(() => {
      // One controller and one list of watches per run of the effect: React.StrictMode,
      // which Freelens dev renders in, runs it, cleans it up and runs it again on the
      // same instance, and a controller kept across runs would stay aborted.
      const abortController = new AbortController();
      const signal = abortController.signal;
      const watches: (() => void)[] = [];

      (async () => {
        const loadedCrds = (await crdStore.loadAll()) || [];
        if (!signal.aborted) setCrds(loadedCrds);

        await namespaceStore.loadAll({ namespaces: [], reqInit: { signal } });
        if (signal.aborted) return;
        watches.push(namespaceStore.subscribe());

        const namespaces = namespaceStore.items.map((ns) => ns.getName());

        for (const versions of kinds) {
          const store = getAvailableResource(registry, versions)?.store;
          if (!store) continue;
          try {
            await store.loadAll({ namespaces, reqInit: { signal } });
            if (signal.aborted) return;
            watches.push(store.subscribe());
          } catch (_) {
            // a kind that fails to load has no chart
          }
        }

        try {
          await eventStore.loadAll({ namespaces, reqInit: { signal } });
          if (signal.aborted) return;
          watches.push(eventStore.subscribe());
        } catch (_) {
          // events are best-effort
        }

        if (!signal.aborted) setLoaded(true);
      })();

      return () => {
        abortController.abort();
        watches.forEach((unsubscribe) => unsubscribe());
      };
    }, []);

    if (!loaded && crds.length === 0) {
      return <InfoPage message="Loading Gateway API resources..." />;
    }

    return (
      <TabLayout>
        <div className={styles.overviewContent}>
          <header>
            <h5>Gateway API Overview</h5>
            <NamespaceSelectFilter id="gateway-api-overview-namespace-select-filter-input" />
          </header>

          <div className={styles.overviewStatuses}>
            <div className={styles.statuses}>{kinds.map((versions) => getChart(versions))}</div>
          </div>

          <GatewayApiEvents compact compactLimit={100} />
        </div>
      </TabLayout>
    );
  },
);

export const OverviewPage = withInjectables<Dependencies>(NonInjectedOverviewPage, {
  getProps: (di, props) => ({
    ...props,
    registry: di.inject(apiManagerInjectable),
    crdStore: di.inject(customResourceDefinitionStoreInjectable),
    namespaceStore: di.inject(namespaceStoreInjectable),
    eventStore: di.inject(eventStoreInjectable),
    navigate: di.inject(navigateInjectable),
  }),
});
