/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { action, computed, observable, reaction, runInAction } from "mobx";
import { applyFilters, availableFacets, defaultFilters, nodeIdOf, volumeUnitOf } from "./filters";
import { buildTrafficGraph } from "./graph";

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
import type { TrafficFilters, VolumeUnit } from "./filters";
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
  { seconds: 60, label: "Last 1 minute", shortLabel: "1m" },
  { seconds: 300, label: "Last 5 minutes", shortLabel: "5m" },
  { seconds: 900, label: "Last 15 minutes", shortLabel: "15m" },
  { seconds: 3600, label: "Last hour", shortLabel: "1h" },
];

const autoRefreshMs = 30_000;
/**
 * How much of a graph the map draws without asking, counted as its nodes and
 * twice its edges: past it, the cards no longer fit a screen and the edges no
 * longer read. Past the ceiling it is not drawn at all.
 */
export const graphBudget = 400;
export const graphCeiling = 3000;
const retryDelayMs = 2_000;
const maxRetries = 5;
/** After an install, how often and how many times to detect again until the new source reports traffic. */
export const installPollMs = 5_000;
export const maxInstallPolls = 24;

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
  /** The user asked to draw a graph past the budget. */
  @observable accessor drawAnyway = false;

  /** A source is being installed with Helm. */
  @observable accessor installing = false;
  /** Why the last install failed. */
  @observable accessor installError: string | undefined = undefined;
  /** The source the last install installed. */
  @observable accessor installed: TrafficSourceName | undefined = undefined;
  /** The installed source is detected again until it reports traffic, or the detection gives up. */
  @observable accessor waitingForSource = false;

  private retries = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private refreshTimer?: ReturnType<typeof setInterval>;
  private loadId = 0;
  private installPollTimer?: ReturnType<typeof setTimeout>;
  private installPollId = 0;

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
      this.stopWaitingForSource();
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

  /**
   * Installs a source with the Helm chart that main knows for it. Main answers
   * with a new detection: when a source is active, its flows load; otherwise
   * the sources are detected again every few seconds until one is, a few
   * minutes at most, as the pods of the new source start and gather traffic.
   */
  async installSource(source: TrafficSourceName) {
    this.stopWaitingForSource();
    runInAction(() => {
      this.installing = true;
      this.installError = undefined;
      this.installed = undefined;
    });

    const response = await this.dependencies.requestTraffic({ type: "install-source", source });

    runInAction(() => {
      this.installing = false;

      if (response.callWasSuccessful) {
        this.sources = response.response;
        this.installed = source;
      } else {
        this.installError = response.error;
      }
    });

    if (!response.callWasSuccessful) {
      return;
    }

    if (response.response.active) {
      await this.load();
    } else {
      this.waitForSource();
    }
  }

  private waitForSource() {
    const id = ++this.installPollId;
    let polls = 0;

    runInAction(() => {
      this.waitingForSource = true;
    });

    const poll = () => {
      this.installPollTimer = setTimeout(async () => {
        polls++;
        await this.detect(true);

        if (id !== this.installPollId) {
          return;
        }

        if (this.sources?.active || polls >= maxInstallPolls) {
          runInAction(() => {
            this.waitingForSource = false;
          });
        } else {
          poll();
        }
      }, installPollMs);
    };

    poll();
  }

  private stopWaitingForSource() {
    clearTimeout(this.installPollTimer);
    this.installPollId++;
    runInAction(() => {
      this.waitingForSource = false;
    });
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

  /**
   * Clears every filter, the system traffic included, but keeps how the view
   * draws what it shows: the Internet node and the cluster nodes stay merged.
   */
  @action resetFilters() {
    const { collapseInternet, collapseHosts } = this.filters;

    this.filters = { ...defaultFilters, hideSystem: false, collapseInternet, collapseHosts };
  }

  @action select(selection: TrafficSelection | undefined) {
    this.selection = selection;
  }

  @action focus(id: string | undefined) {
    this.filters = { ...this.filters, focus: id };
    this.selection = id ? { type: "node", id } : undefined;
  }

  /** What the volume of an edge measures, for the source of the flows. */
  @computed get unit(): VolumeUnit {
    return volumeUnitOf(this.result?.source ?? this.sources?.active);
  }

  @computed get visibleFlows(): AggregatedFlow[] {
    return applyFilters(this.result?.aggregated ?? [], this.filters, this.unit);
  }

  @computed get graph(): TrafficGraph {
    return buildTrafficGraph(this.visibleFlows, this.unit);
  }

  /**
   * What the user chose to look at: the namespaces, the window, the source,
   * the grouping and the filters. The graph fits itself to the view when it
   * changes, and keeps the zoom across refreshes of the same view.
   */
  @computed get viewKey(): string {
    return JSON.stringify([
      this.dependencies.getNamespaces(),
      this.sinceSeconds,
      this.sources?.active,
      this.groupByPod,
      this.filters,
    ]);
  }

  /** The size of the graph as the budget counts it. */
  @computed get graphSize(): number {
    return this.graph.nodes.length + 2 * this.graph.links.length;
  }

  /** The graph is too large to draw: the view offers ways to narrow it instead. */
  @computed get tooLarge(): boolean {
    return this.graphSize > graphCeiling || (!this.drawAnyway && this.graphSize > graphBudget);
  }

  @action setDrawAnyway(value: boolean) {
    this.drawAnyway = value;
  }

  /** Hides every namespace of the traffic but one. */
  @action onlyNamespace(namespace: string) {
    this.filters = {
      ...this.filters,
      hiddenNamespaces: this.facets.namespaces.filter((candidate) => candidate !== namespace),
    };
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

  /** The aggregated flows of the selected edge, one per port, busiest first; empty without one. */
  @computed get selectedLinkFlows(): AggregatedFlow[] {
    const selection = this.selection;

    if (selection?.type !== "link") {
      return [];
    }

    return this.graph.links.find((link) => link.id === selection.id)?.flows ?? [];
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

    const [link] = this.selectedLinkFlows;

    if (!link) {
      return [];
    }

    const ports = new Set(this.selectedLinkFlows.map((flow) => flow.port));

    return records.filter(
      (flow) =>
        endpointId(flow, "source") === nodeIdOf(link.source) &&
        endpointId(flow, "destination") === nodeIdOf(link.destination) &&
        ports.has(flow.port),
    );
  }
}
