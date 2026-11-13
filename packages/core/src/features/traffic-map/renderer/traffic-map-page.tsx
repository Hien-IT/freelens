/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Icon } from "@freelensapp/icon";
import { Spinner } from "@freelensapp/spinner";
import { cssNames } from "@freelensapp/utilities";
import { observer } from "mobx-react";
import { useEffect, useMemo, useState } from "react";
import { TabLayout } from "../../../renderer/components/layout/tab-layout";
import { NamespaceSelectFilter } from "../../../renderer/components/namespaces/namespace-select-filter";
import { Select } from "../../../renderer/components/select";
import { trafficSourceTitles } from "../common/types";
import { edgeColors } from "./graph";
import { TrafficDetails } from "./traffic-details";
import { TrafficFiltersPanel } from "./traffic-filters-panel";
import { TrafficGraphView } from "./traffic-graph";
import styles from "./traffic-map.module.scss";
import { TrafficMapModel, timeWindows } from "./traffic-map-model";
import { TrafficSetup } from "./traffic-setup";
import { ConnectionsTable, FlowRecordsTable } from "./traffic-tables";

import type { TrafficEndpoint, TrafficSourceName } from "../common/types";
import type { TrafficCanvasColors } from "./traffic-graph";
import type { TrafficMapModelDependencies } from "./traffic-map-model";

export interface TrafficMapPageDependencies extends TrafficMapModelDependencies {
  /** The colours of the active theme for the canvas; read while rendering, a theme change paints it again. */
  getCanvasColors(): TrafficCanvasColors;
  openLink(url: string): void;
  copyText(text: string): void;
  openObject(endpoint: TrafficEndpoint): void;
}

function Legend() {
  const items: [string, string, string?][] = [
    ["Hot path (busiest 10%)", edgeColors.hot],
    ["HTTP / gRPC", edgeColors.http],
    ["DNS", edgeColors.dns],
    ["Errors (5xx)", edgeColors.error],
    ["TCP / other", edgeColors.tcp],
    ["Dropped", edgeColors.tcp, "dashed"],
  ];

  return (
    <div className={styles.legend}>
      {items.map(([label, color, style]) => (
        <span key={label}>
          <span
            className={cssNames(styles.legendLine, { [styles.legendDashed]: style === "dashed" })}
            style={{ borderColor: color }}
          />
          {label}
        </span>
      ))}
      <span>Arrow: who opened the connection · no arrow: unknown · thicker: more traffic</span>
    </div>
  );
}

function Updated({ at }: { at?: number }) {
  const [, setNow] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000);

    return () => clearInterval(timer);
  }, []);

  if (!at) return null;

  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));

  return <span className={styles.note}>Updated {seconds < 5 ? "just now" : `${seconds}s ago`}</span>;
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
      <Select<number, { value: number; label: string }, false>
        id="traffic-map-window"
        className={styles.select}
        options={timeWindows.map((window) => ({ value: window.seconds, label: window.label }))}
        value={model.sinceSeconds}
        onChange={(option) => option && model.setWindow(option.value)}
      />
      <Icon
        material="refresh"
        tooltip="Refresh"
        onClick={() => void model.load()}
        className={cssNames({ [styles.spinning]: model.loading })}
      />
      <label className={styles.autoRefresh}>
        <input
          type="checkbox"
          checked={model.autoRefresh}
          onChange={(event) => model.setAutoRefresh(event.target.checked)}
        />
        Every 30s
      </label>
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
    const [tab, setTab] = useState<"connections" | "flows">("connections");

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
      return <TrafficSetup model={model} openLink={dependencies.openLink} copyText={dependencies.copyText} />;
    }

    const total = model.result?.aggregated.length ?? 0;
    const shown = model.visibleFlows.length;

    return (
      <div className={styles.body}>
        <TrafficFiltersPanel model={model} />
        <div className={styles.main}>
          <Warning model={model} />
          <div className={styles.canvas}>
            {!model.result && model.loading ? (
              <div className={styles.status}>
                <Spinner />
              </div>
            ) : shown === 0 ? (
              <div className={styles.status}>
                <p>
                  {total === 0
                    ? `Observing with ${trafficSourceTitles[model.sources.active]}: no traffic in this window yet.`
                    : "All traffic is filtered out."}
                </p>
                {total > 0 && <a onClick={() => model.resetFilters()}>Show all traffic</a>}
              </div>
            ) : (
              <TrafficGraphView model={model} colors={dependencies.getCanvasColors()} />
            )}
            <TrafficDetails model={model} openObject={dependencies.openObject} />
            <div className={styles.stats}>
              {shown} of {total} connections
              {model.result?.coveredSince
                ? ` · complete from ${new Date(model.result.coveredSince).toLocaleTimeString()}`
                : ""}
            </div>
          </div>
          <Legend />
          <div className={styles.bottom}>
            <div className={styles.tabs}>
              <a
                className={cssNames({ [styles.activeTab]: tab === "connections" })}
                onClick={() => setTab("connections")}
              >
                Connections
              </a>
              <a className={cssNames({ [styles.activeTab]: tab === "flows" })} onClick={() => setTab("flows")}>
                Flows
              </a>
            </div>
            <div className={styles.tabContent}>
              {tab === "connections" ? <ConnectionsTable model={model} /> : <FlowRecordsTable model={model} />}
            </div>
          </div>
        </div>
      </div>
    );
  },
);

/** The Traffic Map page of a cluster: the network flows between its workloads. */
export const TrafficMapPage = observer(({ dependencies }: { dependencies: TrafficMapPageDependencies }) => {
  const model = useMemo(() => new TrafficMapModel(dependencies), [dependencies]);

  useEffect(() => model.start(), [model]);

  return (
    <TabLayout className={styles.trafficMapPage}>
      <header className={styles.header}>
        <h2 className={styles.title}>Traffic Map</h2>
        {model.sources?.active && <Toolbar model={model} />}
        <div className={styles.namespaceFilter}>
          <NamespaceSelectFilter id="traffic-map-namespace-filter" />
        </div>
      </header>
      <Content dependencies={dependencies} model={model} />
    </TabLayout>
  );
});
