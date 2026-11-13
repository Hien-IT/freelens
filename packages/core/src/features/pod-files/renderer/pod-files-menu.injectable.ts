/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { computed } from "mobx";
import { kubeObjectMenuItemInjectionToken } from "../../../renderer/components/kube-object-menu/kube-object-menu-item-injection-token";
import { PodFilesMenu } from "./pod-files-menu";

import type { KubeObjectMenuItemComponent } from "../../../renderer/components/kube-object-menu/kube-object-menu-item-injection-token";

const podFilesMenuInjectable = getInjectable({
  id: "pod-files-menu",

  instantiate: () => ({
    kind: "Pod",
    apiVersions: ["v1"],
    Component: PodFilesMenu as KubeObjectMenuItemComponent,
    enabled: computed(() => true),
    // After Attach, Shell and Logs.
    orderNumber: 4,
  }),

  injectionToken: kubeObjectMenuItemInjectionToken,
});

export default podFilesMenuInjectable;
