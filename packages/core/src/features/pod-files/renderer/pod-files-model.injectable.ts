/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { showErrorNotificationInjectable, showSuccessNotificationInjectable } from "@freelensapp/notifications";
import { getInjectable, lifecycleEnum } from "@ogre-tools/injectable";
import hostedClusterIdInjectable from "../../../renderer/cluster-frame-context/hosted-cluster-id.injectable";
import confirmInjectable from "../../../renderer/components/confirm-dialog/confirm.injectable";
import openSaveFileDialogInjectable from "../../../renderer/utils/save-file.injectable";
import { PodFilesModel } from "./pod-files-model";
import requestPodFilesInjectable from "./request-pod-files.injectable";
import podFilesTabStoreInjectable from "./tab-store.injectable";

import type { TabId } from "../../../renderer/components/dock/dock/store";

const podFilesModelInjectable = getInjectable({
  id: "pod-files-model",

  instantiate: (di, tabId: TabId) => {
    const confirm = di.inject(confirmInjectable);
    const showSuccessNotification = di.inject(showSuccessNotificationInjectable);
    const showErrorNotification = di.inject(showErrorNotificationInjectable);

    return new PodFilesModel(tabId, {
      tabStore: di.inject(podFilesTabStoreInjectable),
      requestPodFiles: di.inject(requestPodFilesInjectable),
      clusterId: di.inject(hostedClusterIdInjectable) ?? "",
      showSuccess: (message) => showSuccessNotification(message),
      showError: (message) => showErrorNotification(message),
      confirm: ({ message, labelOk }) => confirm({ message, labelOk }),
      saveFile: di.inject(openSaveFileDialogInjectable),
      copyToClipboard: (text) => navigator.clipboard.writeText(text),
    });
  },

  lifecycle: lifecycleEnum.keyedSingleton({
    getInstanceKey: (di, tabId: TabId) => tabId,
  }),
});

export default podFilesModelInjectable;
