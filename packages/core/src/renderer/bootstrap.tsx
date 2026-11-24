/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import "./components/app.scss";

import { assert } from "@freelensapp/utilities";
import extensionDiscoveryInjectable from "../extensions/extension-discovery/renderer/extension-discovery.injectable";
import extensionLoaderInjectable from "../extensions/extension-loader/extension-loader.injectable";
import initClusterFrameInjectable from "./frames/cluster-frame/init-cluster-frame/init-cluster-frame.injectable";
import initRootFrameInjectable from "./frames/root-frame/init-root-frame.injectable";
import currentlyInClusterFrameInjectable from "./routes/currently-in-cluster-frame.injectable";

import type { DiContainerForInjection } from "@ogre-tools/injectable";

export async function bootstrap(di: DiContainerForInjection) {
  const rootElem = document.getElementById("app");

  assert(rootElem, "#app MUST exist");

  await di.inject(extensionLoaderInjectable).init();
  await di.inject(extensionDiscoveryInjectable).init();

  const isClusterFrame = di.inject(currentlyInClusterFrameInjectable);
  let initializeApp;

  // TODO: Introduce proper architectural boundaries between root and cluster iframes
  if (isClusterFrame) {
    initializeApp = di.inject(initClusterFrameInjectable);
  } else {
    initializeApp = di.inject(initRootFrameInjectable);
  }

  try {
    await initializeApp();
  } catch (error) {
    console.error(`[BOOTSTRAP]: view initialization error: ${error}`, {
      origin: location.href,
      isTopFrameView: !isClusterFrame,
    });
  }
}
