/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import * as utilities from "@freelensapp/utilities";
import { buildVersionInitializable } from "../../features/vars/build-version/common/token";
import { getDiForExtensionApi } from "../extension-api-di";

/**
 * Every export of `@freelensapp/utilities` is extension API, except the
 * members below. Most need Node in the renderer, which the v2 contract does
 * not guarantee (C4, C5 in `docs/extensions/api.md`); `assert` is the host's
 * own replacement for `node:assert` and was never part of the API. A new
 * export of the package becomes API unless it is added here. The host keeps
 * importing all of them from the package.
 *
 * This is a destructure rather than an `Omit<>` so that the declaration of
 * `Util` is an object type without these names, instead of a reference to the
 * whole package that would carry them into the bundled declarations.
 */
const {
  base64: _base64,
  isBuffer: _isBuffer,
  isErrnoException: _isErrnoException,
  isExecException: _isExecException,
  isExecFileException: _isExecFileException,
  isChildProcessError: _isChildProcessError,
  isRequestError: _isRequestError,
  assert: _assert,
  ...extensionUtilities
} = utilities;

const Util = {
  ...extensionUtilities,

  getAppVersion: () => {
    const di = getDiForExtensionApi();

    return di.inject(buildVersionInitializable.stateToken);
  },
};

export { Util };
