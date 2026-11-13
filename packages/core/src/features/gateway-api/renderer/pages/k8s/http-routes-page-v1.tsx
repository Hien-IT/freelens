/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { withInjectables } from "@ogre-tools/injectable-react";
import { observer } from "mobx-react";
import apiManagerInjectable from "../../../../../common/k8s-api/api-manager/manager.injectable";
import { BadgeBoolean } from "../../../../../renderer/components/badge";
import { KubeObjectAge } from "../../../../../renderer/components/kube-object/age";
import { KubeObjectListLayout } from "../../../../../renderer/components/kube-object-list-layout";
import { WithTooltip } from "../../../../../renderer/components/with-tooltip";
import { getAvailableStore } from "../../api/available-resource";
import { Gateway, HTTPRoute } from "../../api/k8s";
import { withErrorPage } from "../../components/error-page";
import { getHTTPRouteLinks, type HTTPRouteLink } from "./http-route-links";
import styles from "./http-routes-page-v1.module.scss";
import { type GatewayPageProps, namespaceCell } from "./shared";

import type { KubeObjectStore } from "../../../../../common/k8s-api/kube-object.store";
import type { GatewayApiRegistry } from "../../api/available-resource";

function isAccepted(item: HTTPRoute): boolean {
  return (
    item.status?.parents?.some((parent) =>
      parent.conditions.some((condition) => condition.type === "Accepted" && condition.status === "True"),
    ) ?? false
  );
}

// As the host renders the rules of an Ingress: the link opens in the browser
// and does not open the details of the row.
function renderLinks(links: HTTPRouteLink[]) {
  return links.map((link, index) => (
    <span key={link.text}>
      {index > 0 && ", "}
      {link.url ? (
        <a href={link.url} rel="noreferrer" target="_blank" onClick={(event) => event.stopPropagation()}>
          {link.text}
        </a>
      ) : (
        link.text
      )}
    </span>
  ));
}

interface Dependencies {
  registry: GatewayApiRegistry;
}

const NonInjectedHTTPRoutesPage = observer((props: GatewayPageProps<HTTPRoute> & Dependencies) =>
  withErrorPage(props, () => {
    const { store, registry } = props;
    // Undefined when the cluster does not serve the Gateway CRD. The routes
    // are listed without links then.
    const gatewayStore = getAvailableStore(registry, Gateway) as KubeObjectStore<Gateway> | undefined;
    const getLinkTexts = (item: HTTPRoute) => getHTTPRouteLinks(item, gatewayStore?.items).map((link) => link.text);

    return (
      <KubeObjectListLayout<HTTPRoute, any>
        tableId={`${HTTPRoute.crd.plural}Table`}
        className={styles.page}
        store={store}
        dependentStores={gatewayStore ? [gatewayStore] : []}
        sortingCallbacks={{
          name: (item: HTTPRoute) => item.getName(),
          namespace: (item: HTTPRoute) => item.getNs() ?? "",
          routes: (item: HTTPRoute) => getLinkTexts(item).join(","),
          accepted: (item: HTTPRoute) => String(isAccepted(item)),
          age: (item: HTTPRoute) => item.getCreationTimestamp(),
        }}
        searchFilters={[(item: HTTPRoute) => item.getSearchFields(), getLinkTexts]}
        renderHeaderTitle={HTTPRoute.crd.title}
        renderTableHeader={[
          { title: "Name", sortBy: "name", className: styles.name },
          { title: "Namespace", sortBy: "namespace", className: styles.namespace },
          { title: "Routes", sortBy: "routes", className: styles.routes },
          { title: "Accepted", sortBy: "accepted", className: styles.accepted },
          { title: "Age", sortBy: "age", className: styles.age },
        ]}
        renderTableContents={(item: HTTPRoute) => [
          <WithTooltip>{item.getName()}</WithTooltip>,
          namespaceCell(item.getNs()),
          <WithTooltip>{renderLinks(getHTTPRouteLinks(item, gatewayStore?.items))}</WithTooltip>,
          <BadgeBoolean value={isAccepted(item)} />,
          <KubeObjectAge object={item} key="age" />,
        ]}
      />
    );
  }),
);

export const HTTPRoutesPage = withInjectables<Dependencies, GatewayPageProps<HTTPRoute>>(NonInjectedHTTPRoutesPage, {
  getProps: (di, props) => ({
    ...props,
    registry: di.inject(apiManagerInjectable),
  }),
});
