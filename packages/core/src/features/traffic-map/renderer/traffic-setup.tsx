/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Button } from "@freelensapp/button";
import { Icon } from "@freelensapp/icon";
import { Spinner } from "@freelensapp/spinner";
import { observer } from "mobx-react";
import { trafficSourceTitles } from "../common/types";
import styles from "./traffic-map.module.scss";

import type { ReactNode } from "react";

import type { Confirm } from "../../../renderer/components/confirm-dialog/confirm.injectable";
import type { HelmChartInfo, Recommendation } from "../common/types";
import type { TrafficMapModel } from "./traffic-map-model";

export interface TrafficSetupProps {
  model: TrafficMapModel;
  openLink(url: string): void;
  copyText(text: string): void;
  confirm: Confirm;
}

function Command({ command, copyText }: { command: string; copyText(text: string): void }) {
  return (
    <div className={styles.command}>
      <code>{command}</code>
      <Icon material="content_copy" small tooltip="Copy" onClick={() => copyText(command)} />
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.detailRow}>
      <span className={styles.detailLabel}>{label}</span>
      <span className={styles.detailValue}>{children}</span>
    </div>
  );
}

/** What installing a chart does, as the confirmation states it: only what the chart's description says. */
function InstallConfirmation({ title, chart }: { title: string; chart: HelmChartInfo }) {
  return (
    <div className={styles.confirmMessage}>
      <p>Install {title} in this cluster with Helm?</p>
      <p>
        Helm installs the chart <strong>{chart.chartName}</strong>
        {chart.version ? ` ${chart.version}` : ""} from {chart.repoUrl} as the release{" "}
        <strong>{chart.releaseName}</strong> in the namespace <strong>{chart.namespace}</strong>, which Helm creates if
        it does not exist.
      </p>
      {chart.values && (
        <>
          <p>With these values:</p>
          <pre className={styles.values}>{chart.values}</pre>
        </>
      )}
    </div>
  );
}

/** The state of an install of the recommended source: what failed, or what the page waits for. */
const InstallStatus = observer(({ model, recommended }: { model: TrafficMapModel; recommended: Recommendation }) => {
  const title = trafficSourceTitles[recommended.name];

  if (model.installError) {
    return (
      <div className={styles.warning}>
        <Icon material="warning" small />
        <span>{model.installError}</span>
      </div>
    );
  }

  if (model.installed !== recommended.name) {
    return null;
  }

  return model.waitingForSource ? (
    <div className={styles.installNote}>
      <Spinner />
      <span>{title} is installed. Waiting for it to report traffic…</span>
    </div>
  ) : (
    <p className={styles.installNote}>
      {title} is installed but has not reported traffic yet. Check again in a moment.
    </p>
  );
});

/**
 * Shown when no traffic source is available: what the detection found in
 * the cluster, and what to install for traffic visibility.
 */
export const TrafficSetup = observer(({ model, openLink, copyText, confirm }: TrafficSetupProps) => {
  const { sources } = model;

  if (!sources) {
    return null;
  }

  const { cluster, detected, recommended } = sources;
  const unusable = detected.filter((status) => status.status === "present" || status.status === "error");
  const chart = recommended?.helmChart;
  const canInstall =
    recommended &&
    chart &&
    model.installed !== recommended.name &&
    !detected.some((status) => status.name === recommended.name && status.status === "present");

  const install = async () => {
    if (!recommended?.helmChart) return;

    const confirmed = await confirm({
      labelOk: "Install",
      message: <InstallConfirmation title={trafficSourceTitles[recommended.name]} chart={recommended.helmChart} />,
    });

    if (confirmed) {
      await model.installSource(recommended.name);
    }
  };

  return (
    <div className={styles.setup}>
      <h3>Traffic visibility</h3>
      <p>
        The traffic map draws the network flows between the workloads of the cluster. It reads them from Hubble
        (Cilium), Istio, Grafana Beyla or Caretta, and none of them is available in this cluster.
      </p>

      <section className={styles.setupBox}>
        <h6 className={styles.sectionTitle}>Cluster</h6>
        <div className={styles.facts}>
          <Fact label="Platform">{cluster.platform}</Fact>
          <Fact label="CNI">{cluster.cni}</Fact>
          {cluster.cni === "cilium" && <Fact label="Hubble">{cluster.dataplaneV2 ? "enabled" : "not enabled"}</Fact>}
        </div>
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
          <h6 className={styles.sectionTitle}>Recommended: {trafficSourceTitles[recommended.name]}</h6>
          <p>{recommended.reason}</p>
          <div className={styles.actions}>
            {canInstall && (
              <Button
                primary
                label={`Install ${trafficSourceTitles[recommended.name]} with Helm`}
                waiting={model.installing}
                disabled={model.installing}
                onClick={() => void install()}
              />
            )}
            <Button outlined label="View documentation" onClick={() => openLink(recommended.docsUrl)} />
          </div>
          <InstallStatus model={model} recommended={recommended} />
          {recommended.installCommand && <Command command={recommended.installCommand} copyText={copyText} />}
          {chart && (
            <p className={styles.note}>
              Chart {chart.chartName} from {chart.repoUrl}, as release {chart.releaseName} in the namespace{" "}
              {chart.namespace}.
            </p>
          )}
          {recommended.alternativeName && recommended.alternativeDocsUrl && (
            <p className={styles.note}>
              Alternative: {trafficSourceTitles[recommended.alternativeName]}. {recommended.alternativeReason}{" "}
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => openLink(recommended.alternativeDocsUrl!)}
              >
                Learn more
              </button>
            </p>
          )}
        </section>
      ) : (
        unusable.length === 0 && <p>Install Cilium with Hubble, Istio, Grafana Beyla or Caretta.</p>
      )}

      <div className={styles.actions}>
        <Button
          primary
          label="Check again"
          waiting={model.detecting}
          disabled={model.installing}
          onClick={() => void model.detect(true)}
        />
      </div>
    </div>
  );
});
