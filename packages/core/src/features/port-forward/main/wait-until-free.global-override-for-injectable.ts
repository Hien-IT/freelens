/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getGlobalOverride } from "@freelensapp/test-utils";
import waitUntilFreeInjectable from "./wait-until-free.injectable";

export default getGlobalOverride(waitUntilFreeInjectable, () => async () => {});
