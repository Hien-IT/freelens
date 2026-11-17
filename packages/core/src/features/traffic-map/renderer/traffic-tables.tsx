/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { cssNames } from "@freelensapp/utilities";
import { observer } from "mobx-react";
import React, { useEffect, useRef, useState } from "react";
import { nodeIdOf, volumeOf, volumeUnitTitles } from "./filters";
import {
  edgeColors,
  flowKeyOf,
  formatBytes,
  formatLatency,
  formatVolume,
  hasErrors,
  isDropped,
  linkIdOf,
  nodeColor,
} from "./graph";
import styles from "./traffic-map.module.scss";

import type { AggregatedFlow, TrafficEndpoint, TrafficFlow } from "../common/types";
import type { VolumeUnit } from "./filters";
import type { TrafficMapModel } from "./traffic-map-model";

const maxRows = 500;

type SortKey = "source" | "destination" | "port" | "protocol" | "volume" | "errors" | "dropped";

interface SortOrder {
  key: SortKey;
  descending: boolean;
}

function protocolOf(flow: AggregatedFlow): string {
  return flow.l7Protocol ?? flow.protocol.toUpperCase();
}

/** The errors of a connection: its error rate where the source measures rates, else how many failed. */
function errorsOf(flow: AggregatedFlow): number {
  return flow.errorRate || flow.httpStatusCounts?.["5xx"] || flow.errorCount || 0;
}

const sortValues: Record<SortKey, (flow: AggregatedFlow, unit: VolumeUnit) => string | number> = {
  source: (flow) => nodeIdOf(flow.source),
  destination: (flow) => nodeIdOf(flow.destination),
  port: (flow) => flow.port ?? 0,
  protocol: (flow) => protocolOf(flow),
  volume: (flow, unit) => volumeOf(flow, unit) ?? 0,
  errors: (flow) => errorsOf(flow),
  dropped: (flow) => flow.verdictCounts?.dropped ?? 0,
};

const numericColumns: ReadonlySet<SortKey> = new Set(["port", "volume", "errors", "dropped"]);

/** Problems first, then the busiest. */
function defaultOrder(unit: VolumeUnit) {
  return (a: AggregatedFlow, b: AggregatedFlow) =>
    Number(hasErrors(b) || isDropped(b)) - Number(hasErrors(a) || isDropped(a)) ||
    volumeOf(b, unit) - volumeOf(a, unit);
}

/** The order of a column, ties broken by the connection so that the order does not depend on the input. */
function columnOrder({ key, descending }: SortOrder, unit: VolumeUnit) {
  const valueOf = sortValues[key];
  const numberOf = (value: string | number) => (typeof value === "number" && Number.isFinite(value) ? value : 0);

  return (a: AggregatedFlow, b: AggregatedFlow) => {
    const left = valueOf(a, unit);
    const right = valueOf(b, unit);
    const order = numericColumns.has(key)
      ? numberOf(left) - numberOf(right)
      : String(left).localeCompare(String(right));

    return (descending ? -order : order) || flowKeyOf(a).localeCompare(flowKeyOf(b));
  };
}

/** A column header that sorts the table: by its column, then the other way, then back to the default order. */
function SortHeader({
  column,
  label,
  sort,
  onSort,
}: {
  column: SortKey;
  label: string;
  sort?: SortOrder;
  onSort(sort: SortOrder | undefined): void;
}) {
  const active = sort?.key === column;
  const numeric = numericColumns.has(column);
  const next = (): SortOrder | undefined => {
    if (!active) return { key: column, descending: numeric };
    if (sort.descending === numeric) return { key: column, descending: !numeric };

    return undefined;
  };

  return (
    <th
      className={cssNames({ [styles.numeric]: numeric })}
      aria-sort={active ? (sort.descending ? "descending" : "ascending") : undefined}
    >
      <button type="button" className={styles.sortButton} title={label} onClick={() => onSort(next())}>
        <span className={styles.sortLabel}>{label}</span>
        {active && <span className={styles.sortArrow}>{sort.descending ? "↓" : "↑"}</span>}
      </button>
    </th>
  );
}

/** A node in a cell: its colour, and its id with the namespace in the background. */
function EndpointCell({ endpoint }: { endpoint: TrafficEndpoint }) {
  const id = nodeIdOf(endpoint);
  const prefix = endpoint.namespace && id.startsWith(`${endpoint.namespace}/`) ? `${endpoint.namespace}/` : "";

  return (
    <td title={id}>
      <span className={styles.endpointSwatch} style={{ background: nodeColor(endpoint) }} />
      {prefix && <span className={styles.namespacePrefix}>{prefix}</span>}
      {id.slice(prefix.length)}
    </td>
  );
}

function protocolColor(protocol: string): string | undefined {
  if (protocol === "HTTP" || protocol === "gRPC") return edgeColors.http;
  if (protocol === "DNS") return edgeColors.dns;

  return undefined;
}

const Empty = () => <span className={styles.empty}>—</span>;

export interface ConnectionsTableProps {
  model: TrafficMapModel;
  /** Text that the source, the destination, the port or the protocol of a connection contains, in any case. */
  filter?: string;
}

/** The edges of the view, problems first and then the busiest, or in the order of a column. */
export const ConnectionsTable = observer(({ model, filter = "" }: ConnectionsTableProps) => {
  const { unit } = model;
  const [sort, setSort] = useState<SortOrder | undefined>(undefined);
  const selectedRow = useRef<HTMLTableRowElement>(null);
  const selected = model.selection?.type === "link" ? model.selection.id : undefined;

  useEffect(() => {
    selectedRow.current?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);

  const needle = filter.trim().toLowerCase();
  const matching = needle
    ? model.visibleFlows.filter((flow) =>
        [nodeIdOf(flow.source), nodeIdOf(flow.destination), String(flow.port), flow.l7Protocol ?? "", flow.protocol]
          .join(" ")
          .toLowerCase()
          .includes(needle),
      )
    : model.visibleFlows;
  const rows = [...matching].sort(sort ? columnOrder(sort, unit) : defaultOrder(unit)).slice(0, maxRows);
  const busiest = Math.max(0, ...rows.map((flow) => volumeOf(flow, unit)));
  const firstSelected = rows.find((flow) => linkIdOf(flow) === selected);

  if (rows.length === 0) {
    return (
      <p className={styles.note}>
        {needle ? "No connections match the filter." : "No connections in the current view."}
      </p>
    );
  }

  const header = (column: SortKey, label: string) => (
    <SortHeader column={column} label={label} sort={sort} onSort={setSort} />
  );

  return (
    <>
      <table className={cssNames(styles.table, styles.connectionsTable)}>
        <colgroup>
          <col className={styles.endpointColumn} />
          <col className={styles.arrowColumn} />
          <col className={styles.endpointColumn} />
          <col />
          <col />
          <col />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr>
            {header("source", "Source")}
            <th aria-label="Direction" />
            {header("destination", "Destination")}
            {header("port", "Port")}
            {header("protocol", "Protocol")}
            {header("volume", volumeUnitTitles[unit].column)}
            {header("errors", "Errors")}
            {header("dropped", "Dropped")}
          </tr>
        </thead>
        <tbody>
          {rows.map((flow) => {
            const id = linkIdOf(flow);
            const volume = volumeOf(flow, unit);
            const protocol = protocolOf(flow);
            const failed = flow.httpStatusCounts?.["5xx"] || flow.errorCount;
            const select = () => model.select({ type: "link", id });

            return (
              <tr
                key={flowKeyOf(flow)}
                ref={flow === firstSelected ? selectedRow : undefined}
                className={cssNames(styles.row, { [styles.selectedRow]: id === selected })}
                tabIndex={0}
                aria-selected={id === selected}
                onClick={select}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    select();
                  }
                }}
              >
                <EndpointCell endpoint={flow.source} />
                <td className={styles.arrowCell}>{flow.directionUnknown ? "—" : "→"}</td>
                <EndpointCell endpoint={flow.destination} />
                <td className={styles.numeric}>{flow.port || <Empty />}</td>
                <td>
                  <span className={styles.protocolBadge} style={{ color: protocolColor(protocol) }}>
                    {protocol}
                  </span>
                </td>
                <td className={styles.numeric}>
                  <div>{formatVolume(volume, unit)}</div>
                  <div className={styles.volumeTrack}>
                    <div
                      className={styles.volumeBar}
                      style={{ width: volume > 0 && busiest > 0 ? `max(1px, ${(volume / busiest) * 100}%)` : 0 }}
                    />
                  </div>
                </td>
                <td className={cssNames(styles.numeric, { [styles.bad]: hasErrors(flow) })}>
                  {flow.errorRate ? formatVolume(flow.errorRate, "rate") : failed || <Empty />}
                </td>
                <td className={cssNames(styles.numeric, { [styles.bad]: isDropped(flow) })}>
                  {flow.verdictCounts?.dropped || <Empty />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {matching.length > rows.length && (
        <p className={styles.note}>
          Showing the first {maxRows} of {matching.length} connections.
        </p>
      )}
    </>
  );
});

function requestOf(flow: TrafficFlow): string {
  if (flow.httpMethod) return `${flow.httpMethod} ${flow.httpPath ?? ""}`;
  if (flow.dnsQuery) return `DNS ${flow.dnsQuery}`;

  return `${flow.protocol.toUpperCase()}${flow.port ? `:${flow.port}` : ""}`;
}

function statusOf(flow: TrafficFlow): string {
  if (flow.httpStatus) return String(flow.httpStatus);
  if (flow.dnsQuery && flow.l7Type === "RESPONSE") return flow.dnsRCode === 3 ? "NXDOMAIN" : "OK";

  return "";
}

function endpointLabel(flow: TrafficFlow, side: "source" | "destination"): string {
  const endpoint = flow[side];

  if (endpoint.kind === "External" && (endpoint.names?.length || endpoint.ip)) {
    return endpoint.names?.[0] ?? endpoint.ip!;
  }

  return endpoint.namespace ? `${endpoint.namespace}/${endpoint.name}` : endpoint.name;
}

const RecordDetails = ({ flow }: { flow: TrafficFlow }) => (
  <dl className={styles.recordDetails}>
    {flow.source.ip && (
      <>
        <dt>Source IP</dt>
        <dd>{flow.source.ip}</dd>
      </>
    )}
    {flow.destination.ip && (
      <>
        <dt>Destination IP</dt>
        <dd>{flow.destination.ip}</dd>
      </>
    )}
    {flow.l7Type && (
      <>
        <dt>L7 record</dt>
        <dd>{flow.l7Type}</dd>
      </>
    )}
    {(flow.bytesSent > 0 || flow.bytesRecv > 0) && (
      <>
        <dt>Sent / received</dt>
        <dd>
          {formatBytes(flow.bytesSent)} / {formatBytes(flow.bytesRecv)}
        </dd>
      </>
    )}
    {flow.dropReason && (
      <>
        <dt>Drop reason</dt>
        <dd>{flow.dropReason}</dd>
      </>
    )}
    {flow.policyVerdict?.deniedBy && (
      <>
        <dt>Denied by</dt>
        <dd>
          {flow.policyVerdict.deniedBy
            .map((policy) => `${policy.kind} ${policy.namespace ? `${policy.namespace}/` : ""}${policy.name}`)
            .join(", ")}
        </dd>
      </>
    )}
    {flow.policyVerdict?.allowedBy && (
      <>
        <dt>Allowed by</dt>
        <dd>
          {flow.policyVerdict.allowedBy
            .map((policy) => `${policy.kind} ${policy.namespace ? `${policy.namespace}/` : ""}${policy.name}`)
            .join(", ")}
        </dd>
      </>
    )}
  </dl>
);

/** The single flows behind the selection, as the source recorded them: Hubble's flow records. */
export const FlowRecordsTable = observer(({ model }: { model: TrafficMapModel }) => {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<number | undefined>(undefined);
  const needle = search.trim().toLowerCase();
  const records = model.selectedRecords.filter(
    (flow) =>
      !needle ||
      [endpointLabel(flow, "source"), endpointLabel(flow, "destination"), requestOf(flow), flow.verdict]
        .join(" ")
        .toLowerCase()
        .includes(needle),
  );
  const total = model.result?.flowsTotal ?? 0;

  return (
    <div className={styles.records}>
      <div className={styles.recordsBar}>
        <input
          className={styles.search}
          placeholder="Search flows…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <span className={styles.note}>
          {records.length} shown
          {total > (model.result?.flows.length ?? 0)
            ? ` · the newest ${model.result?.flows.length} of ${total} flows`
            : ""}
          {model.selection ? " · for the selection" : ""}
        </span>
      </div>
      {records.length === 0 ? (
        <p className={styles.note}>No flow records. Metric-based sources (Istio, Caretta, Beyla) report rates only.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Time</th>
              <th>Source</th>
              <th>Destination</th>
              <th>Request</th>
              <th>Status</th>
              <th>Latency</th>
              <th>Verdict</th>
            </tr>
          </thead>
          <tbody>
            {records.slice(0, maxRows).map((flow, index) => (
              <React.Fragment key={index}>
                <tr className={styles.row} onClick={() => setExpanded(expanded === index ? undefined : index)}>
                  <td>{new Date(flow.lastSeen).toLocaleTimeString()}</td>
                  <td>{endpointLabel(flow, "source")}</td>
                  <td>
                    {endpointLabel(flow, "destination")}
                    {flow.directionUnknown ? " (direction unknown)" : ""}
                  </td>
                  <td className={styles.ellipsis}>{requestOf(flow)}</td>
                  <td className={cssNames({ [styles.bad]: (flow.httpStatus ?? 0) >= 500 || flow.dnsRCode === 3 })}>
                    {statusOf(flow)}
                  </td>
                  <td>{flow.latencyMs !== undefined ? formatLatency(flow.latencyMs) : ""}</td>
                  <td className={cssNames({ [styles.bad]: flow.verdict === "dropped" || flow.verdict === "error" })}>
                    {flow.verdict}
                  </td>
                </tr>
                {expanded === index && (
                  <tr>
                    <td colSpan={7}>
                      <RecordDetails flow={flow} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
});
