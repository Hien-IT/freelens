/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { aggregateFlows, graphFlows } from "../common/aggregation";
import { trafficSourceNames } from "../common/types";
import { BeylaSource } from "./beyla-source";
import { CarettaSource } from "./caretta-source";
import { detectClusterInfo, recommend } from "./cluster-info";
import { HubbleSource } from "./hubble/hubble-source";
import { IstioSource } from "./istio-source";

import type {
  SourceStatus,
  SourcesResponse,
  TrafficFlow,
  TrafficFlowsQuery,
  TrafficFlowsResult,
  TrafficSourceName,
} from "../common/types";
import type { ClusterAccess } from "./cluster-access";
import type { TrafficSource } from "./source";

/** How long a detection answers for the sources before they are detected again. */
const detectionMaxAgeMs = 2 * 60_000;
/** The most flows that a source is asked for. */
const sourceFlowLimit = 1_000;
/** The most single flows sent to the view, the newest ones; the aggregate covers them all. */
const recordLimit = 1_000;
const maxWindowSeconds = 60 * 60;

/** The newest flows, newest first. */
export function newestFlows(flows: readonly TrafficFlow[], limit: number): TrafficFlow[] {
  return [...flows].sort((a, b) => b.lastSeen - a.lastSeen).slice(0, limit);
}

/**
 * The traffic sources of one cluster: detects them, keeps the one that answers
 * for flows, and reads it.
 */
export class TrafficManager {
  private readonly sources: Map<TrafficSourceName, TrafficSource>;
  /** The source that answers for flows: the one the user picked or, until then, the first available. */
  private active?: TrafficSourceName;
  private detection?: { at: number; result: Promise<SourcesResponse> };

  constructor(
    private readonly access: ClusterAccess,
    sources?: TrafficSource[],
  ) {
    // The order is the priority of the sources: Hubble sees the most, Istio
    // has L7 metrics, Caretta and Beyla read eBPF metrics.
    const all = sources ?? [
      new HubbleSource(access),
      new IstioSource(access),
      new CarettaSource(access),
      new BeylaSource(access),
    ];

    this.sources = new Map(all.map((source) => [source.name, source]));
  }

  /** The sources as last detected, detected again when that is older than two minutes or `refresh` asks. */
  detectSources(refresh = false): Promise<SourcesResponse> {
    const now = Date.now();

    if (!refresh && this.detection && now - this.detection.at < detectionMaxAgeMs) {
      return this.detection.result;
    }

    const result = this.runDetection();

    this.detection = { at: now, result };
    result.catch(() => {
      if (this.detection?.result === result) {
        this.detection = undefined;
      }
    });

    return result;
  }

  private async runDetection(): Promise<SourcesResponse> {
    const detected: SourceStatus[] = [];

    for (const name of trafficSourceNames) {
      const source = this.sources.get(name);

      if (!source) continue;

      try {
        const result = await source.detect();

        if (result.available) {
          detected.push({
            name,
            status: "available",
            version: result.version,
            native: result.native,
            message: result.message,
          });
        } else if (result.present) {
          detected.push({ name, status: "present", version: result.version, message: result.message });
        } else {
          detected.push({ name, status: "not_found", message: result.message });
        }
      } catch (error) {
        detected.push({ name, status: "error", message: error instanceof Error ? error.message : String(error) });
      }
    }

    const available = detected.filter((status) => status.status === "available").map((status) => status.name);

    if (!this.active || !available.includes(this.active)) {
      if (this.active) {
        this.sources.get(this.active)?.close();
      }

      this.active = available[0];
    }

    const cluster = await detectClusterInfo(this.access);

    return { cluster, active: this.active, detected, recommended: recommend(cluster, detected) };
  }

  /** Makes a source the active one, as the user picked it. */
  async setActiveSource(name: TrafficSourceName): Promise<SourcesResponse> {
    const sources = await this.detectSources();
    const status = sources.detected.find((candidate) => candidate.name === name);

    if (status?.status !== "available") {
      throw new Error(`${name} is not available in this cluster`);
    }

    if (this.active && this.active !== name) {
      this.sources.get(this.active)?.close();
    }

    this.active = name;

    return { ...sources, active: name };
  }

  async getFlows(query: TrafficFlowsQuery): Promise<TrafficFlowsResult> {
    if (!this.active) {
      await this.detectSources(true);
    }

    const source = this.active ? this.sources.get(this.active) : undefined;

    if (!source) {
      throw new Error("No traffic source is available in this cluster");
    }

    const namespaces = [...new Set(query.namespaces ?? [])].filter(Boolean).sort();
    const sinceSeconds = Math.min(Math.max(Math.round(query.sinceSeconds) || 300, 30), maxWindowSeconds);
    const response = await source.getFlows({ namespaces, sinceSeconds, limit: sourceFlowLimit });
    const drawn = query.groupByPod ? response.flows : graphFlows(response.flows);

    return {
      ...response,
      flows: newestFlows(response.flows, recordLimit),
      flowsTotal: response.flows.length,
      aggregated: aggregateFlows(drawn),
    };
  }

  close() {
    for (const source of this.sources.values()) {
      source.close();
    }
  }
}
