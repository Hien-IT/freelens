/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { observer } from "mobx-react";
import { KubeObjectAge } from "../../../../../../renderer/components/kube-object/age";
import { KubeObjectListLayout } from "../../../../../../renderer/components/kube-object-list-layout";
import { WithTooltip } from "../../../../../../renderer/components/with-tooltip";
import { ReferenceGrant } from "../../../api/k8s";
import { withErrorPage } from "../../../components/error-page";
import { type GatewayPageProps, namespaceCell } from "../shared";
import styles from "./reference-grants-page.module.scss";

export const ReferenceGrantsPage = observer((props: GatewayPageProps<ReferenceGrant>) =>
  withErrorPage(props, () => {
    const { store } = props;

    return (
      <KubeObjectListLayout<ReferenceGrant, any>
        tableId={`${ReferenceGrant.crd.plural}Table`}
        className={styles.page}
        store={store}
        sortingCallbacks={{
          name: (item: ReferenceGrant) => item.getName(),
          namespace: (item: ReferenceGrant) => item.getNs() ?? "",
          age: (item: ReferenceGrant) => item.getCreationTimestamp(),
        }}
        searchFilters={[(item: ReferenceGrant) => item.getSearchFields()]}
        renderHeaderTitle={ReferenceGrant.crd.title}
        renderTableHeader={[
          { title: "Name", sortBy: "name", className: styles.name },
          { title: "Namespace", sortBy: "namespace", className: styles.namespace },
          { title: "Age", sortBy: "age", className: styles.age },
        ]}
        renderTableContents={(item: ReferenceGrant) => [
          <WithTooltip>{item.getName()}</WithTooltip>,
          namespaceCell(item.getNs()),
          <KubeObjectAge object={item} key="age" />,
        ]}
      />
    );
  }),
);
