/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getOrInsert } from "@freelensapp/utilities";
import { getInjectable } from "@ogre-tools/injectable";
import { computed } from "mobx";
import getDirnameOfPathInjectable from "../../../common/path/get-dirname.injectable";
import getRelativePathInjectable from "../../../common/path/main/get-relative-path.injectable";
import parsePathInjectable from "../../../common/path/parse.injectable";
import userResourceTemplateFilesInjectable from "./files.injectable";
import userResourceTemplatesFolderInjectable from "./folder.injectable";

import type { UserResourceTemplate, UserResourceTemplateGroup } from "../common/channels";

/** The templates grouped by the folder they are in, as the renderer shows them. */
const userResourceTemplatesInjectable = getInjectable({
  id: "user-resource-templates",
  instantiate: (di) => {
    const files = di.inject(userResourceTemplateFilesInjectable);
    const folder = di.inject(userResourceTemplatesFolderInjectable);
    const getRelativePath = di.inject(getRelativePathInjectable);
    const getDirnameOfPath = di.inject(getDirnameOfPathInjectable);
    const parsePath = di.inject(parsePathInjectable);

    return computed((): UserResourceTemplateGroup[] => {
      const groups = new Map<string, UserResourceTemplate[]>();

      for (const [filePath, value] of files) {
        const rawRelative = getDirnameOfPath(getRelativePath(folder, filePath));
        const title = rawRelative === "." ? "ungrouped" : rawRelative;

        getOrInsert(groups, title, []).push({
          label: parsePath(filePath).name,
          value,
        });
      }

      return Array.from(groups.entries(), ([label, options]) => ({ label, options }));
    });
  },
});

export default userResourceTemplatesInjectable;
