/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import React from "react";
import { DrawerItem } from "../../../../renderer/components/drawer";
import styles from "./tooltip.module.scss";

import type { KubeObject } from "@freelensapp/kube-object";

export interface DefaultTooltipProps {
  obj: KubeObject;
}

export class DefaultTooltip extends React.Component<DefaultTooltipProps> {
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
        <DrawerItem name="Created">{obj.metadata.creationTimestamp && `${obj.getAge()} ago`}</DrawerItem>
      </div>
    );
  }
}
