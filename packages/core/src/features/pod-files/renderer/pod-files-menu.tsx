/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Pod } from "@freelensapp/kube-object";
import { withInjectables } from "@ogre-tools/injectable-react";
import hideDetailsInjectable from "../../../renderer/components/kube-detail-params/hide-details.injectable";
import PodMenuItem from "../../../renderer/components/node-pod-menu/pod-menu-item";
import createPodFilesTabInjectable from "./create-pod-files-tab.injectable";

import type { Container, KubeJsonApiData } from "@freelensapp/kube-object";

import type { HideDetails } from "../../../renderer/components/kube-detail-params/hide-details.injectable";
import type { CreatePodFilesTab } from "./create-pod-files-tab.injectable";

export interface PodFilesMenuProps {
  object: KubeJsonApiData | Pod | undefined;
  toolbar: boolean;
}

interface Dependencies {
  createPodFilesTab: CreatePodFilesTab;
  hideDetails: HideDetails;
}

const NonInjectedPodFilesMenu = ({
  object,
  toolbar,
  createPodFilesTab,
  hideDetails,
}: PodFilesMenuProps & Dependencies) => {
  if (!object) {
    return null;
  }

  let pod: Pod;

  try {
    pod = object instanceof Pod ? object : new Pod(object as ConstructorParameters<typeof Pod>[0]);
  } catch {
    return null;
  }

  // The browser runs POSIX tools (ls, cat, head, rm, sh) in the container.
  if (pod.getSelectedNodeOs() === "windows") {
    return null;
  }

  const containers = pod.getRunningContainersWithType();

  const openFiles = (container: Container) => {
    createPodFilesTab({
      namespace: pod.getNs(),
      pod: pod.getName(),
      container: container.name,
      containers: containers.map(({ name }) => name),
    });
    hideDetails();
  };

  return (
    <PodMenuItem
      material="folder_open"
      title="Files"
      tooltip="Pod Files"
      toolbar={toolbar}
      annotations={pod.metadata.annotations}
      containers={containers}
      statuses={pod.getContainerStatuses()}
      onMenuItemClick={openFiles}
    />
  );
};

export const PodFilesMenu = withInjectables<Dependencies, PodFilesMenuProps>(NonInjectedPodFilesMenu, {
  getProps: (di, props) => ({
    ...props,
    createPodFilesTab: di.inject(createPodFilesTabInjectable),
    hideDetails: di.inject(hideDetailsInjectable),
  }),
});
