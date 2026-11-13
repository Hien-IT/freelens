/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import React from "react";
import { Badge } from "../../../../renderer/components/badge";
import { DrawerItem } from "../../../../renderer/components/drawer";
import styles from "./tooltip.module.scss";

import type { Service } from "@freelensapp/kube-object";

export interface ServiceTooltipProps {
  obj: Service;
}

export class ServiceTooltip extends React.Component<ServiceTooltipProps> {
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
        <DrawerItem name="Selector" labelsOnly>
          {obj.getSelector().map((selector) => {
            return (
              <div key={selector}>
                <Badge key={selector} label={selector} />
              </div>
            );
          })}
        </DrawerItem>
      </div>
    );
  }
}
