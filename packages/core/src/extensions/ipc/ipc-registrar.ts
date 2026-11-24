/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { sha256Hex } from "@freelensapp/utilities";
import { Singleton } from "../../common/utils/singleton";
import { broadcastMessage } from "./common/legacy-ipc";

import type { LensExtension } from "../lens-extension";

export const IpcPrefix = Symbol();

export abstract class IpcRegistrar extends Singleton {
  readonly [IpcPrefix]: string;

  constructor(protected readonly extension: LensExtension) {
    super();
    this[IpcPrefix] = sha256Hex(extension.id);
  }

  /**
   *
   * @param channel The channel to broadcast to your whole extension, both `main` and `renderer`
   * @param args The arguments passed to all listeners
   */
  broadcast(channel: string, ...args: any[]): void {
    broadcastMessage(`extensions@${this[IpcPrefix]}:${channel}`, ...args);
  }
}
