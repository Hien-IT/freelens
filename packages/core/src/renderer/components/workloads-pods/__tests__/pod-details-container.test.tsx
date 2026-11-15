/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Pod } from "@freelensapp/kube-object";
import { disposer } from "@freelensapp/utilities";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getDiForUnitTesting } from "../../../getDiForUnitTesting";
import portForwardStoreInjectable from "../../../port-forward/port-forward-store/port-forward-store.injectable";
import { renderFor } from "../../test-utils/renderFor";
import { PodDetailsContainer } from "../pod-details-container";

import type { PodContainerStatus, PodSpec, PodStatus } from "@freelensapp/kube-object";

vi.mock("../pod-container-env", () => ({
  ContainerEnvironment: () => null,
}));

describe("pod-details-container", () => {
  it("renders container resize policy", () => {
    const di = getDiForUnitTesting();

    di.override(portForwardStoreInjectable, () => ({
      watch: () => disposer(),
    }));

    const render = renderFor(di);
    const pod = new Pod({
      apiVersion: "v1",
      kind: "Pod",
      metadata: {
        name: "test-pod",
        namespace: "default",
        resourceVersion: "1",
        selfLink: "/api/v1/namespaces/default/pods/test-pod",
        uid: "pod-uid",
      },
      spec: {
        containers: [
          {
            name: "main",
            resizePolicy: [
              {
                resourceName: "cpu",
                restartPolicy: "NotRequired",
              },
              {
                resourceName: "memory",
                restartPolicy: "RestartContainer",
              },
            ],
          },
        ],
      },
      status: {} as PodStatus,
    });

    render(<PodDetailsContainer pod={pod} container={pod.getContainersWithType()[0]} />);

    expect(screen.getByText("Resize Policy")).toBeInTheDocument();
    expect(screen.getByText("cpu=NotRequired")).toBeInTheDocument();
    expect(screen.getByText("memory=RestartContainer")).toBeInTheDocument();
  });

  describe("default container marker", () => {
    const renderContainer = (containerName: string) => {
      const di = getDiForUnitTesting();

      di.override(portForwardStoreInjectable, () => ({
        watch: () => disposer(),
      }));

      const render = renderFor(di);
      const pod = new Pod({
        apiVersion: "v1",
        kind: "Pod",
        metadata: {
          name: "test-pod",
          namespace: "default",
          resourceVersion: "1",
          selfLink: "/api/v1/namespaces/default/pods/test-pod",
          uid: "pod-uid",
          annotations: {
            "kubectl.kubernetes.io/default-container": "sidecar",
          },
        },
        spec: {
          containers: [{ name: "main" }, { name: "sidecar" }],
        },
        status: {} as PodStatus,
      });
      const container = pod.getContainersWithType().find(({ name }) => name === containerName);

      return render(<PodDetailsContainer pod={pod} container={container!} />);
    };

    it("marks the container named by the annotation", () => {
      const { container } = renderContainer("sidecar");

      expect(container.querySelector(".pod-container-title")).toHaveTextContent("sidecar (default)");
    });

    it("does not mark another container", () => {
      const { container } = renderContainer("main");

      expect(container.querySelector(".pod-container-title")).toHaveTextContent(/^main$/);
    });
  });

  it("links an ephemeral container to the section of its target container", () => {
    const di = getDiForUnitTesting();

    di.override(portForwardStoreInjectable, () => ({
      watch: () => disposer(),
    }));

    const render = renderFor(di);
    const pod = new Pod({
      apiVersion: "v1",
      kind: "Pod",
      metadata: {
        name: "test-pod",
        namespace: "default",
        resourceVersion: "1",
        selfLink: "/api/v1/namespaces/default/pods/test-pod",
        uid: "pod-uid",
      },
      spec: {
        containers: [{ name: "app" }],
        ephemeralContainers: [{ name: "debugger", targetContainerName: "app" }],
      },
      status: {} as PodStatus,
    });
    const [app, debuggerContainer] = pod.getAllContainersWithType();

    render(
      <>
        <PodDetailsContainer pod={pod} container={app} />
        <PodDetailsContainer pod={pod} container={debuggerContainer} />
      </>,
    );

    const href = screen.getByRole("link", { name: "app" }).getAttribute("href");

    expect(href).toBe("#pod-container-id-test-pod-app");
    expect(document.getElementById(href!.slice(1))).toHaveTextContent(/^app \(default\)$/);
  });

  describe("restarts", () => {
    const renderContainer = (spec: Partial<PodSpec>, status: Partial<PodStatus>, containerName: string) => {
      const di = getDiForUnitTesting();

      di.override(portForwardStoreInjectable, () => ({
        watch: () => disposer(),
      }));

      const render = renderFor(di);
      const pod = new Pod({
        apiVersion: "v1",
        kind: "Pod",
        metadata: {
          name: "test-pod",
          namespace: "default",
          resourceVersion: "1",
          selfLink: "/api/v1/namespaces/default/pods/test-pod",
          uid: "pod-uid",
        },
        spec: { containers: [], ...spec },
        status: status as PodStatus,
      });
      const container = pod.getAllContainersWithType().find(({ name }) => name === containerName);

      return render(<PodDetailsContainer pod={pod} container={container!} />);
    };

    const containerStatus = (status: Partial<PodContainerStatus> & Pick<PodContainerStatus, "name">) => ({
      ready: false,
      restartCount: 0,
      image: "registry.example/app:1",
      imageID: "registry.example/app@sha256:0",
      ...status,
    });

    const drawerItemValue = (container: HTMLElement, name: string) => {
      const item = [...container.querySelectorAll(".DrawerItem")].find(
        (element) => element.querySelector(".name")?.textContent === name,
      );

      return item?.querySelector(".value") ?? null;
    };

    it("shows the restart count and the last termination of a container killed by OOM", () => {
      const { container } = renderContainer(
        { containers: [{ name: "app" }] },
        {
          containerStatuses: [
            containerStatus({
              name: "app",
              ready: true,
              restartCount: 3,
              state: { running: { startedAt: "2026-11-15T18:01:10Z" } },
              lastState: {
                terminated: {
                  reason: "OOMKilled",
                  exitCode: 137,
                  startedAt: "2026-11-15T17:00:00Z",
                  finishedAt: "2026-11-15T18:01:08Z",
                },
              },
            }),
          ],
        },
        "app",
      );

      expect(drawerItemValue(container, "Status")).toHaveTextContent(/^running, restarted, ready$/);
      expect(drawerItemValue(container, "Restarts")).toHaveTextContent(/^3$/);
      expect(drawerItemValue(container, "Last Status")).toHaveTextContent("Reason: OOMKilled - exit code: 137");
      expect(drawerItemValue(container, "Last Status")).not.toHaveTextContent("Signal");
      expect(drawerItemValue(container, "Last Status")).not.toHaveTextContent("Message");
    });

    it("shows the exit code, signal and message of an init container that exited with an error", () => {
      const { container } = renderContainer(
        { initContainers: [{ name: "migrate" }], containers: [{ name: "app" }] },
        {
          initContainerStatuses: [
            containerStatus({
              name: "migrate",
              restartCount: 1,
              state: { running: { startedAt: "2026-11-15T18:01:10Z" } },
              lastState: {
                terminated: {
                  reason: "Error",
                  exitCode: 1,
                  signal: 15,
                  message: "connection refused",
                  startedAt: "2026-11-15T17:00:00Z",
                  finishedAt: "2026-11-15T18:01:08Z",
                },
              },
            }),
          ],
        },
        "migrate",
      );

      expect(drawerItemValue(container, "Status")).toHaveTextContent(/^running, init, restarted$/);
      expect(drawerItemValue(container, "Restarts")).toHaveTextContent(/^1$/);
      expect(drawerItemValue(container, "Last Status")).toHaveTextContent("Reason: Error - exit code: 1");
      expect(drawerItemValue(container, "Last Status")).toHaveTextContent("Signal: 15");
      expect(drawerItemValue(container, "Last Status")).toHaveTextContent("Message: connection refused");
    });

    it("shows the waiting reason and message of a container in CrashLoopBackOff", () => {
      const { container } = renderContainer(
        { containers: [{ name: "app" }] },
        {
          containerStatuses: [
            containerStatus({
              name: "app",
              restartCount: 7,
              state: {
                waiting: {
                  reason: "CrashLoopBackOff",
                  message: "back-off 5m0s restarting failed container=app pod=test-pod_default(pod-uid)",
                },
              },
              lastState: {
                terminated: {
                  reason: "Error",
                  exitCode: 2,
                  startedAt: "2026-11-15T17:00:00Z",
                  finishedAt: "2026-11-15T18:01:08Z",
                },
              },
            }),
          ],
        },
        "app",
      );

      expect(drawerItemValue(container, "Status")?.querySelector(".status")).toHaveTextContent(
        /^waiting, restarted - CrashLoopBackOff$/,
      );
      expect(drawerItemValue(container, "Status")).toHaveTextContent(
        "back-off 5m0s restarting failed container=app pod=test-pod_default(pod-uid)",
      );
      expect(drawerItemValue(container, "Restarts")).toHaveTextContent(/^7$/);
      expect(drawerItemValue(container, "Last Status")).toHaveTextContent("Reason: Error - exit code: 2");
    });

    it("shows neither restarts nor the last status of a container that never restarted", () => {
      const { container } = renderContainer(
        { containers: [{ name: "app" }] },
        {
          containerStatuses: [
            containerStatus({
              name: "app",
              ready: true,
              state: { running: { startedAt: "2026-11-15T18:01:10Z" } },
              lastState: {},
            }),
          ],
        },
        "app",
      );

      expect(drawerItemValue(container, "Status")).toHaveTextContent(/^running, ready$/);
      expect(drawerItemValue(container, "Restarts")).toBeNull();
      expect(drawerItemValue(container, "Last Status")).toBeNull();
    });
  });
});
