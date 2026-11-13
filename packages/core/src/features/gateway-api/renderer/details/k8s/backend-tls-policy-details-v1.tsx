/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { createReactKey } from "@freelensapp/utilities";
import { observer } from "mobx-react";
import { BadgeBoolean } from "../../../../../renderer/components/badge";
import { DrawerItem, DrawerTitle } from "../../../../../renderer/components/drawer";
import { Table, TableCell, TableHead, TableRow } from "../../../../../renderer/components/table";
import { BackendTLSPolicy } from "../../api/k8s";
import { isPolicyAccepted } from "../../api/k8s/types";
import { BackendTLSValidation } from "./backend-tls-validation";
import styles from "./common.module.scss";
import { PolicyAncestors } from "./policy-ancestors";
import { ReferenceLink } from "./reference-link";

import type { KubeObjectDetailsProps } from "../../../../../renderer/components/kube-object-details";

export const BackendTLSPolicyDetails = observer((props: KubeObjectDetailsProps<BackendTLSPolicy>) => {
  const { object } = props;
  const targetRefs = object.spec?.targetRefs ?? [];

  return (
    <div className={styles.details}>
      <DrawerItem name="Accepted">
        <BadgeBoolean value={isPolicyAccepted(object.status)} />
      </DrawerItem>

      <DrawerTitle>Target Refs</DrawerTitle>
      {targetRefs.length > 0 ? (
        <Table selectable tableId="backendTLSPolicyTargetRefs" scrollable={false} sortSyncWithUrl={false}>
          <TableHead flat sticky={false}>
            <TableCell>Group</TableCell>
            <TableCell>Kind</TableCell>
            <TableCell>Section Name</TableCell>
            <TableCell>Name</TableCell>
          </TableHead>
          {targetRefs.map((targetRef) => {
            const key = createReactKey(targetRef);

            return (
              <TableRow key={key} nowrap>
                <TableCell>{targetRef.group || "-"}</TableCell>
                <TableCell>{targetRef.kind}</TableCell>
                <TableCell>{targetRef.sectionName ?? "-"}</TableCell>
                <TableCell>
                  <ReferenceLink
                    object={object}
                    group={targetRef.group}
                    kind={targetRef.kind}
                    name={targetRef.name}
                    namespace={object.getNs()}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </Table>
      ) : (
        <DrawerItem name="Target Refs">-</DrawerItem>
      )}

      <BackendTLSValidation object={object} validation={object.spec?.validation} />

      <PolicyAncestors object={object} ancestors={object.status?.ancestors ?? []} />
    </div>
  );
});
