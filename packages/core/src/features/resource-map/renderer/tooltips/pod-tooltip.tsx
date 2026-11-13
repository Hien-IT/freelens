/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { cssNames } from "@freelensapp/utilities";
import React from "react";
import { Badge } from "../../../../renderer/components/badge";
import { DrawerItem } from "../../../../renderer/components/drawer";
import { StatusBrick } from "../../../../renderer/components/status-brick";
import styles from "./tooltip.module.scss";

import type { Pod } from "@freelensapp/kube-object";

export interface PodTooltipProps {
  obj: Pod;
}

export class PodTooltip extends React.Component<PodTooltipProps> {
  render() {
    const obj = this.props.obj;
    return (
      <div className={styles.tooltip}>
        <div>
          <b>
            {obj.kind} - {obj.getName()}
          </b>
        </div>
        <hr />
        <DrawerItem name="Namespace">{obj.getNs()}</DrawerItem>
        <DrawerItem name="Created">{obj.getAge()} ago</DrawerItem>
        <DrawerItem name="Labels">
          {obj.getLabels().map((label) => {
            return (
              <div key={label}>
                <Badge label={label} title={label} />
              </div>
            );
          })}
        </DrawerItem>
        <DrawerItem name="Node">{obj.getNodeName()}</DrawerItem>
        <DrawerItem name="Status">
          <span className={cssNames(obj.getStatusMessage().toLowerCase(), "pod-status")}>{obj.getStatusMessage()}</span>
        </DrawerItem>
        <DrawerItem name="Containers">{this.renderContainersStatus(obj)}</DrawerItem>
      </div>
    );
  }

  renderContainersStatus(pod: Pod) {
    return pod.getContainerStatuses().map((containerStatus) => {
      const { name, state, ready } = containerStatus;

      return (
        <div key={name}>
          <StatusBrick className={cssNames(state, { ready })} /> {name}
        </div>
      );
    });
  }
}
