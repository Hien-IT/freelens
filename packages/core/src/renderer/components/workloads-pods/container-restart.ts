/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import type { ContainerStateTerminated, PodContainerStatus } from "@freelensapp/kube-object";

/**
 * The last termination of a container. The pod status keeps it until the
 * container terminates again, unlike the events that report it, which expire.
 */
export function getLastTermination(status: PodContainerStatus | undefined): ContainerStateTerminated | undefined {
  return status?.lastState?.terminated;
}

export function hasRestarted(status: PodContainerStatus | undefined): status is PodContainerStatus {
  return Boolean(status && (status.restartCount > 0 || getLastTermination(status)));
}

/**
 * The reason, exit code and signal of a termination, such as
 * `OOMKilled (exit code: 137)` or `Error (exit code: 143, signal: 15)`.
 */
export function formatTermination({ reason, exitCode, signal }: ContainerStateTerminated): string {
  const codes = signal ? `exit code: ${exitCode}, signal: ${signal}` : `exit code: ${exitCode}`;

  return reason ? `${reason} (${codes})` : codes;
}
