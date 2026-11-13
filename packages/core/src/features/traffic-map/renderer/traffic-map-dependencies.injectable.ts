/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { loggerInjectionToken } from "@freelensapp/logger";
import { requestFromChannelInjectionToken } from "@freelensapp/messaging";
import { getInjectable } from "@ogre-tools/injectable";
import openLinkInBrowserInjectable from "../../../common/utils/open-link-in-browser.injectable";
import hostedClusterIdInjectable from "../../../renderer/cluster-frame-context/hosted-cluster-id.injectable";
import showDetailsInjectable from "../../../renderer/components/kube-detail-params/show-details.injectable";
import namespaceStoreInjectable from "../../../renderer/components/namespaces/store.injectable";
import activeThemeInjectable from "../../../renderer/themes/active.injectable";
import { trafficMapChannel } from "../common/channels";

import type { TrafficEndpoint } from "../common/types";
import type { RequestTraffic } from "./traffic-map-model";
import type { TrafficMapPageDependencies } from "./traffic-map-page";

const workloadPaths: Record<string, string> = {
  Deployment: "/apis/apps/v1/namespaces/{ns}/deployments/{name}",
  StatefulSet: "/apis/apps/v1/namespaces/{ns}/statefulsets/{name}",
  DaemonSet: "/apis/apps/v1/namespaces/{ns}/daemonsets/{name}",
  ReplicaSet: "/apis/apps/v1/namespaces/{ns}/replicasets/{name}",
  Job: "/apis/batch/v1/namespaces/{ns}/jobs/{name}",
  CronJob: "/apis/batch/v1/namespaces/{ns}/cronjobs/{name}",
};

/** The API path of the Kubernetes object that an endpoint stands for, when it is one the details can show. */
export function selfLinkOf(endpoint: TrafficEndpoint): string | undefined {
  if (!endpoint.namespace) return undefined;

  const fill = (template: string) =>
    template
      .replace("{ns}", encodeURIComponent(endpoint.namespace))
      .replace("{name}", encodeURIComponent(endpoint.name));

  switch (endpoint.kind) {
    case "Pod":
      return fill("/api/v1/namespaces/{ns}/pods/{name}");
    case "Service":
      return fill("/api/v1/namespaces/{ns}/services/{name}");
    case "Workload":
      return endpoint.workloadKind && workloadPaths[endpoint.workloadKind]
        ? fill(workloadPaths[endpoint.workloadKind])
        : undefined;
    default:
      return undefined;
  }
}

const trafficMapDependenciesInjectable = getInjectable({
  id: "traffic-map-dependencies",

  instantiate: (di): TrafficMapPageDependencies => {
    const requestFromChannel = di.inject(requestFromChannelInjectionToken);
    const clusterId = di.inject(hostedClusterIdInjectable) ?? "";
    const namespaceStore = di.inject(namespaceStoreInjectable);
    const activeTheme = di.inject(activeThemeInjectable);
    const showDetails = di.inject(showDetailsInjectable);
    const openLinkInBrowser = di.inject(openLinkInBrowserInjectable);
    const logger = di.inject(loggerInjectionToken);

    const requestTraffic = (async (body) =>
      requestFromChannel(trafficMapChannel, { ...body, clusterId } as never)) as RequestTraffic;

    return {
      requestTraffic,
      getNamespaces: () => (namespaceStore.areAllSelectedImplicitly ? [] : [...namespaceStore.contextNamespaces]),
      getTextColor: () => activeTheme.get().colors.textColorPrimary,
      openLink: (url) => {
        openLinkInBrowser(url).catch((error) => logger.warn("[TRAFFIC-MAP]: cannot open a link", error));
      },
      copyText: (text) => {
        navigator.clipboard.writeText(text).catch((error) => logger.warn("[TRAFFIC-MAP]: cannot copy", error));
      },
      openObject: (endpoint) => {
        const selfLink = selfLinkOf(endpoint);

        if (selfLink) {
          showDetails(selfLink);
        }
      },
    };
  },
});

export default trafficMapDependenciesInjectable;
