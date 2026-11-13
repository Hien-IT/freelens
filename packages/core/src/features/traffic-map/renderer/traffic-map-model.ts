/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { action, computed, observable, reaction, runInAction } from "mobx";
import { applyFilters, availableFacets, defaultFilters, isRateSource, nodeIdOf } from "./filters";
import { buildTrafficGraph, linkIdOf } from "./graph";

import type {
  AggregatedFlow,
  SourcesResponse,
  TrafficFlow,
  TrafficFlowsResult,
  TrafficRequest,
  TrafficResponse,
  TrafficResultData,
  TrafficSourceName,
} from "../common/types";
import type { TrafficFilters } from "./filters";
import type { TrafficGraph } from "./graph";

type RequestBody = TrafficRequest extends infer R ? (R extends unknown ? Omit<R, "clusterId"> : never) : never;

export type RequestTraffic = <Body extends RequestBody>(
  body: Body,
) => Promise<TrafficResponse<TrafficResultData[Body["type"]]>>;

export interface TrafficMapModelDependencies {
  requestTraffic: RequestTraffic;
  /** The namespaces the view is kept to; empty for all of them. */
  getNamespaces(): string[];
}

export type TrafficSelection = { type: "node"; id: string } | { type: "link"; id: string };

export const timeWindows = [
  { seconds: 60, label: "Last 1 minute" },
  { seconds: 300, label: "Last 5 minutes" },
  { seconds: 900, label: "Last 15 minutes" },
  { seconds: 3600, label: "Last hour" },
];

const autoRefreshMs = 30_000;
const retryDelayMs = 2_000;
const maxRetries = 5;

/** The state of the Traffic Map of a cluster: its sources, its flows and what the user chose to see. */
export class TrafficMapModel {
  // Boxes that hold their values as they are: the responses and the filters are
  // replaced whole, never changed in place, and can be large.
  private readonly sourcesBox = observable.box<SourcesResponse | undefined>(undefined, { deep: false });
  private readonly resultBox = observable.box<TrafficFlowsResult | undefined>(undefined, { deep: false });
  private readonly filtersBox = observable.box<TrafficFilters>(defaultFilters, { deep: false });
  private readonly selectionBox = observable.box<TrafficSelection | undefined>(undefined, { deep: false });

  get sources() {
    return this.sourcesBox.get();
  }

  set sources(value) {
    this.sourcesBox.set(value);
  }

  get result() {
    return this.resultBox.get();
  }

  set result(value) {
    this.resultBox.set(value);
  }

  get filters() {
    return this.filtersBox.get();
  }

  set filters(value) {
    this.filtersBox.set(value);
  }

  get selection() {
    return this.selectionBox.get();
  }

  set selection(value) {
    this.selectionBox.set(value);
  }

  @observable accessor sourcesError: string | undefined = undefined;
  @observable accessor detecting = false;

  @observable accessor flowsError: string | undefined = undefined;
  @observable accessor loading = false;
  @observable accessor updatedAt: number | undefined = undefined;

  @observable accessor sinceSeconds = 300;
  @observable accessor groupByPod = false;
  @observable accessor autoRefresh = false;

  private retries = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private refreshTimer?: ReturnType<typeof setInterval>;
  private loadId = 0;

  constructor(private readonly dependencies: TrafficMapModelDependencies) {}

  /** Detects the sources and loads the flows, and loads them again when the namespaces change. */
  start(): () => void {
    void this.detect(false);

    const disposeNamespaces = reaction(
      () => this.dependencies.getNamespaces().join(","),
      () => {
        if (this.sources?.active) void this.load();
      },
    );
    const disposeAutoRefresh = reaction(
      () => this.autoRefresh,
      (enabled) => {
        clearInterval(this.refreshTimer);
        this.refreshTimer = enabled ? setInterval(() => void this.load(), autoRefreshMs) : undefined;
      },
      { fireImmediately: true },
    );

    return () => {
      disposeNamespaces();
      disposeAutoRefresh();
      clearInterval(this.refreshTimer);
      clearTimeout(this.retryTimer);
      this.loadId++;
    };
  }

  async detect(refresh: boolean) {
    runInAction(() => {
      this.detecting = true;
      this.sourcesError = undefined;
    });

    const response = await this.dependencies.requestTraffic({ type: "sources", refresh });

    runInAction(() => {
      this.detecting = false;

      if (response.callWasSuccessful) {
        this.sources = response.response;
      } else {
        this.sourcesError = response.error;
      }
    });

    if (response.callWasSuccessful && response.response.active) {
      await this.load();
    }
  }

  async setSource(source: TrafficSourceName) {
    const response = await this.dependencies.requestTraffic({ type: "set-source", source });

    runInAction(() => {
      if (response.callWasSuccessful) {
        this.sources = response.response;
        this.result = undefined;
      } else {
        this.sourcesError = response.error;
      }
    });

    if (response.callWasSuccessful) {
      await this.load();
    }
  }

  async load() {
    const id = ++this.loadId;

    clearTimeout(this.retryTimer);
    runInAction(() => {
      this.loading = true;
    });

    const response = await this.dependencies.requestTraffic({
      type: "flows",
      query: {
        namespaces: this.dependencies.getNamespaces(),
        sinceSeconds: this.sinceSeconds,
        groupByPod: this.groupByPod,
      },
    });

    if (id !== this.loadId) {
      return;
    }

    runInAction(() => {
      this.loading = false;
      this.updatedAt = Date.now();

      if (response.callWasSuccessful) {
        this.result = response.response;
        this.flowsError = undefined;
      } else {
        this.flowsError = response.error;
      }
    });

    // A warning worth retrying, such as a port-forward still coming up, with
    // nothing to draw yet: try again shortly, a few times.
    const result = response.callWasSuccessful ? response.response : undefined;
    const retriable =
      result?.warning && result.aggregated.length === 0 && (result.warningKind ?? "transient") === "transient";

    if (retriable && this.retries < maxRetries) {
      this.retries++;
      this.retryTimer = setTimeout(() => void this.load(), retryDelayMs);
    } else {
      this.retries = 0;
    }
  }

  @action setWindow(seconds: number) {
    this.sinceSeconds = seconds;
    void this.load();
  }

  @action setGroupByPod(value: boolean) {
    this.groupByPod = value;
    this.selection = undefined;
    void this.load();
  }

  @action setAutoRefresh(value: boolean) {
    this.autoRefresh = value;
  }

  @action updateFilters(update: Partial<TrafficFilters>) {
    this.filters = { ...this.filters, ...update };
  }

  @action resetFilters() {
    this.filters = { ...defaultFilters, hideSystem: false, collapseInternet: false };
  }

  @action select(selection: TrafficSelection | undefined) {
    this.selection = selection;
  }

  @action focus(id: string | undefined) {
    this.filters = { ...this.filters, focus: id };
    this.selection = id ? { type: "node", id } : undefined;
  }

  /** Whether the active source measures request rates rather than counting connections. */
  @computed get rateBased(): boolean {
    return isRateSource(this.result?.source ?? this.sources?.active);
  }

  @computed get visibleFlows(): AggregatedFlow[] {
    return applyFilters(this.result?.aggregated ?? [], this.filters, this.rateBased);
  }

  @computed get graph(): TrafficGraph {
    return buildTrafficGraph(this.visibleFlows, this.rateBased);
  }

  @computed get facets() {
    return availableFacets(this.result?.aggregated ?? []);
  }

  /** The node ids that the focus search offers, busiest first. */
  @computed get focusCandidates(): string[] {
    const volumes = new Map<string, number>();

    for (const flow of this.result?.aggregated ?? []) {
      for (const endpoint of [flow.source, flow.destination]) {
        const id = nodeIdOf(endpoint);

        volumes.set(id, (volumes.get(id) ?? 0) + flow.flowCount);
      }
    }

    return [...volumes].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  }

  @computed get selectedLink(): AggregatedFlow | undefined {
    const selection = this.selection;

    return selection?.type === "link" ? this.visibleFlows.find((flow) => linkIdOf(flow) === selection.id) : undefined;
  }

  /** The single flows behind the selection, or all of them, newest first. */
  @computed get selectedRecords(): TrafficFlow[] {
    const records = this.result?.flows ?? [];
    const selection = this.selection;

    if (!selection) {
      return records;
    }

    const endpointId = (flow: TrafficFlow, side: "source" | "destination") => {
      const endpoint = flow[side];

      // A pod is drawn as its workload unless the view draws pods.
      return !this.groupByPod && endpoint.kind === "Pod" && endpoint.workload && endpoint.namespace
        ? `${endpoint.namespace}/${endpoint.workload}`
        : nodeIdOf(endpoint);
    };

    if (selection.type === "node") {
      return records.filter(
        (flow) => endpointId(flow, "source") === selection.id || endpointId(flow, "destination") === selection.id,
      );
    }

    const link = this.selectedLink;

    if (!link) {
      return [];
    }

    return records.filter(
      (flow) =>
        endpointId(flow, "source") === nodeIdOf(link.source) &&
        endpointId(flow, "destination") === nodeIdOf(link.destination) &&
        flow.port === link.port,
    );
  }
}
