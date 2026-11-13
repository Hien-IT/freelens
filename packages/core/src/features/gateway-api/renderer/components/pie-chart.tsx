/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { withInjectables } from "@ogre-tools/injectable-react";
import { observer } from "mobx-react";
import { PieChart as HostPieChart } from "../../../../renderer/components/chart";
import activeThemeInjectable from "../../../../renderer/themes/active.injectable";
import { getStatusCategory } from "../api/k8s/statuses";
import styles from "./pie-chart.module.scss";

import type { KubeObject } from "@freelensapp/kube-object";

import type { IComputedValue } from "mobx";

import type { PieChartData } from "../../../../renderer/components/chart";
import type { LensTheme } from "../../../../renderer/themes/lens-theme";

const getStats = (objects: KubeObject[]): [number, number, number, number] => {
  let ready = 0;
  let notReady = 0;
  let inProgress = 0;
  let unknown = 0;

  for (const object of objects) {
    switch (getStatusCategory(object)) {
      case "Ready":
        ready++;
        break;
      case "NotReady":
        notReady++;
        break;
      case "InProgress":
        inProgress++;
        break;
      default:
        unknown++;
        break;
    }
  }

  return [ready, notReady, inProgress, unknown];
};

export interface PieChartProps {
  objects: KubeObject[];
  title: string;
  onTitleClick: () => void;
}

interface Dependencies {
  activeTheme: IComputedValue<LensTheme>;
}

const NonInjectedPieChart = observer(({ objects, title, onTitleClick, activeTheme }: PieChartProps & Dependencies) => {
  const [ready, notReady, inProgress, unknown] = getStats(objects);
  const { colors } = activeTheme.get();

  const chartData: PieChartData = {
    datasets: [
      {
        data: [ready, notReady, inProgress, unknown],
        backgroundColor: [colors.colorOk, colors.colorError, colors.colorWarning, colors.colorVague],
        tooltipLabels: [
          (percent: string) => `Ready: ${percent}`,
          (percent: string) => `Not Ready: ${percent}`,
          (percent: string) => `In Progress: ${percent}`,
          (percent: string) => `Unknown: ${percent}`,
        ],
      },
    ],

    labels: [`Ready: ${ready}`, `Not Ready: ${notReady}`, `In Progress: ${inProgress}`, `Unknown: ${unknown}`],
  };

  return (
    <div className={styles.chart}>
      <div className={styles.title}>
        <a
          onClick={(e) => {
            e.preventDefault();
            onTitleClick();
          }}
        >
          {title} ({objects.length})
        </a>
      </div>
      <HostPieChart data={chartData} />
    </div>
  );
});

export const PieChart = withInjectables<Dependencies, PieChartProps>(NonInjectedPieChart, {
  getProps: (di, props) => ({
    ...props,
    activeTheme: di.inject(activeThemeInjectable),
  }),
});
