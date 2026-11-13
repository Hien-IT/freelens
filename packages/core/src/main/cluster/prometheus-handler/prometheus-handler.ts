/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { CoreV1Api } from "@kubernetes/client-node";
import { isEqual } from "es-toolkit";

import type { Logger } from "@freelensapp/logger";
import type { PrometheusProvider, PrometheusService } from "@freelensapp/prometheus";

import type { IComputedValue } from "mobx";

import type { Cluster } from "../../../common/cluster/cluster";
import type { ClusterPrometheusPreferences } from "../../../common/cluster-types";
import type { GetPrometheusProviderByKind } from "../../prometheus/get-by-kind.injectable";
import type { LoadProxyKubeconfig } from "../load-proxy-kubeconfig.injectable";

export interface PrometheusDetails {
  prometheusPath: string;
  provider: PrometheusProvider;
}

interface PrometheusServicePreferences {
  namespace: string;
  service: string;
  port: number;
  prefix: string;
  https?: boolean;
}

interface Dependencies {
  readonly prometheusProviders: IComputedValue<PrometheusProvider[]>;
  readonly logger: Logger;
  getPrometheusProviderByKind: GetPrometheusProviderByKind;
  loadProxyKubeconfig: LoadProxyKubeconfig;
}

export interface ClusterPrometheusHandler {
  setupPrometheus(preferences?: ClusterPrometheusPreferences): void;
  getPrometheusDetails(): Promise<PrometheusDetails>;
}

// Build the Kubernetes service-proxy path. If HTTPS is requested, use the
// "https:" prefix before the service name per K8s API conventions.
const ensurePrometheusPath = (service: PrometheusService, useHttps?: boolean) =>
  `${service.namespace}/services/${useHttps ? "https:" : ""}${service.service}:${service.port}`;

const toAppliedPreferences = ({ prometheus, prometheusProvider }: ClusterPrometheusPreferences) => ({
  prometheus,
  prometheusProvider,
});

export const createClusterPrometheusHandler = (...args: [Dependencies, Cluster]): ClusterPrometheusHandler => {
  const [deps, cluster] = args;
  const { getPrometheusProviderByKind, loadProxyKubeconfig, logger, prometheusProviders } = deps;

  let prometheusProvider: string | undefined = undefined;
  let prometheus: PrometheusServicePreferences | undefined = undefined;
  // The preferences the state below was set up from, and the service that was
  // detected for them, so that a request does not list the services again
  let appliedPreferences: ClusterPrometheusPreferences | undefined = undefined;
  let detectedService: PrometheusService | undefined = undefined;

  const setupPrometheus: ClusterPrometheusHandler["setupPrometheus"] = (preferences = {}) => {
    appliedPreferences = toAppliedPreferences(preferences);
    prometheusProvider = preferences.prometheusProvider?.type;
    prometheus = preferences.prometheus;
    detectedService = undefined;
  };

  const ensurePrometheusProvider = (service: PrometheusService) => {
    if (!prometheusProvider) {
      logger.info(`[CONTEXT-HANDLER]: using ${service.kind} as prometheus provider for clusterId=${cluster.id}`);
      prometheusProvider = service.kind;
    }

    return getPrometheusProviderByKind(prometheusProvider);
  };

  const listPotentialProviders = () => {
    if (prometheusProvider) {
      const provider = getPrometheusProviderByKind(prometheusProvider);

      if (provider) {
        return [provider];
      }
    }

    return prometheusProviders.get();
  };

  const getPrometheusService = async (): Promise<PrometheusService> => {
    const preferences = cluster.prometheusPreferences.get();

    // The connection updates the preferences when they change, but not while
    // it is disconnected
    if (!isEqual(appliedPreferences, toAppliedPreferences(preferences))) {
      setupPrometheus(preferences);
    }

    if (prometheus && prometheusProvider) {
      return {
        kind: prometheusProvider,
        namespace: prometheus.namespace,
        service: prometheus.service,
        port: prometheus.port,
      };
    }

    if (detectedService) {
      return detectedService;
    }

    const detectedFor = appliedPreferences;
    const providers = listPotentialProviders();
    const proxyConfig = await loadProxyKubeconfig();
    const apiClient = proxyConfig.makeApiClient(CoreV1Api);
    const potentialServices = await Promise.allSettled(
      providers.map((provider) => provider.getPrometheusService(apiClient)),
    );
    const errors = [];

    for (const res of potentialServices) {
      switch (res.status) {
        case "rejected":
          errors.push(res.reason);
          break;

        case "fulfilled":
          if (res.value) {
            // Preferences that changed during the detection make it stale
            if (appliedPreferences === detectedFor) {
              detectedService = res.value;
            }

            return res.value;
          }
      }
    }

    throw new Error("No Prometheus service found", { cause: errors });
  };

  const getPrometheusDetails: ClusterPrometheusHandler["getPrometheusDetails"] = async () => {
    const service = await getPrometheusService();
    const prometheusPath = ensurePrometheusPath(service, prometheus?.https);
    const provider = ensurePrometheusProvider(service);

    return { prometheusPath, provider };
  };

  setupPrometheus(cluster.prometheusPreferences.get());

  return {
    setupPrometheus,
    getPrometheusDetails,
  };
};
