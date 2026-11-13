/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getBackendServiceNamePort } from "@freelensapp/kube-object";
import { cssNames } from "@freelensapp/utilities";
import React from "react";
import { DrawerItem } from "../../../../renderer/components/drawer";
import { Table, TableCell, TableRow } from "../../../../renderer/components/table";
import styles from "./tooltip.module.scss";

import type { Ingress } from "@freelensapp/kube-object";

export interface IngressTooltipProps {
  obj: Ingress;
}

export class IngressTooltip extends React.Component<IngressTooltipProps> {
  render() {
    const obj = this.props.obj;
    return (
      <div className={cssNames(styles.tooltip, styles.ingress)}>
        <div>
          <b>
            {obj.kind} - {obj.getName()}
          </b>
        </div>
        <hr />
        <DrawerItem name="Namespace">{obj.getNs()}</DrawerItem>
        {this.renderPaths(obj)}
      </div>
    );
  }

  renderPaths(ingress: Ingress) {
    const {
      spec: { rules },
    } = ingress;

    if (!rules || !rules.length) return null;

    return rules.map((rule, index) => {
      return (
        <div className={styles.rules} key={index}>
          {rule.host && <div className={styles.hostTitle}>Host: {rule.host}</div>}
          {rule.http && (
            <Table className="paths">
              {rule.http.paths.map((path, index) => {
                const backend = getBackendServiceNamePort(path.backend);

                return (
                  <TableRow key={index}>
                    <TableCell className="path">{path.path || ""}</TableCell>
                    <TableCell className="backends">
                      <p key={backend}>{backend}</p>
                    </TableCell>
                  </TableRow>
                );
              })}
            </Table>
          )}
        </div>
      );
    });
  }
}
