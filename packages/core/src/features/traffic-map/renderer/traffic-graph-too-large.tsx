/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Button } from "@freelensapp/button";
import { observer } from "mobx-react";
import { formatVolume, namespaceColor } from "./graph";
import styles from "./traffic-map.module.scss";
import { graphCeiling } from "./traffic-map-model";

import type { TrafficMapModel } from "./traffic-map-model";

const listed = 8;

/**
 * Shown in place of a graph too large to read: how large it is, and the ways
 * to narrow it — one namespace, one of the busiest workloads, or drawing it
 * anyway while it is not past the ceiling.
 */
export const TrafficGraphTooLarge = observer(({ model }: { model: TrafficMapModel }) => {
  const { graph, unit } = model;
  const namespaces = new Map<string, number>();

  for (const node of graph.nodes) {
    if (node.endpoint.namespace) {
      namespaces.set(node.endpoint.namespace, (namespaces.get(node.endpoint.namespace) ?? 0) + 1);
    }
  }

  const byNodes = [...namespaces].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, listed);
  const busiest = [...graph.nodes]
    .filter((node) => node.endpoint.kind !== "External" || node.endpoint.name !== "Internet")
    .sort((a, b) => b.volume - a.volume)
    .slice(0, listed);

  return (
    <div className={styles.tooLarge}>
      <h4>
        {model.filters.focus
          ? `${model.filters.focus} has too many connections to draw`
          : "Too much traffic to draw at once"}
      </h4>
      <p className={styles.note}>
        {graph.nodes.length} endpoints and {graph.links.length} connections. Narrow the view, or raise the minimum
        traffic in the filters; the Connections tab below lists every connection.
      </p>

      <div className={styles.tooLargeColumns}>
        {byNodes.length > 1 && (
          <section>
            <h6 className={styles.sectionTitle}>Only one namespace</h6>
            {byNodes.map(([namespace, count]) => (
              <div key={namespace} className={styles.candidate} onClick={() => model.onlyNamespace(namespace)}>
                <span className={styles.swatch} style={{ background: namespaceColor(namespace) }} />
                {namespace} <span className={styles.note}>· {count} endpoints</span>
              </div>
            ))}
          </section>
        )}
        <section>
          <h6 className={styles.sectionTitle}>Focus on a busy workload</h6>
          {busiest.map((node) => (
            <div key={node.id} className={styles.candidate} onClick={() => model.focus(node.id)}>
              {node.id} <span className={styles.note}>· {formatVolume(node.volume, unit)}</span>
            </div>
          ))}
        </section>
      </div>

      {model.graphSize <= graphCeiling ? (
        <Button outlined label="Draw anyway" onClick={() => model.setDrawAnyway(true)} />
      ) : (
        <p className={styles.note}>This is past what the map can draw at all.</p>
      )}
    </div>
  );
});
