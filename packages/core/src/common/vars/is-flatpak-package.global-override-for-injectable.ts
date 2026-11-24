/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getGlobalOverride } from "@freelensapp/test-utils";
import isFlatpakPackageInjectable from "./is-flatpak-package.injectable";

export default getGlobalOverride(isFlatpakPackageInjectable, () => false);
