/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { beforeEach, describe, expect, it } from "vitest";
import ensureDirInjectable from "../../common/fs/main/ensure-dir.injectable";
import writeFileInjectable from "../../common/fs/main/write-file.injectable";
import { getMainAndRenderer } from "../../test-utils/channels-between-main-and-renderer";
import discoverKubeconfigSyncKindInjectable from "../preferences/renderer/preference-items/kubernetes/kubeconfig-sync/discover-sync-kind.injectable";
import discoverKubeconfigSyncKindListenerInjectable from "./main/request-listener.injectable";

import type { DiContainer } from "@ogre-tools/injectable";

describe("discover-kubeconfig-sync-kind", () => {
  let rendererDi: DiContainer;

  beforeEach(async () => {
    const both = getMainAndRenderer();

    rendererDi = both.rendererDi;
    await both.mainDi.inject(ensureDirInjectable)("/some-kube/configs");
    await both.mainDi.inject(writeFileInjectable)("/some-kube/config", "apiVersion: v1");
    both.listenInMain(discoverKubeconfigSyncKindListenerInjectable);
  });

  it.each([
    ["/some-kube/config", "file"],
    ["/some-kube/configs", "folder"],
    ["/no-such-path", "unknown"],
  ])("tells %s is a %s", async (path, type) => {
    expect(await rendererDi.inject(discoverKubeconfigSyncKindInjectable)(path)).toEqual([path, { type }]);
  });
});
