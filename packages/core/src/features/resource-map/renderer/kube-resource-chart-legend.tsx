/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { config } from "./helpers/config";
import styles from "./kube-resource-chart-legend.module.scss";

import type React from "react";

export interface KubeResourceChartLegendProps {
  iconSize?: number;
}

/** The icon, colour and name of every kind that the maps draw. */
export function KubeResourceChartLegend({ iconSize = 32 }: KubeResourceChartLegendProps) {
  return (
    <div className={styles.legend}>
      <p className={styles.title}>Legend:</p>
      {Object.entries(config).map(([kind, configItem]) => {
        const style = { "--color": configItem.color } as React.CSSProperties;
        return (
          <div key={kind} className={styles.resource} style={style}>
            <img className={styles.icon} src={configItem.icon} width={iconSize} height={iconSize} alt="" />
            <span className={styles.kind}>{configItem.label}</span>
          </div>
        );
      })}
    </div>
  );
}
