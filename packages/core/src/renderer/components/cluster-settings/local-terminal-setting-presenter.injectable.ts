/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable, lifecycleEnum } from "@ogre-tools/injectable";
import { observable } from "mobx";
import requestClusterKubeconfigContextsInjectable from "../../../features/cluster/delete-dialog/renderer/request-kubeconfig-contexts.injectable";

import type { Cluster } from "../../../common/cluster/cluster";

export interface LocalTerminalSettingPresenter {
  readonly directory: {
    get: () => string;
    set: (value: string) => void;
  };
  readonly defaultNamespace: {
    get: () => string;
    set: (value: string) => void;
  };
  readonly placeholderDefaultNamespace: string;
}

const localTerminalSettingPresenterInjectable = getInjectable({
  id: "local-terminal-setting-presenter",
  instantiate: async (di, cluster: Cluster): Promise<LocalTerminalSettingPresenter> => {
    const { defaultNamespace: namespaceOfContext } = await di.inject(requestClusterKubeconfigContextsInjectable)(
      cluster.id,
    );

    const directory = observable.box(cluster.preferences.terminalCWD || "");
    const defaultNamespace = observable.box(cluster.preferences.defaultNamespace || "");
    const placeholderDefaultNamespace = namespaceOfContext || "default";

    return {
      directory: {
        get: () => directory.get(),
        set: (value) => directory.set(value),
      },
      defaultNamespace: {
        get: () => defaultNamespace.get(),
        set: (value) => defaultNamespace.set(value),
      },
      placeholderDefaultNamespace,
    };
  },
  lifecycle: lifecycleEnum.transient,
});

export default localTerminalSettingPresenterInjectable;
