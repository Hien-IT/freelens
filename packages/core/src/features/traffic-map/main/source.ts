/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import type { DetectionResult, FlowsResponse, TrafficFlow, TrafficSourceName } from "../common/types";

export interface FlowOptions {
  /** Keep flows with either endpoint in one of these namespaces; empty for all. */
  namespaces: readonly string[];
  /** The window to read, in seconds. */
  sinceSeconds: number;
  /** The most flows to return. */
  limit: number;
}

/** A tool that observes the traffic of a cluster. */
export interface TrafficSource {
  readonly name: TrafficSourceName;
  /** Whether the tool runs in the cluster and can be read. */
  detect(): Promise<DetectionResult>;
  getFlows(options: FlowOptions): Promise<FlowsResponse>;
  /** Releases what the source holds open, such as a port-forward. */
  close(): void;
}

/** Whether a flow has an endpoint in one of the namespaces; every flow when there are none. */
export function inNamespaces(flow: TrafficFlow, namespaces: readonly string[]): boolean {
  if (namespaces.length === 0) {
    return true;
  }

  return namespaces.includes(flow.source.namespace) || namespaces.includes(flow.destination.namespace);
}

/** Escapes a value for a PromQL string literal in double quotes. */
export function promString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** A PromQL regular expression that matches exactly one of the values. */
export function promAlternatives(values: readonly string[]): string {
  return values.map((value) => promString(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("|");
}

/** A PromQL range for a window in seconds, never shorter than one minute. */
export function promWindow(sinceSeconds: number): string {
  return `${Math.max(60, Math.round(sinceSeconds))}s`;
}
