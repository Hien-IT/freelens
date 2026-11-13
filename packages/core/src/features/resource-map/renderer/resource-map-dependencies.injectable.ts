/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import {
  configMapApiInjectable,
  daemonSetApiInjectable,
  deploymentApiInjectable,
  ingressApiInjectable,
  persistentVolumeClaimApiInjectable,
  podApiInjectable,
  secretApiInjectable,
  serviceApiInjectable,
  statefulSetApiInjectable,
} from "@freelensapp/kube-api-specifics";
import { loggerInjectionToken } from "@freelensapp/logger";
import { getInjectable } from "@ogre-tools/injectable";
import navigateToHelmReleasesInjectable from "../../../common/front-end-routing/routes/cluster/helm/releases/navigate-to-helm-releases.injectable";
import { apiResourceRecord } from "../../../common/rbac";
import configMapStoreInjectable from "../../../renderer/components/config-maps/store.injectable";
import secretStoreInjectable from "../../../renderer/components/config-secrets/store.injectable";
import showDetailsInjectable from "../../../renderer/components/kube-detail-params/show-details.injectable";
import namespaceStoreInjectable from "../../../renderer/components/namespaces/store.injectable";
import ingressStoreInjectable from "../../../renderer/components/network-ingresses/ingress-store.injectable";
import serviceStoreInjectable from "../../../renderer/components/network-services/store.injectable";
import persistentVolumeClaimStoreInjectable from "../../../renderer/components/storage-volume-claims/store.injectable";
import daemonSetStoreInjectable from "../../../renderer/components/workloads-daemonsets/store.injectable";
import deploymentStoreInjectable from "../../../renderer/components/workloads-deployments/store.injectable";
import podStoreInjectable from "../../../renderer/components/workloads-pods/store.injectable";
import statefulSetStoreInjectable from "../../../renderer/components/workloads-statefulsets/store.injectable";
import subscribeStoresInjectable from "../../../renderer/kube-watch-api/subscribe-stores.injectable";
import activeThemeInjectable from "../../../renderer/themes/active.injectable";
import { shouldShowResourceInjectionToken } from "../../cluster/showing-kube-resources/common/allowed-resources-injection-token";
import { mapStoreResources } from "./dependencies";

import type { ResourceMapDependencies } from "./dependencies";

const resourceMapDependenciesInjectable = getInjectable({
  id: "resource-map-dependencies",

  instantiate: (di): ResourceMapDependencies => {
    const activeTheme = di.inject(activeThemeInjectable);
    const showDetails = di.inject(showDetailsInjectable);
    const navigateToHelmReleases = di.inject(navigateToHelmReleasesInjectable);

    return {
      stores: {
        pods: di.inject(podStoreInjectable),
        deployments: di.inject(deploymentStoreInjectable),
        statefulSets: di.inject(statefulSetStoreInjectable),
        daemonSets: di.inject(daemonSetStoreInjectable),
        services: di.inject(serviceStoreInjectable),
        ingresses: di.inject(ingressStoreInjectable),
        pvcs: di.inject(persistentVolumeClaimStoreInjectable),
        configMaps: di.inject(configMapStoreInjectable),
        secrets: di.inject(secretStoreInjectable),
      },
      apis: {
        pods: di.inject(podApiInjectable),
        deployments: di.inject(deploymentApiInjectable),
        statefulSets: di.inject(statefulSetApiInjectable),
        daemonSets: di.inject(daemonSetApiInjectable),
        services: di.inject(serviceApiInjectable),
        ingresses: di.inject(ingressApiInjectable),
        pvcs: di.inject(persistentVolumeClaimApiInjectable),
        configMaps: di.inject(configMapApiInjectable),
        secrets: di.inject(secretApiInjectable),
      },
      namespaceStore: di.inject(namespaceStoreInjectable),
      logger: di.inject(loggerInjectionToken),
      subscribeStores: di.inject(subscribeStoresInjectable),
      canListMapStore: (key) => {
        const apiName = mapStoreResources[key];

        return di.inject(shouldShowResourceInjectionToken, { apiName, group: apiResourceRecord[apiName].group }).get();
      },
      getCanvasColors: () => {
        const { colors } = activeTheme.get();

        return { background: colors.secondaryBackground, text: colors.textColorPrimary };
      },
      showDetails: (selfLink) => showDetails(selfLink),
      showHelmRelease: ({ namespace, name }) => navigateToHelmReleases({ namespace, name }),
    };
  },
});

export default resourceMapDependenciesInjectable;
