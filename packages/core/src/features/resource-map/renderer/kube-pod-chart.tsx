/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { buildPodMap } from "./helpers/details-graph";
import { KubeResourceChart } from "./kube-resource-chart";

import type { Pod } from "@freelensapp/kube-object";

import type { DetailsGraph, DetailsGraphObjects } from "./helpers/details-graph";

/**
 * The map of a pod: its secrets, config maps and claims, the Services that
 * select it, its controller with its Helm release, and the first Ingress in
 * front of those Services, which also takes the links of the later ones.
 */
export class KubePodChart extends KubeResourceChart<Pod> {
  protected buildGraph(objects: DetailsGraphObjects, previous: DetailsGraph) {
    return buildPodMap(this.props.object, objects, previous);
  }
}
