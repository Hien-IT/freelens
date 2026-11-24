/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import requestPathExistsInjectable from "../../../../features/validate-directory/renderer/path-exists.injectable";
import { asyncInputValidator } from "../input_validators";

const isPathInjectable = getInjectable({
  id: "is-path",

  instantiate: (di) => {
    const pathExists = di.inject(requestPathExistsInjectable);

    return asyncInputValidator({
      debounce: 100,
      condition: ({ type }) => type === "text",
      validate: async (value) => {
        if (!(await pathExists(value))) {
          throw new Error(`"${value}" is not a valid file path`);
        }
      },
    });
  },
});

export default isPathInjectable;
