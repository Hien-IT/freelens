/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRandomIdInjectionToken } from "@freelensapp/random";
import { getInjectable } from "@ogre-tools/injectable";
import { runInAction } from "mobx";
import createDockTabInjectable from "../../../renderer/components/dock/dock/create-dock-tab.injectable";
import { TabKind } from "../../../renderer/components/dock/dock/store";
import podFilesTabStoreInjectable from "./tab-store.injectable";

import type { TabId } from "../../../renderer/components/dock/dock/store";

export interface CreatePodFilesTabArgs {
  readonly namespace: string;
  readonly pod: string;
  readonly container: string;
  readonly containers: string[];
}

export type CreatePodFilesTab = (args: CreatePodFilesTabArgs) => TabId;

const createPodFilesTabInjectable = getInjectable({
  id: "create-pod-files-tab",

  instantiate: (di): CreatePodFilesTab => {
    const createDockTab = di.inject(createDockTabInjectable);
    const tabStore = di.inject(podFilesTabStoreInjectable);
    const getRandomId = di.inject(getRandomIdInjectionToken);

    return ({ namespace, pod, container, containers }) => {
      const id = `pod-files-tab-${getRandomId()}`;

      runInAction(() => {
        // The data is set before the tab exists, so that the view never
        // renders a tab without it.
        tabStore.setData(id, { namespace, pod, container, containers, directory: "/" });
        createDockTab({ id, title: `Files: ${pod}`, kind: TabKind.POD_FILES }, false);
      });

      return id;
    };
  },
});

export default createPodFilesTabInjectable;
