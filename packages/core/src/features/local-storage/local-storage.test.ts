/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { requestFromChannelInjectionToken } from "@freelensapp/messaging";
import { beforeEach, describe, expect, it } from "vitest";
import directoryForUserDataInjectable from "../../common/app-paths/directory-for-user-data/directory-for-user-data.injectable";
import { Cluster } from "../../common/cluster/cluster";
import readJsonFileInjectable from "../../common/fs/main/read-json-file.injectable";
import { getMainAndRenderer } from "../../test-utils/channels-between-main-and-renderer";
import clustersStateInjectable from "../cluster/storage/common/state.injectable";
import { lensLocalStorageReadChannel, lensLocalStorageWriteChannel } from "./common/channels";
import lensLocalStorageReadListenerInjectable from "./main/read-listener.injectable";
import lensLocalStorageWriteListenerInjectable from "./main/write-listener.injectable";

import type { RequestFromChannel } from "@freelensapp/messaging";

import type { DiContainer } from "@ogre-tools/injectable";

describe("lens-local-storage", () => {
  let mainDi: DiContainer;
  let rendererDi: DiContainer;

  let request: RequestFromChannel;

  beforeEach(() => {
    const both = getMainAndRenderer();

    mainDi = both.mainDi;
    rendererDi = both.rendererDi;
    mainDi.override(directoryForUserDataInjectable, () => "/some-user-data");
    mainDi
      .inject(clustersStateInjectable)
      .set(
        "some-cluster",
        new Cluster({ id: "some-cluster", contextName: "some-context", kubeConfigPath: "/some/kube/config" }),
      );
    both.listenInMain(lensLocalStorageReadListenerInjectable, lensLocalStorageWriteListenerInjectable);
    request = rendererDi.inject(requestFromChannelInjectionToken);
  });

  it("answers an empty state when the root frame has no file yet", async () => {
    expect(await request(lensLocalStorageReadChannel, {})).toEqual({});
  });

  it("writes the root frame's state to app.json, and reads it back", async () => {
    await request(lensLocalStorageWriteChannel, { state: { some: "value" } });

    expect(await mainDi.inject(readJsonFileInjectable)("/some-user-data/lens-local-storage/app.json")).toEqual({
      some: "value",
    });
    expect(await request(lensLocalStorageReadChannel, {})).toEqual({ some: "value" });
  });

  it("writes a cluster frame's state to the file of its cluster", async () => {
    await request(lensLocalStorageWriteChannel, { clusterId: "some-cluster", state: { other: 1 } });

    expect(await mainDi.inject(readJsonFileInjectable)("/some-user-data/lens-local-storage/some-cluster.json")).toEqual(
      { other: 1 },
    );
  });

  it("refuses a cluster main does not have, which keeps a path out of the name", async () => {
    await expect(request(lensLocalStorageWriteChannel, { clusterId: "../escape", state: {} })).rejects.toThrow(
      'Cannot use the local storage of cluster "../escape", which is not registered',
    );
    await expect(request(lensLocalStorageReadChannel, { clusterId: "../escape" })).rejects.toThrow(
      "which is not registered",
    );
  });
});
