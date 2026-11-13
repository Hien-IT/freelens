/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { buildIngressMap } from "./helpers/details-graph";
import { KubeResourceChart } from "./kube-resource-chart";

import type { Ingress } from "@freelensapp/kube-object";

import type { DetailsGraph, DetailsGraphObjects } from "./helpers/details-graph";

/**
 * The map of an Ingress: its TLS secrets, the Services of its backends, and
 * the pods they select, with the other Services that select them and their
 * controllers.
 */
export class KubeIngressChart extends KubeResourceChart<Ingress> {
  protected buildGraph(objects: DetailsGraphObjects, previous: DetailsGraph) {
    return buildIngressMap(this.props.object, objects, previous);
  }
}
