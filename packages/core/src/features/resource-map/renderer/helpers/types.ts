/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import type { KubeObject } from "@freelensapp/kube-object";

import type { LinkObject as GraphLinkObject, NodeObject as GraphNodeObject } from "react-force-graph-2d";

/** The data of a node of the map: the object it stands for and how it is drawn. */
export interface ChartNodeData {
  id: string;
  object: KubeObject;
  kind: string;
  name: string;
  namespace?: string;
  image?: HTMLImageElement;
  value?: number;
  color?: string;
  visible?: boolean;
}

/** A node as force-graph holds it, with the position it computes. */
export type ChartDataSeries = GraphNodeObject<ChartNodeData>;

/** A link between two nodes, by node or by id until force-graph resolves it. */
export type LinkObject = GraphLinkObject<ChartNodeData>;
