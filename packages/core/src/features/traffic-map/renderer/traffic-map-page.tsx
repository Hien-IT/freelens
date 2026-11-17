/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Button } from "@freelensapp/button";
import { Icon } from "@freelensapp/icon";
import { ResizeDirection, ResizeGrowthDirection, ResizeSide, ResizingAnchor } from "@freelensapp/resizing-anchor";
import { Spinner } from "@freelensapp/spinner";
import { cssNames } from "@freelensapp/utilities";
import { observer } from "mobx-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { TabLayout } from "../../../renderer/components/layout/tab-layout";
import { NamespaceSelectFilter } from "../../../renderer/components/namespaces/namespace-select-filter";
import { Select } from "../../../renderer/components/select";
import { trafficSourceTitles } from "../common/types";
import { edgeColors, namespacePalette } from "./graph";
import { TrafficDetails } from "./traffic-details";
import { TrafficFiltersPanel } from "./traffic-filters-panel";
import { TrafficGraphView } from "./traffic-graph";
import { TrafficGraphTooLarge } from "./traffic-graph-too-large";
import styles from "./traffic-map.module.scss";
import { TrafficMapModel, timeWindows } from "./traffic-map-model";
import { TrafficSetup } from "./traffic-setup";
import { ConnectionsTable, FlowRecordsTable } from "./traffic-tables";

import type { Confirm } from "../../../renderer/components/confirm-dialog/confirm.injectable";
import type { TrafficEndpoint, TrafficSourceName } from "../common/types";
import type { TrafficCanvasColors } from "./traffic-graph";
import type { TrafficMapModelDependencies } from "./traffic-map-model";

export interface TrafficMapPageDependencies extends TrafficMapModelDependencies {
  /** The colours of the active theme for the canvas; read while rendering, a theme change paints it again. */
  getCanvasColors(): TrafficCanvasColors;
  /** How the user left the page, kept across visits: observable. */
  getViewState(): TrafficMapViewState;
  setViewState(state: Partial<TrafficMapViewState>): void;
  openLink(url: string): void;
  copyText(text: string): void;
  openObject(endpoint: TrafficEndpoint): void;
  /** Asks the user to confirm, in the application's dialog. */
  confirm: Confirm;
}

export interface TrafficMapViewState {
  /** The panel of the connections and the flows is folded down to its tabs. */
  bottomPanelHidden: boolean;
  /** The height of that panel when it is unfolded, in pixels. */
  bottomPanelHeight: number;
  /** The panel of the filters is collapsed, leaving its width to the graph. */
  filtersHidden: boolean;
  tab: "connections" | "flows";
}

/** The heights the panel of the connections and the flows can take, and the one a double click restores. */
const panelHeights = { initial: 260, min: 120, max: 600 };
/** Past this age, the traffic on the page is old enough to say so. */
const staleAfterSeconds = 5 * 60;

/** The kinds of edges: a line of one colour, dashed, or in the colours of two cards as a plain edge is drawn. */
const legendItems: { label: string; color?: string; dashed?: boolean; gradient?: string }[] = [
  { label: "HTTP / gRPC", color: edgeColors.http },
  { label: "DNS", color: edgeColors.dns },
  { label: "Errors (5xx)", color: edgeColors.error },
  { label: "TCP / other", gradient: `linear-gradient(90deg, ${namespacePalette[1]}, ${namespacePalette[4]})` },
  { label: "Dropped", color: edgeColors.tcp, dashed: true },
];

const legendHints = [
  "Arrow: who opened the connection",
  "No arrow: direction unknown",
  "Thicker: more traffic",
  "TCP / other: the colours of its two cards",
  "Moving dots: the way the traffic goes, on the edges in focus and the busiest ones",
  "Hover a card to bring out its connections",
];

function Legend() {
  return (
    <div className={styles.legend}>
      {legendItems.map(({ label, color, dashed, gradient }) => (
        <span key={label} className={styles.legendItem}>
          <span
            className={cssNames(styles.legendLine, {
              [styles.legendDashed]: Boolean(dashed),
              [styles.legendGradient]: Boolean(gradient),
            })}
            style={gradient ? { background: gradient } : { borderColor: color }}
          />
          {label}
        </span>
      ))}
      <Icon
        material="info"
        smallest
        className={styles.legendInfo}
        aria-label="How to read the map"
        tooltip={
          <div>
            {legendHints.map((hint) => (
              <div key={hint}>{hint}</div>
            ))}
          </div>
        }
        tooltipFormatters={{ nowrap: true }}
      />
    </div>
  );
}

/** How long ago, in few characters: just now, 45s ago, 29m ago, 2h ago. */
function ageOf(seconds: number): string {
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;

  return `${Math.floor(seconds / 3600)}h ago`;
}

function Updated({ at }: { at?: number }) {
  const [, setNow] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000);

    return () => clearInterval(timer);
  }, []);

  if (!at) return null;

  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  const stale = seconds > staleAfterSeconds;

  return (
    <span
      className={cssNames(styles.note, styles.updated, { [styles.stale]: stale })}
      title={stale ? "Refresh to see the current traffic" : undefined}
    >
      Updated {ageOf(seconds)}
    </span>
  );
}

const Toolbar = observer(({ model }: { model: TrafficMapModel }) => {
  const available = model.sources?.detected.filter((status) => status.status === "available") ?? [];

  return (
    <div className={styles.toolbar}>
      {available.length > 1 ? (
        <Select<TrafficSourceName, { value: TrafficSourceName; label: string }, false>
          id="traffic-map-source"
          className={styles.select}
          options={available.map((status) => ({ value: status.name, label: trafficSourceTitles[status.name] }))}
          value={model.sources?.active}
          onChange={(option) => option && void model.setSource(option.value)}
        />
      ) : (
        model.sources?.active && (
          <span className={styles.source}>
            <span className={styles.sourceDot} />
            {trafficSourceTitles[model.sources.active]}
          </span>
        )
      )}
      <div className={styles.segmented} role="group" aria-label="Time window">
        {timeWindows.map((window) => {
          const active = model.sinceSeconds === window.seconds;

          return (
            <button
              key={window.seconds}
              type="button"
              className={cssNames(styles.segment, { [styles.segmentActive]: active })}
              title={window.label}
              aria-label={window.label}
              aria-pressed={active}
              onClick={() => !active && model.setWindow(window.seconds)}
            >
              {window.shortLabel}
            </button>
          );
        })}
      </div>
      <div className={styles.refreshGroup}>
        <Icon
          material="refresh"
          tooltip="Refresh"
          aria-label="Refresh"
          onClick={() => void model.load()}
          className={cssNames(styles.iconButton, { [styles.spinning]: model.loading })}
        />
        <button
          type="button"
          className={cssNames(styles.chip, { [styles.chipActive]: model.autoRefresh })}
          title="Refresh every 30 seconds"
          aria-pressed={model.autoRefresh}
          onClick={() => model.setAutoRefresh(!model.autoRefresh)}
        >
          Auto 30s
        </button>
      </div>
      <Updated at={model.updatedAt} />
    </div>
  );
});

const Warning = observer(({ model }: { model: TrafficMapModel }) => {
  const result = model.result;
  const message = model.flowsError ?? result?.warning;

  if (!message) return null;

  return (
    <div className={styles.warning}>
      <Icon material="warning" small />
      <span>{message}</span>
    </div>
  );
});

const Content = observer(
  ({ dependencies, model }: { dependencies: TrafficMapPageDependencies; model: TrafficMapModel }) => {
    const [connectionsFilter, setConnectionsFilter] = useState("");
    const panelRef = useRef<HTMLDivElement>(null);
    const { bottomPanelHidden, bottomPanelHeight, filtersHidden, tab } = dependencies.getViewState();
    const showTab = (next: TrafficMapViewState["tab"]) =>
      dependencies.setViewState({ tab: next, bottomPanelHidden: false });

    if (!model.sources) {
      return model.sourcesError ? (
        <div className={styles.status}>
          <p>{model.sourcesError}</p>
        </div>
      ) : (
        <div className={styles.status}>
          <Spinner />
          <span className={styles.note}>Detecting traffic sources…</span>
        </div>
      );
    }

    if (!model.sources.active) {
      return (
        <TrafficSetup
          model={model}
          openLink={dependencies.openLink}
          copyText={dependencies.copyText}
          confirm={dependencies.confirm}
        />
      );
    }

    const total = model.result?.aggregated.length ?? 0;
    const shown = model.visibleFlows.length;
    const view =
      !model.result && model.loading ? "loading" : shown === 0 ? "empty" : model.tooLarge ? "tooLarge" : "graph";
    const tabClass = (name: TrafficMapViewState["tab"]) =>
      cssNames(styles.tab, { [styles.tabActive]: !bottomPanelHidden && tab === name });
    // The height the panel has on the screen, less than the stored one when the page is too short for it.
    const panelHeight = () => panelRef.current?.getBoundingClientRect().height ?? bottomPanelHeight;

    return (
      <div className={styles.body}>
        {!filtersHidden && <TrafficFiltersPanel model={model} />}
        <div className={styles.main}>
          <Warning model={model} />
          <div className={styles.canvas}>
            {view === "loading" ? (
              <div className={styles.status}>
                <Spinner />
              </div>
            ) : view === "empty" ? (
              <div className={styles.status}>
                <p>
                  {total === 0
                    ? `Observing with ${trafficSourceTitles[model.sources.active]}: no traffic in this window yet.`
                    : "All traffic is filtered out."}
                </p>
                {total > 0 && <Button primary label="Show all traffic" onClick={() => model.resetFilters()} />}
              </div>
            ) : view === "tooLarge" ? (
              <TrafficGraphTooLarge model={model} />
            ) : (
              <TrafficGraphView model={model} colors={dependencies.getCanvasColors()} />
            )}
            <TrafficDetails model={model} openObject={dependencies.openObject} />
            {model.result && view !== "tooLarge" && (
              <div className={styles.stats}>
                {model.graph.nodes.length} endpoints · {shown} of {total} connections
                {model.result.coveredSince
                  ? ` · complete from ${new Date(model.result.coveredSince).toLocaleTimeString()}`
                  : ""}
              </div>
            )}
            {view === "graph" && <Legend />}
          </div>
          <div
            ref={panelRef}
            className={styles.bottom}
            style={bottomPanelHidden ? undefined : { height: bottomPanelHeight }}
          >
            <div className={styles.resizeEdge}>
              <ResizingAnchor
                direction={ResizeDirection.VERTICAL}
                placement={ResizeSide.LEADING}
                growthDirection={ResizeGrowthDirection.BOTTOM_TO_TOP}
                disabled={bottomPanelHidden}
                getCurrentExtent={panelHeight}
                minExtent={panelHeights.min}
                maxExtent={panelHeights.max}
                onDrag={(extent) => dependencies.setViewState({ bottomPanelHeight: extent })}
                onDoubleClick={() => dependencies.setViewState({ bottomPanelHeight: panelHeights.initial })}
              />
            </div>
            <div className={styles.tabBar}>
              <div className={styles.tabList} role="tablist" aria-label="Connections and flows">
                <button
                  type="button"
                  role="tab"
                  aria-selected={!bottomPanelHidden && tab === "connections"}
                  className={tabClass("connections")}
                  onClick={() => showTab("connections")}
                >
                  Connections
                  <span className={styles.count}>{shown}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={!bottomPanelHidden && tab === "flows"}
                  className={tabClass("flows")}
                  onClick={() => showTab("flows")}
                >
                  Flows
                </button>
              </div>
              <div className={styles.tabTools}>
                {!bottomPanelHidden && tab === "connections" && (
                  <input
                    type="search"
                    className={styles.tableFilter}
                    placeholder="Filter connections…"
                    aria-label="Filter connections"
                    value={connectionsFilter}
                    onChange={(event) => setConnectionsFilter(event.target.value)}
                  />
                )}
                <Icon
                  className={styles.iconButton}
                  material={bottomPanelHidden ? "expand_less" : "expand_more"}
                  tooltip={bottomPanelHidden ? "Show the connections and flows" : "Hide the connections and flows"}
                  aria-label={bottomPanelHidden ? "Show the connections and flows" : "Hide the connections and flows"}
                  onClick={() => dependencies.setViewState({ bottomPanelHidden: !bottomPanelHidden })}
                />
              </div>
            </div>
            {!bottomPanelHidden && (
              <div className={styles.tabContent} role="tabpanel">
                {tab === "connections" ? (
                  <ConnectionsTable model={model} filter={connectionsFilter} />
                ) : (
                  <FlowRecordsTable model={model} />
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  },
);

/** The Traffic Map page of a cluster: the network flows between its workloads. */
export const TrafficMapPage = observer(({ dependencies }: { dependencies: TrafficMapPageDependencies }) => {
  const model = useMemo(() => new TrafficMapModel(dependencies), [dependencies]);
  const { filtersHidden } = dependencies.getViewState();
  const filtersLabel = filtersHidden ? "Show filters" : "Hide filters";

  useEffect(() => model.start(), [model]);

  return (
    <TabLayout className={styles.trafficMapPage}>
      <header className={styles.header}>
        <h2 className={styles.title}>Traffic Map</h2>
        {model.sources?.active && <Toolbar model={model} />}
        <div className={styles.headerEnd}>
          {model.sources?.active && (
            <Icon
              material="tune"
              className={styles.iconButton}
              tooltip={filtersLabel}
              role="button"
              aria-label={filtersLabel}
              aria-pressed={!filtersHidden}
              onClick={() => dependencies.setViewState({ filtersHidden: !filtersHidden })}
            />
          )}
          <div className={styles.namespaceFilter}>
            <NamespaceSelectFilter id="traffic-map-namespace-filter" />
          </div>
        </div>
      </header>
      <Content dependencies={dependencies} model={model} />
    </TabLayout>
  );
});
