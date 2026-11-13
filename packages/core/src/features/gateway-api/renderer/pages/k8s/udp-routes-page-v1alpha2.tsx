/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { observer } from "mobx-react";
import { BadgeBoolean } from "../../../../../renderer/components/badge";
import { KubeObjectAge } from "../../../../../renderer/components/kube-object/age";
import { KubeObjectListLayout } from "../../../../../renderer/components/kube-object-list-layout";
import { WithTooltip } from "../../../../../renderer/components/with-tooltip";
import { UDPRoute } from "../../api/k8s/udp-route-v1alpha2";
import { withErrorPage } from "../../components/error-page";
import { type GatewayPageProps, namespaceCell } from "./shared";
import styles from "./udp-routes-page-v1alpha2.module.scss";

function isAccepted(item: UDPRoute): boolean {
  return (
    item.status?.parents?.some((parent) =>
      parent.conditions.some((condition) => condition.type === "Accepted" && condition.status === "True"),
    ) ?? false
  );
}

export const UDPRoutesPage = observer((props: GatewayPageProps<UDPRoute>) =>
  withErrorPage(props, () => {
    const { store } = props;

    return (
      <KubeObjectListLayout<UDPRoute, any>
        tableId={`${UDPRoute.crd.plural}Table`}
        className={styles.page}
        store={store}
        sortingCallbacks={{
          name: (item: UDPRoute) => item.getName(),
          namespace: (item: UDPRoute) => item.getNs() ?? "",
          accepted: (item: UDPRoute) => String(isAccepted(item)),
          age: (item: UDPRoute) => item.getCreationTimestamp(),
        }}
        searchFilters={[(item: UDPRoute) => item.getSearchFields()]}
        renderHeaderTitle={UDPRoute.crd.title}
        renderTableHeader={[
          { title: "Name", sortBy: "name", className: styles.name },
          { title: "Namespace", sortBy: "namespace", className: styles.namespace },
          { title: "Accepted", sortBy: "accepted", className: styles.accepted },
          { title: "Age", sortBy: "age", className: styles.age },
        ]}
        renderTableContents={(item: UDPRoute) => [
          <WithTooltip>{item.getName()}</WithTooltip>,
          namespaceCell(item.getNs()),
          <BadgeBoolean value={isAccepted(item)} />,
          <KubeObjectAge object={item} key="age" />,
        ]}
      />
    );
  }),
);
