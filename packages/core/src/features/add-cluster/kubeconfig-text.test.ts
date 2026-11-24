/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { requestFromChannelInjectionToken } from "@freelensapp/messaging";
import { beforeEach, describe, expect, it } from "vitest";
import getCustomKubeConfigFilePathInjectable from "../../common/app-paths/get-custom-kube-config-directory/get-custom-kube-config-directory.injectable";
import readDirectoryInjectable from "../../common/fs/main/read-directory.injectable";
import readFileInjectable from "../../common/fs/main/read-file.injectable";
import { getMainAndRenderer } from "../../test-utils/channels-between-main-and-renderer";
import { addKubeconfigTextChannel, parseKubeconfigTextChannel } from "./common/channels";
import addKubeconfigTextListenerInjectable from "./main/add-listener.injectable";
import parseKubeconfigTextListenerInjectable from "./main/parse-listener.injectable";

import type { RequestFromChannel } from "@freelensapp/messaging";

import type { DiContainer } from "@ogre-tools/injectable";

const credentials = ["c29tZS1jZXJ0aWZpY2F0ZS1hdXRob3JpdHk=", "c29tZS1jbGllbnQta2V5", "some-secret-token"];

const kubeconfig = `
apiVersion: v1
kind: Config
clusters:
  - name: some-cluster
    cluster:
      server: https://some-server:6443
      certificate-authority-data: ${credentials[0]}
users:
  - name: some-user
    user:
      client-key-data: ${credentials[1]}
      token: ${credentials[2]}
contexts:
  - name: some-context
    context:
      cluster: some-cluster
      user: some-user
  - name: some-broken-context
    context:
      cluster: no-such-cluster
      user: some-user
current-context: some-context
`;

describe("parse-kubeconfig-text and add-kubeconfig-text", () => {
  let mainDi: DiContainer;
  let request: RequestFromChannel;

  beforeEach(() => {
    const both = getMainAndRenderer();

    mainDi = both.mainDi;
    mainDi.override(getCustomKubeConfigFilePathInjectable, () => (name: string) => `/some-kube-configs/${name}`);
    both.listenInMain(parseKubeconfigTextListenerInjectable, addKubeconfigTextListenerInjectable);
    request = both.rendererDi.inject(requestFromChannelInjectionToken);
  });

  it("answers the contexts of valid text, and what is wrong with a broken one", async () => {
    const answer = await request(parseKubeconfigTextChannel, kubeconfig);

    expect(answer.contexts).toEqual([
      { name: "some-context" },
      { name: "some-broken-context", error: expect.stringContaining("No valid cluster object") },
    ]);
  });

  it("answers an error for text that is not a kubeconfig", async () => {
    const answer = await request(parseKubeconfigTextChannel, "contexts: [");

    expect(answer.contexts).toEqual([]);
    expect(answer.error).toEqual(expect.any(String));
  });

  it("answers no credential of the text", async () => {
    const answer = JSON.stringify(await request(parseKubeconfigTextChannel, kubeconfig));

    for (const credential of credentials) {
      expect(answer).not.toContain(credential);
    }
  });

  it("writes the text into the kubeconfig directory, and answers the names it added", async () => {
    const answer = await request(addKubeconfigTextChannel, kubeconfig);
    const [fileName] = await mainDi.inject(readDirectoryInjectable)("/some-kube-configs");

    expect(answer).toEqual({ added: ["some-context", "some-broken-context"] });
    expect(await mainDi.inject(readFileInjectable)(`/some-kube-configs/${fileName}`)).toBe(kubeconfig.trim());
    expect(JSON.stringify(answer)).not.toContain(credentials[2]);
  });
});
