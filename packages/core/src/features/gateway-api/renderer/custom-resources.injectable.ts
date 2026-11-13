/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { computed } from "mobx";
import { extensionCustomResourceInjectionToken } from "../../../renderer/components/custom-resource-definitions/extension-custom-resource-injection-token";

/** The name the Custom Resources tree gives as the one that presents the resource. */
export const gatewayApiPresenterName = "Gateway API";

const gatewayApiGroup = "gateway.networking.k8s.io";
const experimentalGatewayApiGroup = "gateway.networking.x-k8s.io";

// A resource that has a page under "Gateway API" and is therefore left out of
// the Custom Resources tree, like one an extension presents with pages of its
// own. Its item stays registered there, so the command palette and a favorite
// of it still reach the host's list.
const createCustomResourceInjectable = (group: string, plural: string) =>
  getInjectable({
    id: `gateway-api-custom-resource-${group}/${plural}`,

    instantiate: () => ({
      group,
      plural,
      extensionName: gatewayApiPresenterName,
      enabled: computed(() => true),
    }),

    injectionToken: extensionCustomResourceInjectionToken,
  });

// One per group and plural of `customResources`: the versions of a kind share them.

export const gatewayClassesCustomResourceInjectable = createCustomResourceInjectable(gatewayApiGroup, "gatewayclasses");

export const gatewaysCustomResourceInjectable = createCustomResourceInjectable(gatewayApiGroup, "gateways");

export const httpRoutesCustomResourceInjectable = createCustomResourceInjectable(gatewayApiGroup, "httproutes");

export const grpcRoutesCustomResourceInjectable = createCustomResourceInjectable(gatewayApiGroup, "grpcroutes");

export const tcpRoutesCustomResourceInjectable = createCustomResourceInjectable(gatewayApiGroup, "tcproutes");

export const tlsRoutesCustomResourceInjectable = createCustomResourceInjectable(gatewayApiGroup, "tlsroutes");

export const udpRoutesCustomResourceInjectable = createCustomResourceInjectable(gatewayApiGroup, "udproutes");

export const referenceGrantsCustomResourceInjectable = createCustomResourceInjectable(
  gatewayApiGroup,
  "referencegrants",
);

export const listenerSetsCustomResourceInjectable = createCustomResourceInjectable(gatewayApiGroup, "listenersets");

export const backendTLSPoliciesCustomResourceInjectable = createCustomResourceInjectable(
  gatewayApiGroup,
  "backendtlspolicies",
);

export const xBackendTrafficPoliciesCustomResourceInjectable = createCustomResourceInjectable(
  experimentalGatewayApiGroup,
  "xbackendtrafficpolicies",
);

export const xBackendsCustomResourceInjectable = createCustomResourceInjectable(
  experimentalGatewayApiGroup,
  "xbackends",
);

export const xMeshesCustomResourceInjectable = createCustomResourceInjectable(experimentalGatewayApiGroup, "xmeshes");
