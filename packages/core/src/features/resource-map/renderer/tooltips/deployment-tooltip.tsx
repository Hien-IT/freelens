/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { cssNames } from "@freelensapp/utilities";
import React from "react";
import { Badge } from "../../../../renderer/components/badge";
import { DrawerItem } from "../../../../renderer/components/drawer";
import styles from "./tooltip.module.scss";

import type { Deployment } from "@freelensapp/kube-object";
export interface DeploymentTooltipProps {
  obj: Deployment;
}

export class DeploymentTooltip extends React.Component<DeploymentTooltipProps> {
  render() {
    const obj = this.props.obj;
    const { status, spec } = obj;
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
        <DrawerItem name="Selector" labelsOnly>
          {obj.getSelectors().map((selector) => {
            return (
              <div key={selector}>
                <Badge key={selector} label={selector} />
              </div>
            );
          })}
        </DrawerItem>
        <DrawerItem name="Replicas">
          {`${spec.replicas} desired, ${status?.updatedReplicas || 0} updated`},{" "}
          {`${status?.replicas || 0} total, ${status?.availableReplicas || 0} available`},{" "}
          {`${status?.unavailableReplicas || 0} unavailable`}
        </DrawerItem>
        <DrawerItem name="Conditions" className="conditions" labelsOnly>
          {obj.getConditions().map((condition) => {
            const { type, message, lastTransitionTime, status } = condition;

            return (
              <Badge
                key={type}
                label={type}
                className={cssNames({ disabled: status === "False" }, type.toLowerCase())}
                tooltip={
                  <>
                    <p>{message}</p>
                    <p>Last transition time: {lastTransitionTime}</p>
                  </>
                }
              />
            );
          })}
        </DrawerItem>
      </div>
    );
  }
}
