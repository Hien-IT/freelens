/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import prometheusHandlerInjectable from "../../../main/cluster/prometheus-handler/prometheus-handler.injectable";
import getMetricsInjectable from "../../../main/get-metrics.injectable";
import k8sRequestInjectable from "../../../main/k8s-request.injectable";
import kubeconfigManagerInjectable from "../../../main/kubeconfig-manager/kubeconfig-manager.injectable";
import createPortForwardInjectable from "../../../main/routes/port-forward/functionality/create-port-forward.injectable";
import { PrometheusUnavailableError, requestStatusOf } from "./cluster-access";

import type { Cluster } from "../../../common/cluster/cluster";
import type { ClusterAccess, PromSample } from "./cluster-access";

export type CreateClusterAccess = (cluster: Cluster) => ClusterAccess;

interface PromQueryRangeResponse {
  status?: string;
  error?: string;
  data?: {
    resultType?: string;
    result?: { metric?: Record<string, string>; values?: [number, string][]; value?: [number, string] }[];
  };
}

/** The value of a series: the last point of a range query, or the value of an instant one. */
function lastValue(series: { values?: [number, string][]; value?: [number, string] }): number {
  const point = series.value ?? series.values?.[series.values.length - 1];

  return point ? Number(point[1]) : Number.NaN;
}

function samplesOf(response: PromQueryRangeResponse): PromSample[] {
  if (response.status && response.status !== "success") {
    throw new Error(response.error ?? `Prometheus answered ${response.status}`);
  }

  return (response.data?.result ?? [])
    .map((series): PromSample => ({ metric: series.metric ?? {}, value: lastValue(series) }))
    .filter((sample) => Number.isFinite(sample.value));
}

const createClusterAccessInjectable = getInjectable({
  id: "traffic-map-create-cluster-access",

  instantiate: (di): CreateClusterAccess => {
    const k8sRequest = di.inject(k8sRequestInjectable);
    const getMetrics = di.inject(getMetricsInjectable);
    const createPortForward = di.inject(createPortForwardInjectable);

    return (cluster) => ({
      list: async <T>(path: string) => {
        const response = (await k8sRequest(cluster, path)) as { items?: T[] };

        return response.items ?? [];
      },

      get: async <T>(path: string) => {
        try {
          return (await k8sRequest(cluster, path)) as T;
        } catch (error) {
          if (requestStatusOf(error) === 404) {
            return undefined;
          }

          throw error;
        }
      },

      queryPrometheus: async (query) => {
        const { prometheusPath } = await di
          .inject(prometheusHandlerInjectable, cluster)
          .getPrometheusDetails()
          .catch((error: unknown) => {
            throw new PrometheusUnavailableError(error instanceof Error ? error.message : String(error));
          });

        if (!prometheusPath) {
          throw new PrometheusUnavailableError("No Prometheus is set up for the cluster");
        }

        // A range query that starts and ends now is an instant query, and runs
        // through the same path, preferences and credentials as the metrics.
        const now = Math.floor(Date.now() / 1000);
        const response = (await getMetrics(cluster, prometheusPath, {
          query,
          start: now,
          end: now,
          step: 60,
        })) as PromQueryRangeResponse;

        return samplesOf(response);
      },

      queryService: async ({ namespace, name, port }, query) => {
        const path = `/api/v1/namespaces/${encodeURIComponent(namespace)}/services/${encodeURIComponent(name)}:${port}/proxy/api/v1/query`;

        return samplesOf(
          (await k8sRequest(cluster, `${path}?${new URLSearchParams({ query })}`)) as PromQueryRangeResponse,
        );
      },

      portForward: async (namespace, service, port) => {
        const proxyKubeconfig = await di.inject(kubeconfigManagerInjectable, cluster).ensurePaths();
        const forward = createPortForward(proxyKubeconfig, {
          clusterId: cluster.id,
          kind: "service",
          namespace,
          name: service,
          port,
          forwardPort: 0,
          address: "127.0.0.1",
        });

        if (!(await forward.start())) {
          throw new Error(`Cannot forward a local port to ${namespace}/${service}:${port}`);
        }

        return {
          localPort: forward.forwardPort,
          isAlive: () => forward.process?.exitCode === null && !forward.process.killed,
          stop: () => void forward.stop(),
        };
      },
    });
  },
});

export default createClusterAccessInjectable;
