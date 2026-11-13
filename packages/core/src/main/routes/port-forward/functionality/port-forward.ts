/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { spawn } from "node:child_process";
import * as tcpPortUsed from "tcp-port-used";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

import type { Logger } from "@freelensapp/logger";

import type { WithFreelensProxyCredentialEnv } from "../../../freelens-proxy/with-freelens-proxy-credential-env.injectable";
import type { ProxyKubeconfigPaths } from "../../../kubeconfig-manager/kubeconfig-manager";
import type { GetPortFromStream } from "../../../utils/get-port-from-stream.injectable";

const internalPortRegex = /^forwarding from (?<address>.+) ->/i;

export interface PortForwardArgs {
  clusterId: string;
  kind: string;
  namespace: string;
  name: string;
  port: number;
  forwardPort: number;
  address?: string;
}

export interface PortForwardDependencies {
  readonly logger: Logger;
  /** The bundled kubectl, which port forwarding always runs. */
  getKubectlBinPath: () => Promise<string>;
  getPortFromStream: GetPortFromStream;
  withFreelensProxyCredentialEnv: WithFreelensProxyCredentialEnv;
}

export class PortForward {
  public static portForwards: PortForward[] = [];

  static getPortforward(forward: PortForwardArgs) {
    return PortForward.portForwards.find(
      (pf) =>
        pf.clusterId == forward.clusterId &&
        pf.kind == forward.kind &&
        pf.name == forward.name &&
        pf.namespace == forward.namespace &&
        pf.port == forward.port,
    );
  }

  public process?: ChildProcessWithoutNullStreams;
  public clusterId: string;
  public kind: string;
  public namespace: string;
  public name: string;
  public port: number;
  public forwardPort: number;
  public address: string;

  constructor(
    private dependencies: PortForwardDependencies,
    public proxyKubeconfig: ProxyKubeconfigPaths,
    args: PortForwardArgs,
  ) {
    this.clusterId = args.clusterId;
    this.kind = args.kind;
    this.namespace = args.namespace;
    this.name = args.name;
    this.port = args.port;
    this.forwardPort = args.forwardPort;
    this.address = args.address?.replace(/\s+/g, "") ?? "localhost";
  }

  public async start() {
    const kubectlBin = await this.dependencies.getKubectlBinPath();
    const { kubeconfigPath, cacheDirectoryPath } = this.proxyKubeconfig;
    const commandArgs = [
      "--kubeconfig",
      kubeconfigPath,
      "--cache-dir",
      cacheDirectoryPath,
      "port-forward",
      "--address",
      this.address,
      "-n",
      this.namespace,
      `${this.kind}/${this.name}`,
      `${this.forwardPort ?? ""}:${this.port}`,
    ];

    const childProcess = spawn(kubectlBin, commandArgs, {
      env: this.dependencies.withFreelensProxyCredentialEnv({ ...process.env, KUBECACHEDIR: cacheDirectoryPath }),
    });

    this.process = childProcess;
    childProcess.on("exit", () => {
      const index = PortForward.portForwards.indexOf(this);

      if (index > -1) {
        PortForward.portForwards.splice(index, 1);
      }
    });
    // A kubectl that cannot be started emits `error`, which without a
    // listener is thrown in the main process.
    childProcess.on("error", (error) => {
      this.dependencies.logger.error(`[PORT-FORWARD-ROUTE]: kubectl port-forward process failed: ${error}`);
    });

    childProcess.stderr.on("data", (data) => {
      this.dependencies.logger.debug(`[PORT-FORWARD-ROUTE]: kubectl port-forward process stderr: ${data}`);
    });

    try {
      const internalPort = await this.dependencies.getPortFromStream(childProcess.stdout, {
        lineRegex: internalPortRegex,
      });

      await tcpPortUsed.waitUntilUsedOnHost({
        host: this.address.split(",")[0],
        port: internalPort,
        retryTimeMs: 500,
        timeOutMs: 15000,
      });

      // make sure this.forwardPort is set to the actual port used (if it was 0 then an available port is found by 'kubectl port-forward')
      this.forwardPort = internalPort;
    } catch (error) {
      childProcess.kill();

      return false;
    }

    // Listed only once it forwards: a failed start leaves no entry that a
    // later request for the same port would be answered from.
    PortForward.portForwards.push(this);

    return true;
  }

  public async stop() {
    this.process?.kill();
  }
}
