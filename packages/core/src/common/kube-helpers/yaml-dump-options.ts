/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import type { DumpOptions } from "js-yaml";

export const defaultYamlDumpOptions: DumpOptions = {
  seqNoIndent: true,
  noRefs: true,
  quoteStyle: "double",
  sortKeys: true,
};
