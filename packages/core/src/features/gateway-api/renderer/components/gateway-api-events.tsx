/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Icon } from "@freelensapp/icon";
import { cssNames, stopPropagation } from "@freelensapp/utilities";
import { withInjectables } from "@ogre-tools/injectable-react";
import { observer } from "mobx-react";
import { useState } from "react";
import apiManagerInjectable from "../../../../common/k8s-api/api-manager/manager.injectable";
import { ReactiveDuration } from "../../../../renderer/components/duration/reactive-duration";
import eventStoreInjectable from "../../../../renderer/components/events/store.injectable";
import getDetailsUrlInjectable from "../../../../renderer/components/kube-detail-params/get-details-url.injectable";
import { KubeObjectAge } from "../../../../renderer/components/kube-object/age";
import { KubeObjectListLayout } from "../../../../renderer/components/kube-object-list-layout";
import { TabLayout } from "../../../../renderer/components/layout/tab-layout";
import { NamespaceSelectBadge } from "../../../../renderer/components/namespaces/namespace-select-badge";
import { WithTooltip } from "../../../../renderer/components/with-tooltip";
import navigateInjectable from "../../../../renderer/navigation/navigate.injectable";

import type { KubeEvent } from "@freelensapp/kube-object";

import type { ApiManager } from "../../../../common/k8s-api/api-manager";
import type { EventStore } from "../../../../renderer/components/events/store";
import type { HeaderCustomizer } from "../../../../renderer/components/item-object-list";
import type { GetDetailsUrl } from "../../../../renderer/components/kube-detail-params/get-details-url.injectable";
import type { Navigate } from "../../../../renderer/navigation/navigate.injectable";

const columnId = {
  message: "message",
  namespace: "namespace",
  object: "object",
  type: "type",
  count: "count",
  source: "source",
  age: "age",
  lastSeen: "last-seen",
} as const;

interface Sorting {
  sortBy: string;
  orderBy: "asc" | "desc";
}

/**
 * Events belonging to Gateway API resources are recognized by the API group of
 * their involved object (gateway.networking.k8s.io and the experimental
 * gateway.networking.x-k8s.io group).
 */
export function isGatewayApiEvent(event: KubeEvent): boolean {
  return event?.involvedObject?.apiVersion?.includes("gateway.networking.") ?? false;
}

const sortingCallbacks: Record<string, (event: KubeEvent) => string | number> = {
  [columnId.namespace]: (event) => event.getNs() ?? "",
  [columnId.type]: (event) => event.type ?? "",
  [columnId.object]: (event) => event.involvedObject.name,
  [columnId.count]: (event) => event.count ?? 0,
  [columnId.age]: (event) => -event.getCreationTimestamp(),
  [columnId.lastSeen]: (event) => (event.lastTimestamp ? -new Date(event.lastTimestamp).getTime() : 0),
};

export interface GatewayApiEventsProps {
  className?: string;
  compact?: boolean;
  compactLimit?: number;
}

interface Dependencies {
  eventStore: EventStore;
  apiManager: ApiManager;
  getDetailsUrl: GetDetailsUrl;
  navigate: Navigate;
}

const NonInjectedGatewayApiEvents = observer((props: GatewayApiEventsProps & Dependencies) => {
  const { compact, compactLimit, className, eventStore, apiManager, getDetailsUrl, navigate } = props;

  const [sorting, setSorting] = useState<Sorting>({ sortBy: columnId.age, orderBy: "asc" });

  const items = (() => {
    const filtered = eventStore.contextItems.filter(isGatewayApiEvent);
    const callback = sortingCallbacks[sorting.sortBy];

    if (!callback) {
      return filtered;
    }

    return [...filtered].sort((a, b) => {
      const valA = callback(a);
      const valB = callback(b);
      if (valA === valB) return 0;
      const compare = valA > valB ? 1 : -1;
      return sorting.orderBy === "asc" ? compare : -compare;
    });
  })();

  const visibleItems = compact ? items.slice(0, compactLimit) : items;

  const customizeHeader: HeaderCustomizer = ({ info, title, ...headerPlaceholders }) => {
    const allEventsAreShown = visibleItems.length === items.length;

    if (compact) {
      if (allEventsAreShown) {
        return { title };
      }

      return {
        title,
        info: (
          <span>
            {"("}
            {visibleItems.length}
            {" of "}
            {items.length}
            {")"}
          </span>
        ),
      };
    }

    return {
      info: (
        <>
          {info}
          <Icon small material="help_outline" className="help-icon" tooltip={`Limited to ${eventStore.limit}`} />
        </>
      ),
      title,
      ...headerPlaceholders,
    };
  };

  const events = (
    <KubeObjectListLayout
      isConfigurable
      tableId="gateway-api-events"
      store={eventStore}
      className={cssNames("Events", className, { compact })}
      renderHeaderTitle="Gateway API Events"
      customizeHeader={customizeHeader}
      isSelectable={false}
      getItems={() => visibleItems}
      virtual={!compact}
      tableProps={{
        sortSyncWithUrl: false,
        sortByDefault: sorting,
        onSort: (params) => setSorting(params as Sorting),
      }}
      sortingCallbacks={sortingCallbacks}
      searchFilters={[
        (event) => event.getSearchFields(),
        (event) => event.message ?? "",
        (event) => event.getSource(),
        (event) => event.involvedObject.name,
      ]}
      renderTableHeader={[
        { title: "Type", className: "type", sortBy: columnId.type, id: columnId.type },
        { title: "Message", className: "message", id: columnId.message },
        { title: "Namespace", className: "namespace", sortBy: columnId.namespace, id: columnId.namespace },
        { title: "Involved Object", className: "object", sortBy: columnId.object, id: columnId.object },
        { title: "Source", className: "source", id: columnId.source },
        { title: "Count", className: "count", sortBy: columnId.count, id: columnId.count },
        { title: "Age", className: "age", sortBy: columnId.age, id: columnId.age },
        { title: "Last Seen", className: "last-seen", sortBy: columnId.lastSeen, id: columnId.lastSeen },
      ]}
      renderTableContents={(event) => {
        const { involvedObject, type, message } = event;
        const isWarning = event.isWarning();
        const detailsUrl = getDetailsUrl(apiManager.lookupApiLink(involvedObject, event));

        return [
          <WithTooltip key="type">{type}</WithTooltip>,
          {
            className: cssNames({ warning: isWarning }),
            title: <WithTooltip>{message}</WithTooltip>,
          },
          <NamespaceSelectBadge key="namespace" namespace={event.getNs()} />,
          <a
            key="link"
            onClick={(e) => {
              stopPropagation(e);
              navigate(detailsUrl);
            }}
          >
            <WithTooltip>{`${involvedObject.kind}: ${involvedObject.name}`}</WithTooltip>
          </a>,
          <WithTooltip key="source">{event.getSource()}</WithTooltip>,
          event.count,
          <KubeObjectAge key="age" object={event} />,
          <ReactiveDuration key="last-seen" timestamp={event.lastTimestamp} />,
        ];
      }}
    />
  );

  if (compact) {
    return events;
  }

  return <TabLayout>{events}</TabLayout>;
});

export const GatewayApiEvents = withInjectables<Dependencies, GatewayApiEventsProps>(NonInjectedGatewayApiEvents, {
  getProps: (di, props) => ({
    ...props,
    eventStore: di.inject(eventStoreInjectable),
    apiManager: di.inject(apiManagerInjectable),
    getDetailsUrl: di.inject(getDetailsUrlInjectable),
    navigate: di.inject(navigateInjectable),
  }),
});
