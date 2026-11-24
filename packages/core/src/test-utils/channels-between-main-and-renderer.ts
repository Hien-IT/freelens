/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import {
  enlistMessageChannelListenerInjectionToken,
  enlistRequestChannelListenerInjectionToken,
  requestChannelListenerInjectionToken,
} from "@freelensapp/messaging";
import { getMessageBridgeFake } from "@freelensapp/messaging-fake-bridge";
import { getDiForUnitTesting as getMainDi } from "../main/getDiForUnitTesting";
import { getDiForUnitTesting as getRendererDi } from "../renderer/getDiForUnitTesting";

import type { MessageChannelListener, RequestChannelListener } from "@freelensapp/messaging";

import type { Injectable } from "@ogre-tools/injectable";

type ListenerInjectable =
  | Injectable<RequestChannelListener<any>, RequestChannelListener<any>, void>
  | Injectable<MessageChannelListener<any>, MessageChannelListener<any>, void>;

/**
 * A main and a renderer joined by the fake bridge, for the tests of a channel
 * from both sides. Main listens only on the listeners a test names, once it has
 * overridden what they inject, rather than starting all of main.
 */
export const getMainAndRenderer = () => {
  const mainDi = getMainDi();
  const rendererDi = getRendererDi();
  const bridge = getMessageBridgeFake();

  bridge.involve(mainDi, rendererDi);

  const listenIn = (di: typeof mainDi) => (listeners: ListenerInjectable[]) => {
    const enlistRequestListener = di.inject(enlistRequestChannelListenerInjectionToken);
    const enlistMessageListener = di.inject(enlistMessageChannelListenerInjectionToken);

    for (const listenerInjectable of listeners) {
      if (listenerInjectable.injectionToken === requestChannelListenerInjectionToken) {
        enlistRequestListener(di.inject(listenerInjectable) as RequestChannelListener<any>);
      } else {
        enlistMessageListener(di.inject(listenerInjectable) as MessageChannelListener<any>);
      }
    }
  };

  return {
    mainDi,
    rendererDi,
    bridge,
    listenInMain: (...listeners: ListenerInjectable[]) => listenIn(mainDi)(listeners),
    listenInRenderer: (...listeners: ListenerInjectable[]) => listenIn(rendererDi)(listeners),
  };
};
