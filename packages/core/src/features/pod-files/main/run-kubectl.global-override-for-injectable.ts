/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getGlobalOverrideForFunction } from "@freelensapp/test-utils";
import runKubectlInjectable from "./run-kubectl.injectable";

export default getGlobalOverrideForFunction(runKubectlInjectable);
