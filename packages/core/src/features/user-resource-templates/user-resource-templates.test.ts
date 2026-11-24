/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { waitFor } from "@testing-library/react";
import { runInAction } from "mobx";
import { beforeEach, describe, expect, it } from "vitest";
import homeDirectoryPathInjectable from "../../common/os/home-directory-path.injectable";
import userCreateResourceTemplatesInjectable from "../../renderer/components/dock/create-resource/user-templates.injectable";
import { getMainAndRenderer } from "../../test-utils/channels-between-main-and-renderer";
import userResourceTemplateFilesInjectable from "./main/files.injectable";
import initialUserResourceTemplatesListenerInjectable from "./main/request-listener.injectable";
import userResourceTemplatesUpdateListenerInjectable from "./renderer/update-listener.injectable";

import type { ObservableMap } from "mobx";

describe("user resource templates", () => {
  let files: ObservableMap<string, string>;
  let templates: ReturnType<typeof getTemplates>;

  const getTemplates = () => {
    const both = getMainAndRenderer();

    both.mainDi.override(homeDirectoryPathInjectable, () => "/some-home");
    both.listenInMain(initialUserResourceTemplatesListenerInjectable);
    both.listenInRenderer(userResourceTemplatesUpdateListenerInjectable);
    files = both.mainDi.inject(userResourceTemplateFilesInjectable);
    runInAction(() => files.set("/some-home/.freelens/templates/pod.yaml", "kind: Pod"));

    return both.rendererDi.inject(userCreateResourceTemplatesInjectable);
  };

  beforeEach(async () => {
    templates = getTemplates();

    await waitFor(() => expect(templates.get()).not.toEqual([]));
  });

  it("shows the templates main has, grouped by folder", () => {
    expect(templates.get()).toEqual([{ label: "ungrouped", options: [{ label: "pod", value: "kind: Pod" }] }]);
  });

  it("shows a template added after the first answer", () => {
    runInAction(() => files.set("/some-home/.freelens/templates/apps/deployment.yaml", "kind: Deployment"));

    expect(templates.get()).toEqual([
      { label: "ungrouped", options: [{ label: "pod", value: "kind: Pod" }] },
      { label: "apps", options: [{ label: "deployment", value: "kind: Deployment" }] },
    ]);
  });

  it("stops showing a template main no longer has", () => {
    runInAction(() => files.delete("/some-home/.freelens/templates/pod.yaml"));

    expect(templates.get()).toEqual([]);
  });
});
