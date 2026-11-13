/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Button } from "@freelensapp/button";
import { Icon } from "@freelensapp/icon";
import { observer } from "mobx-react";
import { trafficSourceTitles } from "../common/types";
import styles from "./traffic-map.module.scss";

import type { TrafficMapModel } from "./traffic-map-model";

export interface TrafficSetupProps {
  model: TrafficMapModel;
  openLink(url: string): void;
  copyText(text: string): void;
}

function Command({ command, copyText }: { command: string; copyText(text: string): void }) {
  return (
    <div className={styles.command}>
      <code>{command}</code>
      <Icon material="content_copy" small tooltip="Copy" onClick={() => copyText(command)} />
    </div>
  );
}

/**
 * Shown when no traffic source is available: what the detection found in
 * the cluster, and what to install for traffic visibility.
 */
export const TrafficSetup = observer(({ model, openLink, copyText }: TrafficSetupProps) => {
  const { sources } = model;

  if (!sources) {
    return null;
  }

  const { cluster, detected, recommended } = sources;
  const unusable = detected.filter((status) => status.status === "present" || status.status === "error");

  return (
    <div className={styles.setup}>
      <h3>Traffic visibility</h3>
      <p>
        The traffic map draws the network flows between the workloads of the cluster. It reads them from Hubble
        (Cilium), Istio, Grafana Beyla or Caretta, and none of them is available in this cluster.
      </p>

      <section className={styles.setupBox}>
        <h6>Cluster</h6>
        <div>Platform: {cluster.platform}</div>
        <div>CNI: {cluster.cni}</div>
        {cluster.cni === "cilium" && <div>Hubble: {cluster.dataplaneV2 ? "enabled" : "not enabled"}</div>}
      </section>

      {unusable.map((status) => (
        <section key={status.name} className={styles.warning}>
          <Icon material="warning" small />
          <span>
            {trafficSourceTitles[status.name]}
            {status.version ? ` ${status.version}` : ""}{" "}
            {status.status === "error" ? "could not be detected" : "is installed but not usable"}: {status.message}
          </span>
        </section>
      ))}

      {recommended ? (
        <section className={styles.setupBox}>
          <h6>Recommended: {trafficSourceTitles[recommended.name]}</h6>
          <p>{recommended.reason}</p>
          {recommended.installCommand && <Command command={recommended.installCommand} copyText={copyText} />}
          {recommended.helmChart?.values && (
            <p className={styles.note}>
              Chart {recommended.helmChart.repo}/{recommended.helmChart.chartName} from {recommended.helmChart.repoUrl},
              also installable from the Helm Charts page.
            </p>
          )}
          <Button outlined label="View documentation" onClick={() => openLink(recommended.docsUrl)} />
          {recommended.alternativeName && recommended.alternativeDocsUrl && (
            <p className={styles.note}>
              Alternative: {trafficSourceTitles[recommended.alternativeName]}. {recommended.alternativeReason}{" "}
              <a onClick={() => openLink(recommended.alternativeDocsUrl!)}>Learn more</a>
            </p>
          )}
        </section>
      ) : (
        unusable.length === 0 && <p>Install Cilium with Hubble, Istio, Grafana Beyla or Caretta.</p>
      )}

      <Button primary label="Check again" waiting={model.detecting} onClick={() => void model.detect(true)} />
    </div>
  );
});
