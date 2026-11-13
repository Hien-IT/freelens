/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { withInjectables } from "@ogre-tools/injectable-react";
import { observer } from "mobx-react";
import apiManagerInjectable from "../../../../../common/k8s-api/api-manager/manager.injectable";
import { LinkToObject } from "../../../../../renderer/components/kube-object-link";
import { getReferenceApiVersion } from "./references";

import type { KubeObject } from "@freelensapp/kube-object";

import type { GatewayApiRegistry } from "../../api/available-resource";

export interface ReferenceLinkProps {
  object: KubeObject;
  group: string;
  kind: string;
  name: string;
  namespace?: string;
}

interface Dependencies {
  registry: GatewayApiRegistry;
}

// A link to the object a reference names, or its name alone when the cluster
// serves no API for the reference's group and kind.
const NonInjectedReferenceLink = observer(
  ({ object, group, kind, name, namespace, registry }: ReferenceLinkProps & Dependencies) => {
    const apiVersion = getReferenceApiVersion(registry, group, kind);

    if (!apiVersion) {
      return <span>{name}</span>;
    }

    return <LinkToObject object={object} objectRef={{ apiVersion, kind, name, namespace }} />;
  },
);

export const ReferenceLink = withInjectables<Dependencies, ReferenceLinkProps>(NonInjectedReferenceLink, {
  getProps: (di, props) => ({
    ...props,
    registry: di.inject(apiManagerInjectable),
  }),
});
