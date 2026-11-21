/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Pod } from "@freelensapp/kube-object";
import { describe, expect, it } from "vitest";
import { podHealth, podHealthStyles } from "./config";

const ready = { type: "Ready", status: "True" };
const notReady = { type: "Ready", status: "False" };
const running = { running: { startedAt: "2026-01-01T00:00:00Z" } };

// A real pod of the model, with one container in `state`.
function modelPod(
  status: object,
  {
    state = running,
    containerReady = true,
    deleted = false,
  }: { state?: object; containerReady?: boolean; deleted?: boolean } = {},
) {
  return new Pod({
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name: "web-1",
      namespace: "shop",
      uid: "uid-1",
      resourceVersion: "1",
      selfLink: "/api/v1/namespaces/shop/pods/web-1",
      ...(deleted ? { deletionTimestamp: "2026-01-02T00:00:00Z" } : {}),
    },
    spec: { containers: [{ name: "web", image: "web" }] },
    status: {
      containerStatuses: [{ name: "web", image: "web", imageID: "", ready: containerReady, restartCount: 0, state }],
      ...status,
    },
  } as never);
}

describe("podHealth", () => {
  it("says a ready running pod is running", () => {
    expect(podHealth(modelPod({ phase: "Running", conditions: [ready] }))).toBe("running");
  });

  it("says a running pod with a crash-looping container has failed, whatever its readiness", () => {
    const crashLooping = { waiting: { reason: "CrashLoopBackOff", message: "back-off 5m0s" } };

    expect(podHealth(modelPod({ phase: "Running", conditions: [ready] }, { state: crashLooping }))).toBe("failed");
  });

  it("says a pod of phase Failed or Unknown, or an evicted one, has failed", () => {
    expect(podHealth(modelPod({ phase: "Failed" }))).toBe("failed");
    expect(podHealth(modelPod({ phase: "Unknown" }))).toBe("failed");
    expect(podHealth(modelPod({ phase: "Failed", reason: "Evicted" }))).toBe("failed");
  });

  it("says a pod of phase Pending, or a running one whose containers are not ready, is pending", () => {
    expect(podHealth(modelPod({ phase: "Pending" }, { state: { waiting: { reason: "ContainerCreating" } } }))).toBe(
      "pending",
    );
    expect(podHealth(modelPod({ phase: "Running", conditions: [notReady] }, { containerReady: false }))).toBe(
      "pending",
    );
  });

  it("says a pod of phase Succeeded, or one being deleted, is done", () => {
    expect(podHealth(modelPod({ phase: "Succeeded" }, { state: { terminated: { exitCode: 0 } } }))).toBe("done");
    expect(podHealth(modelPod({ phase: "Running", conditions: [ready] }, { deleted: true }))).toBe("done");
  });

  it("gives every health a colour and a label of the legend", () => {
    expect(Object.values(podHealthStyles).map(({ label }) => label)).toEqual([
      "Running",
      "Pending / not ready",
      "Failed",
      "Completed / terminating",
    ]);
  });
});
