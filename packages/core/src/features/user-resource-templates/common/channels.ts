/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getMessageChannel, getRequestChannel } from "@freelensapp/messaging";

export interface UserResourceTemplate {
  label: string;
  value: string;
}

/** The templates of one folder under `~/.freelens/templates`. */
export interface UserResourceTemplateGroup {
  label: string;
  options: UserResourceTemplate[];
}

export const initialUserResourceTemplatesChannel = getRequestChannel<void, UserResourceTemplateGroup[]>(
  "initial-user-resource-templates",
);

export const userResourceTemplatesUpdateChannel = getMessageChannel<UserResourceTemplateGroup[]>(
  "user-resource-templates-update",
);
