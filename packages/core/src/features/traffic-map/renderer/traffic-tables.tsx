/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { cssNames } from "@freelensapp/utilities";
import { observer } from "mobx-react";
import React, { useState } from "react";
import { nodeIdOf, volumeOf } from "./filters";
import { formatBytes, formatLatency, formatVolume, hasErrors, isDropped, linkIdOf } from "./graph";
import styles from "./traffic-map.module.scss";

import type { TrafficFlow } from "../common/types";
import type { TrafficMapModel } from "./traffic-map-model";

const maxRows = 500;

/** The edges of the view, problems first and then the busiest. */
export const ConnectionsTable = observer(({ model }: { model: TrafficMapModel }) => {
  const { rateBased } = model;
  const rows = [...model.visibleFlows]
    .sort(
      (a, b) =>
        Number(hasErrors(b) || isDropped(b)) - Number(hasErrors(a) || isDropped(a)) ||
        volumeOf(b, rateBased) - volumeOf(a, rateBased),
    )
    .slice(0, maxRows);
  const selected = model.selection?.type === "link" ? model.selection.id : undefined;

  if (rows.length === 0) {
    return <p className={styles.note}>No connections in the current view.</p>;
  }

  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>Source</th>
          <th />
          <th>Destination</th>
          <th>Port</th>
          <th>Protocol</th>
          <th>{rateBased ? "Req/s" : "Connections"}</th>
          <th>Errors</th>
          <th>Dropped</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((flow) => {
          const id = linkIdOf(flow);

          return (
            <tr
              key={id}
              className={cssNames({ [styles.selectedRow]: id === selected })}
              onClick={() => model.select({ type: "link", id })}
            >
              <td>{nodeIdOf(flow.source)}</td>
              <td>{flow.directionUnknown ? "—" : "→"}</td>
              <td>{nodeIdOf(flow.destination)}</td>
              <td>{flow.port || "—"}</td>
              <td>{flow.l7Protocol ?? flow.protocol.toUpperCase()}</td>
              <td>{formatVolume(volumeOf(flow, rateBased), rateBased)}</td>
              <td className={cssNames({ [styles.bad]: hasErrors(flow) })}>
                {flow.errorRate ? formatVolume(flow.errorRate, true) : (flow.httpStatusCounts?.["5xx"] ?? "")}
              </td>
              <td className={cssNames({ [styles.bad]: isDropped(flow) })}>{flow.verdictCounts?.dropped ?? ""}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
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
        <dt>Data</dt>
        <dd>
          {formatBytes(flow.bytesSent)} sent · {formatBytes(flow.bytesRecv)} received
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
                <tr onClick={() => setExpanded(expanded === index ? undefined : index)}>
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
