/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { observer } from "mobx-react";
import { BadgeBoolean } from "../../../../../renderer/components/badge";
import { KubeObjectAge } from "../../../../../renderer/components/kube-object/age";
import { KubeObjectListLayout } from "../../../../../renderer/components/kube-object-list-layout";
import { WithTooltip } from "../../../../../renderer/components/with-tooltip";
import { isPolicyAccepted } from "../../api/k8s/types";
import { XBackendTrafficPolicy } from "../../api/x-k8s";
import { withErrorPage } from "../../components/error-page";
import { type GatewayPageProps, namespaceCell } from "../k8s/shared";
import styles from "./x-backend-traffic-policies-page-v1alpha1.module.scss";

export const XBackendTrafficPoliciesPage = observer((props: GatewayPageProps<XBackendTrafficPolicy>) =>
  withErrorPage(props, () => {
    const { store } = props;

    return (
      <KubeObjectListLayout<XBackendTrafficPolicy, any>
        tableId={`${XBackendTrafficPolicy.crd.plural}Table`}
        className={styles.page}
        store={store}
        sortingCallbacks={{
          name: (item: XBackendTrafficPolicy) => item.getName(),
          namespace: (item: XBackendTrafficPolicy) => item.getNs() ?? "",
          accepted: (item: XBackendTrafficPolicy) => String(isPolicyAccepted(item.status)),
          age: (item: XBackendTrafficPolicy) => item.getCreationTimestamp(),
        }}
        searchFilters={[(item: XBackendTrafficPolicy) => item.getSearchFields()]}
        renderHeaderTitle={XBackendTrafficPolicy.crd.title}
        renderTableHeader={[
          { title: "Name", sortBy: "name", className: styles.name },
          { title: "Namespace", sortBy: "namespace", className: styles.namespace },
          { title: "Accepted", sortBy: "accepted", className: styles.accepted },
          { title: "Age", sortBy: "age", className: styles.age },
        ]}
        renderTableContents={(item: XBackendTrafficPolicy) => [
          <WithTooltip>{item.getName()}</WithTooltip>,
          namespaceCell(item.getNs()),
          <BadgeBoolean value={isPolicyAccepted(item.status)} />,
          <KubeObjectAge object={item} key="age" />,
        ]}
      />
    );
  }),
);
