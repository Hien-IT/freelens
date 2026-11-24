/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import path from "node:path";
import { noop } from "@freelensapp/utilities";
import fse from "fs-extra";

/**
 * Removes the tarball of an install and the directory of its own it was put
 * in. `rmdir` removes the directory only once it is empty, so a directory
 * shared with anything else stays.
 */
export const discardTarball = (tempFile: string) =>
  fse
    .unlink(tempFile)
    .then(() => fse.rmdir(path.dirname(tempFile)))
    .catch(noop);
