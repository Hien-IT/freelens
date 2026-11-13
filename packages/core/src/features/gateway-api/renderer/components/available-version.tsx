/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { loggerInjectionToken } from "@freelensapp/logger";
import { withInjectables } from "@ogre-tools/injectable-react";
import { observer } from "mobx-react";
import apiManagerInjectable from "../../../../common/k8s-api/api-manager/manager.injectable";
import { getAvailableStore } from "../api/available-resource";
import styles from "./available-version.module.scss";

import type { KubeObject } from "@freelensapp/kube-object";
import type { Logger } from "@freelensapp/logger";

import type React from "react";

import type { KubeObjectStore } from "../../../../common/k8s-api/kube-object.store";
import type { GatewayApiRegistry, GatewayApiResource } from "../api/available-resource";

/** The props of the page of one API version: the store of that version. */
export interface GatewayPageProps<K extends KubeObject = KubeObject> {
  store: KubeObjectStore<K>;
}

/**
 * Configuration for a single API version variant.
 */
export interface VersionVariant {
  resource: GatewayApiResource;
  // The store holds plain `KubeObject`s typed as the model class, as the
  // extension API's `getStore<T>()` did.
  PageComponent: React.ComponentType<GatewayPageProps<any>>;
  version: string;
}

interface Dependencies {
  registry: GatewayApiRegistry;
  logger: Logger;
}

/**
 * Creates a page component that automatically selects the correct API version based on cluster availability.
 *
 * Tries versions in order and renders the first available one with its store.
 * Shows a helpful message if no versions are available (CRD not installed).
 *
 * The component is an observer: the registry of APIs is observable, so the page renders again when an API is
 * registered after the page was first rendered, as it is for a page opened while the cluster frame is still loading
 * its CRDs.
 *
 * @param resourceName - Human-readable resource name (e.g., "Gateways")
 * @param variants - Array of version variants, ordered by preference
 * @returns A page component that auto-detects a valid API version if present
 */
export function createAvailableVersionPage(resourceName: string, variants: VersionVariant[]): React.ComponentType {
  const NonInjectedAvailableVersionPage = observer(({ registry, logger }: Dependencies) => {
    for (const variant of variants) {
      const store = getAvailableStore(registry, variant.resource);

      if (store) {
        logger.debug(`[GATEWAY-API]: Rendering ${resourceName} page with API version ${variant.version}`);

        return <variant.PageComponent store={store} />;
      }

      logger.debug(`[GATEWAY-API]: API version ${variant.version} not available for ${resourceName}`);
    }

    // No version available - CRD not installed in cluster
    const triedVersions = variants.map((v) => v.version).join(", ");

    logger.info(`[GATEWAY-API]: ${resourceName} CRD not found in cluster (tried versions: ${triedVersions})`);

    return (
      <div className={styles.unavailablePage}>
        <div className={styles.unavailableContent}>
          <h3 className={styles.unavailableTitle}>{resourceName} Not Available</h3>
          <p className={styles.unavailableMessage}>
            The <strong>{resourceName}</strong> CRDs are not installed in this cluster.
          </p>
          <p className={styles.unavailableDetails}>
            Tried API versions: <code>{triedVersions}</code>
          </p>
        </div>
      </div>
    );
  });

  return withInjectables<Dependencies>(NonInjectedAvailableVersionPage, {
    getProps: (di, props) => ({
      ...props,
      registry: di.inject(apiManagerInjectable),
      logger: di.inject(loggerInjectionToken),
    }),
  });
}
