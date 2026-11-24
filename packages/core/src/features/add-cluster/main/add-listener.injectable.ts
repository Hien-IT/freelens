/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannelListenerInjectable } from "@freelensapp/messaging";
import * as uuid from "uuid";
import getCustomKubeConfigFilePathInjectable from "../../../common/app-paths/get-custom-kube-config-directory/get-custom-kube-config-directory.injectable";
import ensureDirInjectable from "../../../common/fs/main/ensure-dir.injectable";
import writeFileInjectable from "../../../common/fs/main/write-file.injectable";
import getDirnameOfPathInjectable from "../../../common/path/get-dirname.injectable";
import { addKubeconfigTextChannel } from "../common/channels";
import { checkKubeconfigText } from "./check";

const addKubeconfigTextListenerInjectable = getRequestChannelListenerInjectable({
  id: "add-kubeconfig-text-listener",
  channel: addKubeconfigTextChannel,
  getHandler: (di) => {
    const getCustomKubeConfigFilePath = di.inject(getCustomKubeConfigFilePathInjectable);
    const getDirnameOfPath = di.inject(getDirnameOfPathInjectable);
    const ensureDir = di.inject(ensureDirInjectable);
    const writeFile = di.inject(writeFileInjectable);

    return async (text) => {
      const filePath = getCustomKubeConfigFilePath(uuid.v4());

      await ensureDir(getDirnameOfPath(filePath));
      await writeFile(filePath, text.trim(), { encoding: "utf-8", mode: 0o600 });

      return { added: checkKubeconfigText(text).contexts.map(({ name }) => name) };
    };
  },
});

export default addKubeconfigTextListenerInjectable;
