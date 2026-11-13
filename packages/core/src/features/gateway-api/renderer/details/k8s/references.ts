/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getAvailableResource } from "../../api/available-resource";
import { kinds } from "../../pages/overview-kinds";

import type { GatewayApiRegistry } from "../../api/available-resource";

// The default group of a parent reference.
export const gatewayApiGroup = "gateway.networking.k8s.io";

function getGroup(apiVersion: string): string {
  const separator = apiVersion.lastIndexOf("/");

  return separator === -1 ? "" : apiVersion.slice(0, separator);
}

/**
 * The `apiVersion` of a link to the object that a reference names by `group` and `kind`, or `undefined` when the
 * cluster serves no API for them, so that the reference is shown without a link rather than with a broken one.
 *
 * - The core group, `""`, is `v1`.
 * - A kind of the Gateway API takes the first version that the cluster serves, in the order the cluster pages
 *   prefer, as `createAvailableVersionPage` chooses it.
 * - Any other kind takes the version of the API that the registry has for its group, as it has one for every
 *   served version of a CRD.
 *
 * It reads the observable registry of APIs, so a component that calls it is an `observer`.
 */
export function getReferenceApiVersion(registry: GatewayApiRegistry, group: string, kind: string): string | undefined {
  if (group === "") {
    return "v1";
  }

  const versions = kinds.find(
    ([resource]) => resource.kind === kind && getGroup(resource.crd.apiVersions[0]) === group,
  );
  const available = versions && getAvailableResource(registry, versions);

  if (available) {
    return available.resource.crd.apiVersions[0];
  }

  return registry.getApi((api) => api.apiGroup === group && api.kind === kind)?.apiVersionWithGroup;
}
