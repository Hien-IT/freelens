/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getGlobalOverride } from "@freelensapp/test-utils";
import isTauriBuildRunningInjectable from "./is-tauri-build-running.injectable";

export default getGlobalOverride(isTauriBuildRunningInjectable, () => () => undefined);
