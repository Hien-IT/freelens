/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { ConfigMap, Pod } from "@freelensapp/kube-object";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getDiForUnitTesting } from "../../../getDiForUnitTesting";
import subscribeStoresInjectable from "../../../kube-watch-api/subscribe-stores.injectable";
import { renderFor } from "../../test-utils/renderFor";
import { KubeEventDetails } from "../kube-event-details";
import eventStoreInjectable from "../store.injectable";

import type { KubeObject, PodContainerStatus, PodStatus } from "@freelensapp/kube-object";

import type { EventStore } from "../store";

const renderEvents = (object: KubeObject) => {
  const di = getDiForUnitTesting();

  di.override(subscribeStoresInjectable, () => () => () => {});
  di.override(eventStoreInjectable, () => ({ getEventsByObject: () => [] }) as unknown as EventStore);

  return renderFor(di)(<KubeEventDetails object={object} />);
};

const metadata = {
  name: "test-pod",
  namespace: "default",
  resourceVersion: "1",
  selfLink: "/api/v1/namespaces/default/pods/test-pod",
  uid: "pod-uid",
};

const containerStatus = (status: Partial<PodContainerStatus> & Pick<PodContainerStatus, "name">) => ({
  ready: true,
  restartCount: 0,
  image: "registry.example/app:1",
  imageID: "registry.example/app@sha256:0",
  state: { running: { startedAt: "2026-11-15T18:01:10Z" } },
  ...status,
});

const podWith = (containerStatuses: PodContainerStatus[]) =>
  new Pod({
    apiVersion: "v1",
    kind: "Pod",
    metadata,
    spec: { containers: containerStatuses.map(({ name }) => ({ name })) },
    status: { containerStatuses } as PodStatus,
  });

describe("kube-event-details", () => {
  it("points to the last termination when a pod with a restarted container has no events", () => {
    renderEvents(
      podWith([
        containerStatus({
          name: "app",
          restartCount: 3,
          lastState: {
            terminated: {
              reason: "OOMKilled",
              exitCode: 137,
              startedAt: "2026-11-15T17:00:00Z",
              finishedAt: "2026-11-15T18:01:08Z",
            },
          },
        }),
        containerStatus({ name: "sidecar" }),
      ]),
    );

    expect(screen.getByText("No events found")).toBeInTheDocument();
    expect(screen.getByText(/^Events expire, after one hour by default\./)).toHaveTextContent(
      /restarted container: app\.$/,
    );
  });

  it("says only that there are no events for a pod whose containers never restarted", () => {
    renderEvents(podWith([containerStatus({ name: "app" })]));

    expect(screen.getByText("No events found")).toBeInTheDocument();
    expect(screen.queryByText(/Events expire/)).not.toBeInTheDocument();
  });

  it("says only that there are no events for an object that is not a pod", () => {
    renderEvents(
      new ConfigMap({
        apiVersion: "v1",
        kind: "ConfigMap",
        metadata: { ...metadata, selfLink: "/api/v1/namespaces/default/configmaps/test-pod" },
      }),
    );

    expect(screen.getByText("No events found")).toBeInTheDocument();
    expect(screen.queryByText(/Events expire/)).not.toBeInTheDocument();
  });
});
