/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Button } from "@freelensapp/button";
import { Icon } from "@freelensapp/icon";
import { cssNames } from "@freelensapp/utilities";
import { observer } from "mobx-react";
import React, { useState } from "react";
import { clusterNodesName, mergeExternalPeers, nodeIdOf, volumeOf, volumeUnitTitles } from "./filters";
import { formatBytes, formatLatency, formatVolume, hasErrors, nodeColor } from "./graph";
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
      <span className={styles.detailLabel} title={label}>
        {label}
      </span>
      <span className={styles.detailValue}>{children}</span>
    </div>
  );
}

/** The title of the details, and the button that closes them. */
function DetailsHeader({ children, onClose }: { children?: React.ReactNode; onClose(): void }) {
  return (
    <div className={styles.detailsHeader}>
      <h5 className={styles.detailTitle}>{children}</h5>
      <Icon
        material="close"
        small
        className={styles.iconButton}
        tooltip="Close"
        aria-label="Close the details"
        onClick={onClose}
      />
    </div>
  );
}

const shownPeers = 15;

/** The domains and addresses outside the cluster that a node or an edge stands for. */
function ExternalPeers({ peers, title = "Outside addresses" }: { peers: readonly ExternalPeerStat[]; title?: string }) {
  const [search, setSearch] = useState("");
  const [all, setAll] = useState(false);

  if (peers.length === 0) {
    return (
      <section className={styles.detailSection}>
        <h6 className={styles.sectionTitle}>{title}</h6>
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
    <section className={styles.detailSection}>
      <h6 className={styles.sectionTitle}>
        {title} ({peers.length})
      </h6>
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
        <button type="button" className={styles.linkButton} onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${matching.length}`}
        </button>
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
    <section className={styles.detailSection}>
      <h6 className={styles.sectionTitle}>{title}</h6>
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

/** What one port of an edge carried. */
const PortDetails = observer(({ model, flow }: { model: TrafficMapModel; flow: AggregatedFlow }) => {
  const { unit } = model;
  const latency =
    flow.latencyP50Ms !== undefined
      ? `p50 ${formatLatency(flow.latencyP50Ms)} · p95 ${formatLatency(flow.latencyP95Ms)} · p99 ${formatLatency(flow.latencyP99Ms)}`
      : flow.avgLatencyMs !== undefined
        ? `avg ${formatLatency(flow.avgLatencyMs)}`
        : undefined;

  return (
    <>
      <Row label="Port">{flow.port || "—"}</Row>
      <Row label="Protocol">{[flow.l7Protocol, flow.protocol.toUpperCase()].filter(Boolean).join(" / ")}</Row>
      <Row label={volumeUnitTitles[unit].label}>{formatVolume(volumeOf(flow, unit), unit)}</Row>
      <Row label="Flows">{flow.flowCount}</Row>
      {(flow.bytesSent > 0 || flow.bytesRecv > 0) && (
        <Row label="Sent / received">
          {formatBytes(flow.bytesSent)} / {formatBytes(flow.bytesRecv)}
        </Row>
      )}
      {hasErrors(flow) && (
        <Row label="Errors (5xx)">
          {flow.errorRate !== undefined ? formatVolume(flow.errorRate, "rate") : flow.httpStatusCounts?.["5xx"]}
          {errorShare(flow) ? ` (${errorShare(flow)})` : ""}
        </Row>
      )}
      {latency && <Row label="Latency">{latency}</Row>}
      <Counts title="HTTP status" counts={flow.httpStatusCounts} />
      {flow.topHttpPaths && (
        <section className={styles.detailSection}>
          <h6 className={styles.sectionTitle}>Top paths</h6>
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
        <section className={styles.detailSection}>
          <h6 className={styles.sectionTitle}>DNS queries</h6>
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
      {flow.source.kind === "External" || flow.destination.kind === "External" ? (
        <ExternalPeers peers={flow.externalPeers ?? []} />
      ) : (
        [flow.source, flow.destination].some(
          (endpoint) => endpoint.kind === "Host" && endpoint.name === clusterNodesName,
        ) && <ExternalPeers title="Nodes" peers={flow.externalPeers ?? []} />
      )}
    </>
  );
});

/**
 * An edge: the traffic between two nodes on each of its ports. With several
 * ports, a list picks the one whose details show, the busiest first.
 */
const LinkDetails = observer(({ model, flows }: { model: TrafficMapModel; flows: readonly AggregatedFlow[] }) => {
  const { unit } = model;
  const [port, setPort] = useState<number | undefined>(undefined);
  const [first] = flows;
  const shown = flows.find((flow) => flow.port === port) ?? first;

  return (
    <>
      <DetailsHeader onClose={() => model.select(undefined)}>
        <span className={styles.linkTitle}>
          <span className={styles.detailName}>{nodeIdOf(first.source)}</span>
          <span className={styles.detailName}>
            {first.directionUnknown ? "—" : "→"} {nodeIdOf(first.destination)}
          </span>
        </span>
      </DetailsHeader>
      {first.directionUnknown && (
        <p className={styles.note}>The source could not tell which end opened the connection.</p>
      )}
      {flows.length > 1 && (
        <section className={styles.detailSection}>
          <h6 className={styles.sectionTitle}>Ports ({flows.length})</h6>
          {flows.map((flow) => (
            <button
              key={flow.port}
              type="button"
              className={cssNames(styles.portRow, { [styles.portRowActive]: flow === shown })}
              aria-pressed={flow === shown}
              onClick={() => setPort(flow.port)}
            >
              <span>
                {flow.port ? `:${flow.port}` : "unknown port"} {flow.l7Protocol ?? flow.protocol.toUpperCase()}
              </span>
              <span className={styles.detailValue}>
                {formatVolume(volumeOf(flow, unit), unit)}
                {hasErrors(flow) ? " · errors" : ""}
              </span>
            </button>
          ))}
        </section>
      )}
      <section className={styles.detailSection}>
        <PortDetails model={model} flow={shown} />
      </section>
    </>
  );
});

const NodeDetails = observer(
  ({ model, id, openObject }: { model: TrafficMapModel; id: string; openObject?(endpoint: TrafficEndpoint): void }) => {
    const { unit } = model;
    const node = model.graph.nodes.find((candidate) => candidate.id === id);

    if (!node) {
      return (
        <>
          <DetailsHeader onClose={() => model.select(undefined)} />
          <p className={styles.note}>{id} has no traffic in the current view.</p>
        </>
      );
    }

    const incoming = model.visibleFlows.filter((flow) => nodeIdOf(flow.destination) === id);
    const outgoing = model.visibleFlows.filter((flow) => nodeIdOf(flow.source) === id);
    const { endpoint } = node;
    const peers = (flows: AggregatedFlow[], side: "source" | "destination") =>
      [...flows]
        .sort((a, b) => volumeOf(b, unit) - volumeOf(a, unit))
        .map((flow) => (
          <Row key={`${nodeIdOf(flow[side])}:${flow.port}`} label={nodeIdOf(flow[side])}>
            {flow.port ? `:${flow.port} ` : ""}
            {flow.l7Protocol ?? flow.protocol} · {formatVolume(volumeOf(flow, unit), unit)}
            {hasErrors(flow) ? " · errors" : ""}
          </Row>
        ));

    return (
      <>
        <DetailsHeader onClose={() => model.select(undefined)}>
          <span className={styles.swatch} style={{ background: nodeColor(endpoint) }} />
          <span className={styles.detailName}>{endpoint.name}</span>
          <span className={styles.kindBadge}>{endpoint.workloadKind ?? endpoint.kind}</span>
          {openObject && (endpoint.kind === "Pod" || endpoint.kind === "Workload" || endpoint.kind === "Service") && (
            <Icon
              material="open_in_new"
              small
              className={styles.iconButton}
              tooltip="Open details"
              aria-label="Open details"
              onClick={() => openObject(endpoint)}
            />
          )}
        </DetailsHeader>
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
        <Row label={volumeUnitTitles[unit].label}>{formatVolume(node.volume, unit)}</Row>
        {endpoint.kind === "External" && <ExternalPeers peers={mergeExternalPeers([...incoming, ...outgoing])} />}
        {endpoint.kind === "Host" && endpoint.name === clusterNodesName && (
          <ExternalPeers title="Nodes" peers={mergeExternalPeers([...incoming, ...outgoing])} />
        )}
        {incoming.length > 0 && (
          <section className={styles.detailSection}>
            <h6 className={styles.sectionTitle}>Incoming ({incoming.length})</h6>
            {peers(incoming, "source")}
          </section>
        )}
        {outgoing.length > 0 && (
          <section className={styles.detailSection}>
            <h6 className={styles.sectionTitle}>Outgoing ({outgoing.length})</h6>
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

  const flows = model.selectedLinkFlows;

  return (
    <aside className={styles.details}>
      {selection.type === "node" ? (
        <NodeDetails model={model} id={selection.id} openObject={openObject} />
      ) : flows.length ? (
        <LinkDetails key={selection.id} model={model} flows={flows} />
      ) : (
        <>
          <DetailsHeader onClose={() => model.select(undefined)} />
          <p className={styles.note}>The connection is no longer in the view.</p>
        </>
      )}
    </aside>
  );
});
