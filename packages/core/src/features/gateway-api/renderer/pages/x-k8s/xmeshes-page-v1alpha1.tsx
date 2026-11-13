/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { observer } from "mobx-react";
import { BadgeBoolean } from "../../../../../renderer/components/badge";
import { KubeObjectAge } from "../../../../../renderer/components/kube-object/age";
import { KubeObjectListLayout } from "../../../../../renderer/components/kube-object-list-layout";
import { WithTooltip } from "../../../../../renderer/components/with-tooltip";
import { XMesh } from "../../api/x-k8s";
import { withErrorPage } from "../../components/error-page";
import { type GatewayPageProps } from "../k8s/shared";
import styles from "./xmeshes-page-v1alpha1.module.scss";

function getControllerName(item: XMesh): string {
  return item.spec?.controllerName ?? "";
}

function isAccepted(item: XMesh): boolean {
  return (item.status?.conditions ?? []).some(
    (condition) => condition?.type === "Accepted" && condition?.status === "True",
  );
}

export const XMeshesPage = observer((props: GatewayPageProps<XMesh>) =>
  withErrorPage(props, () => {
    const { store } = props;

    return (
      <KubeObjectListLayout<XMesh, any>
        tableId={`${XMesh.crd.plural}Table`}
        className={styles.page}
        store={store}
        sortingCallbacks={{
          name: (item: XMesh) => item.getName(),
          controller: (item: XMesh) => getControllerName(item),
          accepted: (item: XMesh) => String(isAccepted(item)),
          age: (item: XMesh) => item.getCreationTimestamp(),
        }}
        searchFilters={[(item: XMesh) => item.getSearchFields()]}
        renderHeaderTitle={XMesh.crd.title}
        renderTableHeader={[
          { title: "Name", sortBy: "name", className: styles.name },
          { title: "Controller", sortBy: "controller", className: styles.controller },
          { title: "Accepted", sortBy: "accepted", className: styles.accepted },
          { title: "Age", sortBy: "age", className: styles.age },
        ]}
        renderTableContents={(item: XMesh) => [
          <WithTooltip>{item.getName()}</WithTooltip>,
          <WithTooltip>{getControllerName(item)}</WithTooltip>,
          <BadgeBoolean value={isAccepted(item)} />,
          <KubeObjectAge object={item} key="age" />,
        ]}
      />
    );
  }),
);
