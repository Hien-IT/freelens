/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Button } from "@freelensapp/button";
import { Icon } from "@freelensapp/icon";
import { observer } from "mobx-react";
import React, { useState } from "react";
import { mergeExternalPeers, nodeIdOf, volumeOf } from "./filters";
import { formatBytes, formatLatency, formatVolume, hasErrors } from "./graph";
import styles from "./traffic-map.module.scss";

import type { AggregatedFlow, ExternalPeerStat, TrafficEndpoint } from "../common/types";
import type { TrafficMapModel } from "./traffic-map-model";

export interface TrafficDetailsProps {
  model: TrafficMapModel;
  /** Opens the details of the Kubernetes object of an endpoint, when it has one. */
  openObject?(endpoint: TrafficEndpoint): void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.detailRow}>
      <span className={styles.detailLabel}>{label}</span>
      <span className={styles.detailValue}>{children}</span>
    </div>
  );
}

const shownPeers = 15;

/** The domains and addresses outside the cluster that a node or an edge stands for. */
function ExternalPeers({ peers }: { peers: readonly ExternalPeerStat[] }) {
  const [search, setSearch] = useState("");
  const [all, setAll] = useState(false);

  if (peers.length === 0) {
    return (
      <section>
        <h6>Outside addresses</h6>
        <p className={styles.note}>The source reports no address for this traffic.</p>
      </section>
    );
  }

  const needle = search.trim().toLowerCase();
  const matching = needle
    ? peers.filter((peer) =>
        [peer.name, ...(peer.aliases ?? []), ...peer.ips].some((value) => value.toLowerCase().includes(needle)),
      )
    : peers;
  const shown = all ? matching : matching.slice(0, shownPeers);
  const named = peers.some((peer) => peer.ips.length === 0 || peer.name !== peer.ips[0]);

  return (
    <section>
      <h6>Outside addresses ({peers.length})</h6>
      {peers.length > shownPeers && (
        <input
          className={styles.search}
          placeholder="Domain or address…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      )}
      {shown.map((peer) => (
        <div key={peer.name} className={styles.peer}>
          <div className={styles.detailRow}>
            <span className={styles.peerName} title={peer.name}>
              {peer.name}
            </span>
            <span className={styles.detailValue}>{peer.flowCount}</span>
          </div>
          {(peer.aliases?.length || (peer.ips.length > 0 && peer.ips[0] !== peer.name)) && (
            <div className={styles.note}>
              {[...(peer.aliases ?? []), ...peer.ips.filter((ip) => ip !== peer.name)].join(" · ")}
            </div>
          )}
        </div>
      ))}
      {matching.length > shownPeers && (
        <a onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${matching.length}`}</a>
      )}
      {!named && (
        <p className={styles.note}>
          Hubble names an address only when Cilium sees the DNS lookup behind it, through its DNS proxy.
        </p>
      )}
    </section>
  );
}

function Counts({ title, counts }: { title: string; counts?: Record<string, number> }) {
  const entries = Object.entries(counts ?? {}).sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) return null;

  return (
    <section>
      <h6>{title}</h6>
      {entries.map(([key, count]) => (
        <Row key={key} label={key}>
          {count}
        </Row>
      ))}
    </section>
  );
}

function errorShare(flow: AggregatedFlow): string | undefined {
  if (flow.requestRate && flow.errorRate) {
    return `${((flow.errorRate / flow.requestRate) * 100).toFixed(1)}%`;
  }

  return undefined;
}

const LinkDetails = observer(({ model, flow }: { model: TrafficMapModel; flow: AggregatedFlow }) => {
  const { rateBased } = model;
  const latency =
    flow.latencyP50Ms !== undefined
      ? `p50 ${formatLatency(flow.latencyP50Ms)} · p95 ${formatLatency(flow.latencyP95Ms)} · p99 ${formatLatency(flow.latencyP99Ms)}`
      : flow.avgLatencyMs !== undefined
        ? `avg ${formatLatency(flow.avgLatencyMs)}`
        : undefined;

  return (
    <>
      <h5 className={styles.detailTitle}>
        {nodeIdOf(flow.source)} {flow.directionUnknown ? "—" : "→"} {nodeIdOf(flow.destination)}
      </h5>
      {flow.directionUnknown && (
        <p className={styles.note}>The source could not tell which end opened the connection.</p>
      )}
      <Row label="Port">{flow.port || "—"}</Row>
      <Row label="Protocol">{[flow.l7Protocol, flow.protocol.toUpperCase()].filter(Boolean).join(" / ")}</Row>
      <Row label={rateBased ? "Request rate" : "Connections"}>{formatVolume(volumeOf(flow, rateBased), rateBased)}</Row>
      <Row label="Flows">{flow.flowCount}</Row>
      {(flow.bytesSent > 0 || flow.bytesRecv > 0) && (
        <Row label="Data">
          {formatBytes(flow.bytesSent)} sent · {formatBytes(flow.bytesRecv)} received
        </Row>
      )}
      {hasErrors(flow) && (
        <Row label="Errors (5xx)">
          {flow.errorRate !== undefined ? formatVolume(flow.errorRate, true) : flow.httpStatusCounts?.["5xx"]}
          {errorShare(flow) ? ` (${errorShare(flow)})` : ""}
        </Row>
      )}
      {latency && <Row label="Latency">{latency}</Row>}
      <Counts title="HTTP status" counts={flow.httpStatusCounts} />
      {flow.topHttpPaths && (
        <section>
          <h6>Top paths</h6>
          {flow.topHttpPaths.map((path) => (
            <Row key={`${path.method} ${path.path}`} label={`${path.method} ${path.path}`}>
              {path.count}
              {path.avgMs !== undefined ? ` · ${formatLatency(path.avgMs)}` : ""}
              {path.errorPct ? ` · ${path.errorPct.toFixed(0)}% err` : ""}
            </Row>
          ))}
        </section>
      )}
      {flow.topDnsQueries && (
        <section>
          <h6>DNS queries</h6>
          {flow.topDnsQueries.map((query) => (
            <Row key={query.query} label={query.query}>
              {query.count}
              {query.nxCount ? ` · ${query.nxCount} NXDOMAIN` : ""}
              {query.avgTtl ? ` · TTL ${query.avgTtl}s` : ""}
            </Row>
          ))}
        </section>
      )}
      {Object.keys(flow.verdictCounts ?? {}).length > 1 || flow.verdictCounts?.dropped ? (
        <Counts title="Verdicts" counts={flow.verdictCounts} />
      ) : null}
      <Counts title="Drop reasons" counts={flow.dropReasons} />
      {(flow.source.kind === "External" || flow.destination.kind === "External") && (
        <ExternalPeers peers={flow.externalPeers ?? []} />
      )}
    </>
  );
});

const NodeDetails = observer(
  ({ model, id, openObject }: { model: TrafficMapModel; id: string; openObject?(endpoint: TrafficEndpoint): void }) => {
    const { rateBased } = model;
    const node = model.graph.nodes.find((candidate) => candidate.id === id);

    if (!node) {
      return <p className={styles.note}>{id} has no traffic in the current view.</p>;
    }

    const incoming = model.visibleFlows.filter((flow) => nodeIdOf(flow.destination) === id);
    const outgoing = model.visibleFlows.filter((flow) => nodeIdOf(flow.source) === id);
    const { endpoint } = node;
    const peers = (flows: AggregatedFlow[], side: "source" | "destination") =>
      [...flows]
        .sort((a, b) => volumeOf(b, rateBased) - volumeOf(a, rateBased))
        .map((flow) => (
          <Row key={`${nodeIdOf(flow[side])}:${flow.port}`} label={nodeIdOf(flow[side])}>
            {flow.port ? `:${flow.port} ` : ""}
            {flow.l7Protocol ?? flow.protocol} · {formatVolume(volumeOf(flow, rateBased), rateBased)}
            {hasErrors(flow) ? " · errors" : ""}
          </Row>
        ));

    return (
      <>
        <h5 className={styles.detailTitle}>
          {endpoint.name}
          {openObject && (endpoint.kind === "Pod" || endpoint.kind === "Workload" || endpoint.kind === "Service") && (
            <Icon material="open_in_new" small tooltip="Open details" onClick={() => openObject(endpoint)} />
          )}
        </h5>
        <div className={styles.detailActions}>
          {model.filters.focus === id ? (
            <Button outlined label="Show everything" onClick={() => model.focus(undefined)} />
          ) : (
            <Button primary label="Focus on this" onClick={() => model.focus(id)} />
          )}
        </div>
        {endpoint.namespace && <Row label="Namespace">{endpoint.namespace}</Row>}
        <Row label="Type">{endpoint.workloadKind ?? endpoint.kind}</Row>
        {endpoint.workload && endpoint.workload !== endpoint.name && <Row label="Workload">{endpoint.workload}</Row>}
        {endpoint.ip && <Row label="IP">{endpoint.ip}</Row>}
        <Row label={rateBased ? "Request rate" : "Connections"}>{formatVolume(node.volume, rateBased)}</Row>
        {endpoint.kind === "External" && <ExternalPeers peers={mergeExternalPeers([...incoming, ...outgoing])} />}
        {incoming.length > 0 && (
          <section>
            <h6>Incoming ({incoming.length})</h6>
            {peers(incoming, "source")}
          </section>
        )}
        {outgoing.length > 0 && (
          <section>
            <h6>Outgoing ({outgoing.length})</h6>
            {peers(outgoing, "destination")}
          </section>
        )}
      </>
    );
  },
);

/** What the user selected on the graph: a node with its peers, or an edge with what it carried. */
export const TrafficDetails = observer(({ model, openObject }: TrafficDetailsProps) => {
  const { selection } = model;

  if (!selection) {
    return null;
  }

  const link = model.selectedLink;

  return (
    <aside className={styles.details}>
      <Icon material="close" small className={styles.detailsClose} onClick={() => model.select(undefined)} />
      {selection.type === "node" ? (
        <NodeDetails model={model} id={selection.id} openObject={openObject} />
      ) : link ? (
        <LinkDetails model={model} flow={link} />
      ) : (
        <p className={styles.note}>The connection is no longer in the view.</p>
      )}
    </aside>
  );
});
