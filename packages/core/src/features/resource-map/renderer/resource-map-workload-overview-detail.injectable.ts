/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { computed } from "mobx";
import { workloadOverviewDetailInjectionToken } from "../../../renderer/components/workloads-overview/workload-overview-details/workload-overview-detail-injection-token";
import { ResourceMapWorkloadsOverviewItem } from "./resource-map-entry-points";

const resourceMapWorkloadOverviewDetailInjectable = getInjectable({
  id: "resource-map-workload-overview-detail",

  instantiate: () => ({
    Component: ResourceMapWorkloadsOverviewItem,
    enabled: computed(() => true),
    // Between the statuses (50) and the events (300), where an overview item
    // of an extension of priority 25 goes (0.5 + 100 - priority).
    orderNumber: 75.5,
  }),

  injectionToken: workloadOverviewDetailInjectionToken,
});

export default resourceMapWorkloadOverviewDetailInjectable;
