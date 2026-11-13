/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { loggerInjectionToken } from "@freelensapp/logger";
import { getInjectable } from "@ogre-tools/injectable";
import withFreelensProxyCredentialEnvInjectable from "../../../main/freelens-proxy/with-freelens-proxy-credential-env.injectable";
import kubeconfigManagerInjectable from "../../../main/kubeconfig-manager/kubeconfig-manager.injectable";
import createKubectlInjectable from "../../../main/kubectl/create-kubectl.injectable";
import getClusterByIdInjectable from "../../cluster/storage/common/get-by-id.injectable";
import { maxEditorBytes, maxTransferBytes } from "../common/limits";
import { isAbsoluteContainerPath, normalizeDirectoryPath } from "../common/paths";
import { hasBinaryExtension, looksBinary } from "./binary-content";
import { buildKubectlExecArgs, podFileCommands } from "./kubectl-exec-commands";
import { parseLongListing, parseShortListing, sortEntries } from "./parse-ls-output";
import runKubectlInjectable from "./run-kubectl.injectable";

import type { PodFilesRequest, PodFilesResponse, PodFilesResultData } from "../common/types";
import type { RunKubectlResult } from "./run-kubectl.injectable";

export type PodFilesHandler = (request: PodFilesRequest) => Promise<PodFilesResponse>;

const listTimeoutMs = 30_000;
const transferTimeoutMs = 120_000;
/** A listing is text, but a large directory is still a lot of it. */
const maxListingBytes = 8 * 1024 * 1024;

class PodFilesError extends Error {}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function validateRequest(request: PodFilesRequest): void {
  const { clusterId, namespace, pod, container, operation } = request ?? {};

  if (![clusterId, namespace, pod, container].every(isNonEmptyString)) {
    throw new PodFilesError("The request does not name a cluster, namespace, pod and container");
  }

  if (!isAbsoluteContainerPath(operation?.path)) {
    throw new PodFilesError("The path must be absolute");
  }

  if (operation.type === "delete" && normalizeDirectoryPath(operation.path) === "/") {
    throw new PodFilesError("Refusing to delete the root directory");
  }

  if (operation.type === "write" && typeof operation.contentBase64 !== "string") {
    throw new PodFilesError("The request has no content to write");
  }
}

const podFilesHandlerInjectable = getInjectable({
  id: "pod-files-handler",

  instantiate: (di): PodFilesHandler => {
    const getClusterById = di.inject(getClusterByIdInjectable);
    const createKubectl = di.inject(createKubectlInjectable);
    const withFreelensProxyCredentialEnv = di.inject(withFreelensProxyCredentialEnvInjectable);
    const runKubectl = di.inject(runKubectlInjectable);
    const logger = di.inject(loggerInjectionToken);

    const handle = async (request: PodFilesRequest): Promise<PodFilesResultData[keyof PodFilesResultData]> => {
      validateRequest(request);

      const cluster = getClusterById(request.clusterId);

      if (!cluster?.accessible.get()) {
        throw new PodFilesError("The cluster is not connected");
      }

      const kubectlPath = await createKubectl(cluster.version.get()).getPath();
      const { kubeconfigPath, cacheDirectoryPath } = await di
        .inject(kubeconfigManagerInjectable, cluster)
        .ensurePaths();
      // `--cache-dir` as well as `KUBECACHEDIR`: the downloaded kubectl may be
      // older than the environment variable.
      const kubeconfigArgs = ["--kubeconfig", kubeconfigPath, "--cache-dir", cacheDirectoryPath];
      const env = withFreelensProxyCredentialEnv({ ...process.env, KUBECACHEDIR: cacheDirectoryPath });

      const exec = (
        command: string[],
        { input, timeoutMs = listTimeoutMs, maxOutputBytes = maxListingBytes } = {} as {
          input?: Uint8Array;
          timeoutMs?: number;
          maxOutputBytes?: number;
        },
      ): Promise<RunKubectlResult> =>
        runKubectl(
          kubectlPath,
          [...kubeconfigArgs, ...buildKubectlExecArgs(request, command, { stdin: input !== undefined })],
          { env, input, timeoutMs, maxOutputBytes },
        );

      const execOrThrow = async (...args: Parameters<typeof exec>): Promise<Buffer> => {
        const result = await exec(...args);

        if (!result.callWasSuccessful) {
          throw new PodFilesError(result.error);
        }

        return result.response;
      };

      const { operation } = request;

      switch (operation.type) {
        case "list": {
          const directory = normalizeDirectoryPath(operation.path);
          const long = await exec(podFileCommands.listLong(directory));

          if (long.callWasSuccessful) {
            return sortEntries(parseLongListing(long.response.toString("utf8"), directory));
          }

          // An `ls` without `--color` fails on the option; one that fails on
          // the directory fails here again, with the error worth showing.
          const short = await execOrThrow(podFileCommands.listShort(directory));

          return sortEntries(parseShortListing(short.toString("utf8"), directory));
        }

        case "read": {
          if (hasBinaryExtension(operation.path)) {
            return { content: "", truncated: false, isBinary: true };
          }

          // One byte more than is shown tells whether the file is longer.
          const head = await execOrThrow(podFileCommands.readHead(operation.path, maxEditorBytes + 1), {
            timeoutMs: transferTimeoutMs,
            maxOutputBytes: maxEditorBytes + 1,
          });

          if (looksBinary(head)) {
            return { content: "", truncated: false, isBinary: true };
          }

          const truncated = head.length > maxEditorBytes;

          return {
            content: new TextDecoder().decode(truncated ? head.subarray(0, maxEditorBytes) : head),
            truncated,
            isBinary: false,
          };
        }

        case "download": {
          const content = await execOrThrow(podFileCommands.readAll(operation.path), {
            timeoutMs: transferTimeoutMs,
            maxOutputBytes: maxTransferBytes,
          });

          return { contentBase64: content.toString("base64") };
        }

        case "write": {
          const content = Buffer.from(operation.contentBase64, "base64");

          if (content.length > maxTransferBytes) {
            throw new PodFilesError(`The file is larger than ${maxTransferBytes} bytes`);
          }

          await execOrThrow(podFileCommands.write(operation.path), { input: content, timeoutMs: transferTimeoutMs });

          return undefined;
        }

        case "delete": {
          await execOrThrow(podFileCommands.remove(operation.path, operation.recursive));

          return undefined;
        }

        default:
          throw new PodFilesError("Unknown file operation");
      }
    };

    return async (request) => {
      try {
        return { callWasSuccessful: true, response: await handle(request) };
      } catch (error) {
        if (!(error instanceof PodFilesError)) {
          logger.warn("[POD-FILES]: file operation failed", { error, operation: request?.operation?.type });
        }

        return { callWasSuccessful: false, error: error instanceof Error ? error.message : String(error) };
      }
    };
  },
});

export default podFilesHandlerInjectable;
