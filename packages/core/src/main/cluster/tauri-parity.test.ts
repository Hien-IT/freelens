/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { STATUS_CODES } from "node:http";
import path from "node:path";
import { testUtils } from "@freelensapp/messaging";
import {
  AuthorizationV1Api,
  CoreV1Api,
  createConfiguration,
  ResponseContext,
  SelfDecodingBody,
  ServerConfiguration,
  wrapHttpLibrary,
} from "@kubernetes/client-node";
import { isEqual } from "es-toolkit";
import { computed, reaction, toJS } from "mobx";
import { afterEach, describe, expect, it, vi } from "vitest";
import directoryForUserDataInjectable from "../../common/app-paths/directory-for-user-data/directory-for-user-data.injectable";
import freelensProxyCertificateInjectable from "../../common/certificate/freelens-proxy-certificate.injectable";
import createAuthorizationApiInjectable from "../../common/cluster/main/create-authorization-api.injectable";
import createCoreApiInjectable from "../../common/cluster/main/create-core-api.injectable";
import { ClusterMetadataKey } from "../../common/cluster-types";
import writeJsonSyncInjectable from "../../common/fs/main/write-json-sync.injectable";
import broadcastMessageInjectable from "../../common/ipc/broadcast-message.injectable";
import {
  clusterListNamespaceForbiddenChannel,
  getConnectionUpdateChannel,
  networkOfflineChannel,
  networkOnlineChannel,
} from "../../common/ipc/cluster";
import emitClusterStateUpdateInjectable from "../../features/cluster/state-sync/main/emit-update.injectable";
import setupClusterStateBroadcastingInjectable from "../../features/cluster/state-sync/main/setup-sync.injectable";
import addClusterInjectable from "../../features/cluster/storage/common/add.injectable";
import catalogEntityRegistryInjectable from "../catalog/entity-registry.injectable";
import lensFetchInjectable from "../fetch/lens-fetch.injectable";
import freelensProxyPortInjectable from "../freelens-proxy/freelens-proxy-port.injectable";
import { getDiForUnitTesting } from "../getDiForUnitTesting";
import clusterConnectionInjectable from "./cluster-connection.injectable";
import freelensK8sProxyManagerInjectable from "./freelens-k8s-proxy-manager.injectable";
import { catalogEntityFromCluster } from "./manager";
import clusterManagerInjectable from "./manager.injectable";
import prometheusHandlerInjectable from "./prometheus-handler/prometheus-handler.injectable";

import type { EnlistMessageChannelListener } from "@freelensapp/messaging";

import type { Configuration, KubeConfig } from "@kubernetes/client-node";

// `import.meta.url` is not a file URL under jsdom; Vitest provides `__dirname`.
const fixtures = path.resolve(__dirname, "../../../../../freelens-tauri/src-tauri/tests/fixtures/cluster");
const update = process.env.UPDATE_TAURI_PARITY === "1";
const clusterId = "parity-cluster";

type Step =
  | "activate"
  | "refreshAccessibility"
  | "networkOffline"
  | "networkOnline"
  | "detectMetadata"
  | { advance: number };

interface CaseDefinition {
  cluster: {
    contextName: string;
    server: string;
    exec: boolean;
    accessibleNamespaces?: string[];
    defaultNamespace?: string;
    skipNamespaceAuthorizationCheck?: boolean;
  };
  steps: Step[];
}

interface Answer {
  status?: number;
  body?: unknown;
  fail?: "connect" | "credential" | "hang";
  reason?: string;
  delay?: number;
}

interface Rule {
  method: string;
  path: string;
  body?: unknown;
  answers: Answer[];
}

interface Reply {
  status: number;
  body?: unknown;
}

const cases = existsSync(fixtures) ? readdirSync(fixtures).filter((name) => !name.startsWith(".")) : [];

// The body of a rule matches when every key it names matches, recursively;
// any other value, an array included, matches when equal.
const isSubset = (wanted: unknown, actual: unknown): boolean =>
  wanted !== null && typeof wanted === "object" && !Array.isArray(wanted)
    ? actual !== null &&
      typeof actual === "object" &&
      Object.entries(wanted).every(([key, value]) => isSubset(value, (actual as Record<string, unknown>)[key]))
    : isEqual(wanted, actual);

const textOf = (body: unknown) => (typeof body === "string" ? body : (JSON.stringify(body) ?? ""));
const contentTypeOf = (body: unknown) => (typeof body === "string" ? "text/plain; charset=utf-8" : "application/json");
const parseBody = (body: unknown) => (typeof body === "string" ? JSON.parse(body) : undefined);

/** The API server of a case, behind freelens-k8s-proxy. */
function createApiServer(rules: Rule[]) {
  const answered = rules.map(() => 0);

  return (method: string, path: string, body: unknown, signal?: AbortSignal | null): Promise<Reply> => {
    const index = rules.findIndex(
      (rule) => rule.method === method && rule.path === path && (rule.body === undefined || isSubset(rule.body, body)),
    );

    if (index === -1) {
      return Promise.resolve({ status: 404, body: "404 page not found" });
    }

    const { answers } = rules[index];
    const answer = answers[Math.min(answered[index]++, answers.length - 1)];
    // freelens-k8s-proxy answers a cluster it cannot reach, or a credential
    // plugin that fails, with 502 and the reason as the body.
    const reply: Reply | undefined =
      answer.fail === "hang"
        ? undefined
        : answer.fail
          ? { status: 502, body: answer.reason }
          : { status: answer.status ?? 200, body: answer.body };

    if (reply && !answer.delay) {
      return Promise.resolve(reply);
    }

    return new Promise((resolve, reject) => {
      const timer = reply && setTimeout(() => resolve(reply), answer.delay);

      // As `fetch` does, an aborted request rejects with the reason of the abort.
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(signal.reason);
      });
    });
  };
}

// Advances fake time timer by timer until the promise settles, and no further.
// The fake file system answers in microtasks, so a step that has not settled
// once they are flushed waits on a timer.
async function settle(promise: Promise<unknown>) {
  let settled = false;

  promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  await vi.advanceTimersByTimeAsync(0);

  while (!settled) {
    await vi.advanceTimersToNextTimerAsync();
  }

  await promise;
}

describe("the cluster connection fixtures shared with the Tauri build", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("has cases", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases)("%s", async (name) => {
    const caseDirectory = path.join(fixtures, name);
    const definition: CaseDefinition = JSON.parse(readFileSync(path.join(caseDirectory, "case.json"), "utf-8"));
    const rules: Rule[] = JSON.parse(readFileSync(path.join(caseDirectory, "api.json"), "utf-8"));
    const expected = path.join(caseDirectory, "expected");
    const respond = createApiServer(rules);

    vi.useFakeTimers({ now: new Date("2026-01-01T00:00:00.000Z") });

    const di = getDiForUnitTesting();

    di.override(directoryForUserDataInjectable, () => "/parity-user-data");

    // Only the transport is replaced: the requests of k8sRequest...
    di.override(lensFetchInjectable, () => async (pathnameAndQuery, init = {}) => {
      const { status, body } = await respond(
        init.method ?? "GET",
        pathnameAndQuery.slice(`/${clusterId}`.length) || "/",
        parseBody(init.body),
        init.signal,
      );

      return new Response(textOf(body), {
        status,
        statusText: STATUS_CODES[status],
        headers: { "content-type": contentTypeOf(body) },
      });
    });

    // ...and those of the client-node APIs made from the proxy kubeconfig, as
    // `makeApiClient` makes them, with the HTTP library answering instead.
    const makeApiClient =
      <Api>(ApiClass: new (configuration: Configuration) => Api) =>
      (config: KubeConfig) => {
        const server = config.getCurrentCluster()?.server ?? "";
        const httpApi = wrapHttpLibrary({
          send: async (request) => {
            const { status, body } = await respond(
              request.getHttpMethod(),
              request.getUrl().slice(server.length),
              parseBody(request.getBody()),
            );

            return new ResponseContext(
              status,
              { "content-type": contentTypeOf(body) },
              new SelfDecodingBody(Promise.resolve(Buffer.from(textOf(body)))),
            );
          },
        });

        return new ApiClass(createConfiguration({ baseServer: new ServerConfiguration(server, {}), httpApi }));
      };

    di.override(createAuthorizationApiInjectable, () => makeApiClient(AuthorizationV1Api));
    di.override(createCoreApiInjectable, () => makeApiClient(CoreV1Api));
    di.override(freelensK8sProxyManagerInjectable, () => ({
      getApiTarget: async () => ({}),
      ensureFreelensK8sProxyUrl: async () => `https://127.0.0.1:9999/${clusterId}`,
      restart: async () => {},
      ensureRunning: async () => {},
      stop: () => {},
    }));
    di.override(prometheusHandlerInjectable, () => ({
      getPrometheusDetails: vi.fn(),
      setupPrometheus: vi.fn(),
    }));

    const updates: unknown[] = [];
    let forbidden = 0;

    di.override(broadcastMessageInjectable, () => async (channel, ...args) => {
      if (channel === getConnectionUpdateChannel(clusterId).id) {
        const [{ level, message }] = args;

        updates.push({ level, message });
      } else if (channel === clusterListNamespaceForbiddenChannel) {
        forbidden++;
      }
    });

    // The first state the state-sync sends is the one before the first step.
    const sentStates: unknown[] = [];

    di.override(emitClusterStateUpdateInjectable, () => ({ state }) => {
      sentStates.push(toJS(state));
    });

    const listeners = new Map<string, (message: unknown) => unknown>();

    const enlist: EnlistMessageChannelListener = (listener) => {
      listeners.set(listener.channel.id, listener.handler as (message: unknown) => unknown);

      return () => {};
    };

    di.override(testUtils.enlistMessageChannelListenerStubInjectable, () => enlist);

    // What the start of freelens-proxy sets, which the proxy kubeconfig names.
    di.inject(freelensProxyPortInjectable).set(9999);
    di.inject(freelensProxyCertificateInjectable).set({ cert: "cert", private: "private", public: "public" });

    const { contextName, server, exec, accessibleNamespaces, ...preferences } = definition.cluster;
    const kubeConfigPath = "/parity-kubeconfig.yaml";

    di.inject(writeJsonSyncInjectable)(kubeConfigPath, {
      apiVersion: "v1",
      kind: "Config",
      clusters: [{ name: "parity", cluster: { server } }],
      contexts: [{ name: contextName, context: { cluster: "parity", user: "parity" } }],
      "current-context": contextName,
      users: [
        {
          name: "parity",
          user: exec
            ? { exec: { apiVersion: "client.authentication.k8s.io/v1", command: "kubelogin", args: ["get-token"] } }
            : { token: "parity-token" },
        },
      ],
    });

    const cluster = di.inject(addClusterInjectable)({
      id: clusterId,
      contextName,
      kubeConfigPath,
      accessibleNamespaces,
      preferences,
    });
    const clusterConnection = di.inject(clusterConnectionInjectable, cluster);
    // The entity of the cluster, its phase set by the real ClusterManager.
    const entity = catalogEntityFromCluster(cluster);

    di.inject(catalogEntityRegistryInjectable).addComputedSource(
      "parity",
      computed(() => [entity]),
    );
    di.inject(clusterManagerInjectable).init();
    di.inject(setupClusterStateBroadcastingInjectable).run();

    const phases = [entity.status.phase];
    const stopPhases = reaction(
      () => entity.status.phase,
      (phase) => phases.push(phase),
    );
    const onMessage = (channelId: string) => {
      const listener = listeners.get(channelId);

      if (!listener) {
        throw new Error(`ClusterManager listens to no "${channelId}"`);
      }

      return Promise.resolve(listener(undefined));
    };

    for (const step of definition.steps) {
      if (typeof step === "object") {
        await vi.advanceTimersByTimeAsync(step.advance);
      } else if (step === "activate") {
        await settle(clusterConnection.activate());
      } else if (step === "refreshAccessibility") {
        await settle(clusterConnection.refreshAccessibilityAndMetadata());
      } else if (step === "networkOffline") {
        await settle(onMessage(networkOfflineChannel.id));
      } else if (step === "networkOnline") {
        await settle(onMessage(networkOnlineChannel.id));
      } else {
        await settle(clusterConnection.refreshMetadata());
      }
    }

    await vi.advanceTimersByTimeAsync(0);

    const metadata = toJS(cluster.metadata);

    if (metadata[ClusterMetadataKey.LAST_SEEN] !== undefined) {
      metadata[ClusterMetadataKey.LAST_SEEN] = "<now>";
    }

    const outputs: Record<string, unknown> = {
      "updates.json": updates,
      "states.json": sentStates.slice(1),
      "metadata.json": metadata,
      "phases.json": phases,
      "forbidden.json": forbidden,
    };

    stopPhases();
    clusterConnection.disconnect();

    if (update) {
      mkdirSync(expected, { recursive: true });

      for (const [file, value] of Object.entries(outputs)) {
        writeFileSync(path.join(expected, file), `${JSON.stringify(value, null, 2)}\n`);
      }

      return;
    }

    for (const [file, value] of Object.entries(outputs)) {
      expect(value, file).toEqual(JSON.parse(readFileSync(path.join(expected, file), "utf-8")));
    }
  });
});
