/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannel } from "@freelensapp/messaging";

/** The contexts of pasted kubeconfig text, with what is wrong with each; never a credential. */
export interface PastedKubeconfigCheck {
  contexts: { name: string; error?: string }[];
  error?: string;
}

export const parseKubeconfigTextChannel = getRequestChannel<string, PastedKubeconfigCheck>("parse-kubeconfig-text");

/** Writes pasted kubeconfig text into the kubeconfig directory of the application. */
export const addKubeconfigTextChannel = getRequestChannel<string, { added: string[] }>("add-kubeconfig-text");
