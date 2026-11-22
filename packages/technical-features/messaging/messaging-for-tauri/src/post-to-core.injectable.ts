/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";

export type IpcRoute = "/ipc/request" | "/ipc/messages" | "/ipc/poll";

export interface CoreResponse {
  status: number;
  statusText: string;
  body: unknown;
}

export type PostToCore = (route: IpcRoute, body: unknown) => Promise<CoreResponse>;

const parse = (text: string): unknown => {
  try {
    return text ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
};

// The only code that calls fetch (research R10). The route is relative, so the
// view always calls its own host, which names it to the core (research R7).
const postToCoreInjectable = getInjectable({
  id: "post-to-core",

  instantiate: (): PostToCore => async (route, body) => {
    const response = await fetch(route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    return {
      status: response.status,
      statusText: response.statusText,
      body: parse(await response.text()),
    };
  },

  causesSideEffects: true,
});

export default postToCoreInjectable;
