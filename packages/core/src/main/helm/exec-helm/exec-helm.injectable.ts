/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import execFileInjectable from "../../../common/fs/exec-file.injectable";
import withFreelensProxyCredentialEnvInjectable from "../../freelens-proxy/with-freelens-proxy-credential-env.injectable";
import helmBinaryPathInjectable from "../helm-binary-path.injectable";
import execHelmEnvInjectable from "./exec-env.injectable";
import type { ExecFileException } from "node:child_process";

import type { AsyncResult } from "@freelensapp/utilities";

import type { ProxyKubeconfigPaths } from "../../kubeconfig-manager/kubeconfig-manager";

export interface ExecHelmOptions {
  /**
   * Variables set for this call only, on top of the cluster-independent
   * environment every helm call gets.
   */
  env?: Partial<Record<string, string>>;
  /**
   * Whether this call reaches the cluster through freelens-proxy, and so needs
   * the proxy token in its environment. Set by {@link proxyKubeconfigHelmOptions}.
   */
  throughProxy?: boolean;
  /**
   * Written to the standard input of helm, for a secret that an argument
   * would show in the process list.
   */
  input?: string;
}

export type ExecHelm = (
  args: string[],
  options?: ExecHelmOptions,
) => AsyncResult<string, ExecFileException & { stderr: string }>;

/**
 * The environment a helm call against the cluster's proxy needs. Helm has no
 * flag for the cache directory, so it only gets `KUBECACHEDIR`. The call goes
 * through the proxy, so it also carries the token.
 */
export const proxyKubeconfigHelmOptions = ({ cacheDirectoryPath }: ProxyKubeconfigPaths): ExecHelmOptions => ({
  env: { KUBECACHEDIR: cacheDirectoryPath },
  throughProxy: true,
});

const execHelmInjectable = getInjectable({
  id: "exec-helm",

  instantiate: (di): ExecHelm => {
    const execFile = di.inject(execFileInjectable);
    const execHelmEnv = di.inject(execHelmEnvInjectable);
    const getHelmBinaryPath = di.inject(helmBinaryPathInjectable);
    const withFreelensProxyCredentialEnv = di.inject(withFreelensProxyCredentialEnvInjectable);

    return async (args, { env, throughProxy = false, input } = {}) => {
      const callEnv = { ...execHelmEnv.get(), ...env };

      return execFile(getHelmBinaryPath(), args, {
        maxBuffer: 32 * 1024 * 1024, // 32 MiB
        env: throughProxy ? withFreelensProxyCredentialEnv(callEnv) : callEnv,
        ...(input === undefined ? {} : { input }),
      });
    };
  },
});

export default execHelmInjectable;
