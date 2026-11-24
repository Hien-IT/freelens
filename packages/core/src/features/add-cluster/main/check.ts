/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { loadConfigFromString, splitConfig } from "../../../common/kube-helpers/main/kube-helpers";

import type { PastedKubeconfigCheck } from "../common/channels";

/** The names and the validation errors of the contexts of the text, as the dialog showed them. */
export const checkKubeconfigText = (text: string): PastedKubeconfigCheck => {
  let loaded: ReturnType<typeof loadConfigFromString>;

  try {
    loaded = loadConfigFromString(text.trim() || "{}");
  } catch (error) {
    // text that is not YAML at all, which the dialog left unexplained before
    return { contexts: [], error: String(error) };
  }

  const { config, error } = loaded;

  return {
    contexts: splitConfig(config).map(({ config, validationResult }) => ({
      name: config.currentContext,
      ...(validationResult.error ? { error: validationResult.error.toString() } : {}),
    })),
    ...(error ? { error: error.toString() } : {}),
  };
};
