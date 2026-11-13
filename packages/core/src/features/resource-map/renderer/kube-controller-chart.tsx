/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { buildControllerMap } from "./helpers/details-graph";
import { KubeResourceChart } from "./kube-resource-chart";

import type { DaemonSet, Deployment, StatefulSet } from "@freelensapp/kube-object";

import type { DetailsGraph, DetailsGraphObjects } from "./helpers/details-graph";

/**
 * The map of a Deployment, a DaemonSet or a StatefulSet: its pods, with their
 * secrets, config maps and claims, its Helm release, the Services that select
 * the pods, and the first Ingress in front of those Services, which also takes
 * the links of the later ones.
 */
export class KubeControllerChart extends KubeResourceChart<Deployment | DaemonSet | StatefulSet> {
  protected buildGraph(objects: DetailsGraphObjects, previous: DetailsGraph) {
    return buildControllerMap(this.props.object, objects, previous);
  }
}
