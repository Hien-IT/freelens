/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Pod } from "@freelensapp/kube-object";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderState } from "../pods-containers-column.injectable";

import type { PodContainerStatus, PodStatus } from "@freelensapp/kube-object";

const containerStatus = (status: Partial<PodContainerStatus>): PodContainerStatus => ({
  name: "app",
  ready: false,
  restartCount: 0,
  image: "registry.example/app:1",
  imageID: "registry.example/app@sha256:0",
  ...status,
});

const renderTooltip = (status: PodContainerStatus) => {
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
    spec: { containers: [{ name: "app" }] },
    status: { containerStatuses: [status] } as PodStatus,
  });
  const { container } = render(<div>{renderState(pod.getAllContainersWithType()[0], status, true)}</div>);

  return {
    title: container.querySelector(".title"),
    rows: Object.fromEntries(
      [...container.querySelectorAll(".name")].map((name) => [name.textContent, name.nextElementSibling?.textContent]),
    ),
  };
};

describe("pods-containers-column tooltip", () => {
  it("shows the reason and exit code of the last termination of a container killed by OOM", () => {
    const { title, rows } = renderTooltip(
      containerStatus({
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
    );

    expect(title).toHaveTextContent(/^app running, restarted, ready, default$/);
    expect(rows).toEqual({
      "Started At": "2026-11-15T18:01:10Z",
      Restarts: "3",
      "Last Termination": "OOMKilled (exit code: 137)",
    });
  });

  it("shows the exit code and signal of a container that exited with an error", () => {
    const { rows } = renderTooltip(
      containerStatus({
        ready: true,
        restartCount: 1,
        state: { running: { startedAt: "2026-11-15T18:01:10Z" } },
        lastState: {
          terminated: {
            reason: "Error",
            exitCode: 143,
            signal: 15,
            startedAt: "2026-11-15T17:00:00Z",
            finishedAt: "2026-11-15T18:01:08Z",
          },
        },
      }),
    );

    expect(rows["Last Termination"]).toBe("Error (exit code: 143, signal: 15)");
  });

  it("shows the waiting reason and the last termination of a container in CrashLoopBackOff", () => {
    const { title, rows } = renderTooltip(
      containerStatus({
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
    );

    expect(title).toHaveTextContent(/^app waiting, restarted, default$/);
    expect(rows).toEqual({
      Reason: "CrashLoopBackOff",
      Message: "back-off 5m0s restarting failed container=app pod=test-pod_default(pod-uid)",
      Restarts: "7",
      "Last Termination": "Error (exit code: 2)",
    });
  });

  it("adds nothing for a container that never restarted", () => {
    const { rows } = renderTooltip(
      containerStatus({
        ready: true,
        state: { running: { startedAt: "2026-11-15T18:01:10Z" } },
        lastState: {},
      }),
    );

    expect(rows).toEqual({ "Started At": "2026-11-15T18:01:10Z" });
  });
});
