/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getGlobalOverride } from "@freelensapp/test-utils";
import openPathInjectable from "./open-path.injectable";

export default getGlobalOverride(openPathInjectable, () => async () => "");
