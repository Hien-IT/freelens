/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { createReactKey } from "@freelensapp/utilities";
import { DrawerItem, DrawerTitle } from "../../../../../renderer/components/drawer";
import { Table, TableCell, TableHead, TableRow } from "../../../../../renderer/components/table";
import { ReferenceLink } from "./reference-link";

import type { KubeObject } from "@freelensapp/kube-object";

import type { BackendTLSPolicyValidation, SubjectAltName } from "../../api/k8s/types";

function formatSubjectAltName(subjectAltName: SubjectAltName): string {
  const value = subjectAltName.type === "URI" ? subjectAltName.uri : subjectAltName.hostname;

  return `${subjectAltName.type}: ${value ?? "-"}`;
}

export interface BackendTLSValidationProps {
  object: KubeObject;
  validation: BackendTLSPolicyValidation | undefined;
}

// The TLS validation of a backend, as a BackendTLSPolicy and the TLS of an
// XBackend have it.
export function BackendTLSValidation({ object, validation }: BackendTLSValidationProps) {
  const caCertRefs = validation?.caCertificateRefs ?? [];
  const subjectAltNames = validation?.subjectAltNames ?? [];

  return (
    <>
      <DrawerTitle>Validation</DrawerTitle>
      <DrawerItem name="Hostname">{validation?.hostname ?? "-"}</DrawerItem>
      <DrawerItem name="Well-Known CA Certificates" hidden={!validation?.wellKnownCACertificates}>
        {validation?.wellKnownCACertificates}
      </DrawerItem>
      <DrawerItem name="Subject Alt Names" hidden={subjectAltNames.length === 0}>
        {subjectAltNames.map(formatSubjectAltName).join(", ")}
      </DrawerItem>

      <DrawerTitle>CA Cert Refs</DrawerTitle>
      {caCertRefs.length > 0 ? (
        <Table selectable tableId="backendTLSPolicyCaCertRefs" scrollable={false} sortSyncWithUrl={false}>
          <TableHead flat sticky={false}>
            <TableCell>Group</TableCell>
            <TableCell>Kind</TableCell>
            <TableCell>Name</TableCell>
          </TableHead>
          {caCertRefs.map((caCertRef) => {
            const key = createReactKey(caCertRef);

            return (
              <TableRow key={key} nowrap>
                <TableCell>{caCertRef.group || "-"}</TableCell>
                <TableCell>{caCertRef.kind}</TableCell>
                <TableCell>
                  <ReferenceLink
                    object={object}
                    group={caCertRef.group}
                    kind={caCertRef.kind}
                    name={caCertRef.name}
                    namespace={object.getNs()}
                  />
                </TableCell>
              </TableRow>
            );
          })}
        </Table>
      ) : (
        <DrawerItem name="CA Cert Refs">-</DrawerItem>
      )}
    </>
  );
}
