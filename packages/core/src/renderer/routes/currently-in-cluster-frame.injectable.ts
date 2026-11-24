/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";

const currentlyInClusterFrameInjectable = getInjectable({
  id: "currently-in-cluster-frame",
  // a cluster frame is an iframe of the root frame
  instantiate: () => window.top !== window,
  causesSideEffects: true,
});

export default currentlyInClusterFrameInjectable;
