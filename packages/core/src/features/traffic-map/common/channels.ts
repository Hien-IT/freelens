/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannel } from "@freelensapp/messaging";

import type { TrafficRequest, TrafficResponse } from "./types";

/**
 * Detects the traffic sources of a cluster and reads their flows. The sources
 * are read in the main process, which reaches Prometheus and Hubble Relay.
 */
export const trafficMapChannel = getRequestChannel<TrafficRequest, TrafficResponse<unknown>>("traffic-map");
