/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import type { PodFilesTarget } from "../common/types";

/**
 * The commands run in the container. Every path is passed as an argument of
 * its own after `--`, never inside a shell string, so a file name can neither
 * be read as an option nor run as a command. The one shell script, for
 * writing, is constant and reads the path as its positional parameter `$1`.
 */
export const podFileCommands = {
  listLong: (directory: string) => ["ls", "-la", "--color=never", "--", directory],
  /** For an `ls` that rejects `--color`, such as some BusyBox builds. */
  listShort: (directory: string) => ["ls", "-1ap", "--", directory],
  readHead: (path: string, maxBytes: number) => ["head", "-c", String(maxBytes), "--", path],
  readAll: (path: string) => ["cat", "--", path],
  write: (path: string) => ["sh", "-c", 'cat > "$1"', "sh", path],
  remove: (path: string, recursive: boolean) => ["rm", recursive ? "-rf" : "-f", "--", path],
};

export interface KubectlExecArgsOptions {
  /** Keeps the standard input of the command open (`--stdin`). */
  readonly stdin?: boolean;
}

/**
 * The arguments of a `kubectl exec` that runs `command` in the container of
 * `target`. The kubeconfig arguments are added by the caller.
 */
export function buildKubectlExecArgs(
  target: Omit<PodFilesTarget, "clusterId">,
  command: string[],
  { stdin = false }: KubectlExecArgsOptions = {},
): string[] {
  return [
    "exec",
    ...(stdin ? ["--stdin"] : []),
    "--namespace",
    target.namespace,
    target.pod,
    "--container",
    target.container,
    "--",
    ...command,
  ];
}
