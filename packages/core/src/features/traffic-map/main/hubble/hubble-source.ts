/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import tls from "node:tls";
import { inNamespaces } from "../source";
import { convertHubbleFlow, nameExternalAddresses } from "./convert";
import { GrpcClient, GrpcError } from "./grpc";
import { decodeConnectedNodes, decodeGetFlowsResponse, encodeGetFlowsRequest, unavailableNodeStates } from "./messages";

import type { DetectionResult, FlowsResponse, TrafficFlow } from "../../common/types";
import type { ClusterAccess, KubeObjectJson, PortForwardHandle } from "../cluster-access";
import type { FlowOptions, TrafficSource } from "../source";
import type { GrpcTlsOptions } from "./grpc";
import type { FlowFilter } from "./messages";

const relayLabelSelector = "k8s-app=hubble-relay";
const relayService = "hubble-relay";
const clientCertsSecret = "hubble-relay-client-certs";
const getFlowsPath = "/observer.Observer/GetFlows";
const serverStatusPath = "/observer.Observer/ServerStatus";
const probeTimeoutMs = 5_000;
const streamTimeoutMs = 30_000;
/** The most flows read in total, so a large cluster's window fits in memory. */
const totalFlowBudget = 50_000;
/** Event types: 4 is a trace, 2 a debug event, 130 an agent event. */
const traceEvent = 4;
const ignoredEvents = [130, 2];

interface Relay {
  namespace: string;
  servicePort: number;
  tls?: GrpcTlsOptions;
}

interface Connection {
  client: GrpcClient;
  forward: PortForwardHandle;
}

function decodeBase64(value: string | undefined): string | undefined {
  return value ? Buffer.from(value, "base64").toString("utf8") : undefined;
}

/**
 * The name to verify the relay's certificate against, read from the
 * certificate it presents: a wildcard name stands for its `relay.` host.
 */
function readCertificateName(port: number, options: GrpcTlsOptions): Promise<string | undefined> {
  return new Promise((resolve) => {
    const socket = tls.connect({
      host: "127.0.0.1",
      port,
      ca: options.ca,
      cert: options.cert,
      key: options.key,
      rejectUnauthorized: false,
      ALPNProtocols: ["h2"],
    });
    const done = (name: string | undefined) => {
      socket.destroy();
      resolve(name);
    };

    socket.setTimeout(3_000, () => done(undefined));
    socket.once("error", () => done(undefined));
    socket.once("secureConnect", () => {
      const names = (socket.getPeerCertificate()?.subjectaltname ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.startsWith("DNS:"))
        .map((entry) => entry.slice(4));
      const [first] = names;

      done(first?.startsWith("*.") ? `relay.${first.slice(2)}` : first);
    });
  });
}

/** Reads the flows of Hubble Relay, the flow API of Cilium, through a port-forward to its service. */
export class HubbleSource implements TrafficSource {
  readonly name = "hubble" as const;

  private relay?: Relay;
  private connection?: Connection;
  private connecting?: Promise<Connection>;
  private nodes?: { count: number; readAt: number };

  constructor(private readonly access: ClusterAccess) {}

  async detect(): Promise<DetectionResult> {
    const pods = await this.access.list(`/api/v1/pods?labelSelector=${encodeURIComponent(relayLabelSelector)}`);

    if (pods.length === 0) {
      this.relay = undefined;

      return {
        available: false,
        message: "Hubble Relay not found. Install Cilium with Hubble enabled for traffic visibility.",
      };
    }

    const running = pods.filter((pod) => pod.status?.phase === "Running");

    if (running.length === 0) {
      return {
        available: false,
        present: true,
        message: `Hubble Relay pods found (${pods.length}) but none are running`,
      };
    }

    const namespace = running[0].metadata.namespace ?? "kube-system";
    const service = await this.access.get(`/api/v1/namespaces/${namespace}/services/${relayService}`);

    if (!service) {
      return {
        available: false,
        present: true,
        message: `Hubble Relay pods are running but the service is not found in namespace ${namespace}`,
      };
    }

    const servicePort: number = service.spec?.ports?.[0]?.port ?? 80;
    const secret = await this.access
      .get(`/api/v1/namespaces/${namespace}/secrets/${clientCertsSecret}`)
      .catch(() => undefined);
    const ca = decodeBase64(secret?.data?.["ca.crt"]);
    const cert = decodeBase64(secret?.data?.["tls.crt"]);
    const key = decodeBase64(secret?.data?.["tls.key"]);
    const tlsOptions = ca && cert && key ? { ca, cert, key } : undefined;

    if (servicePort === 443 && !tlsOptions) {
      return {
        available: false,
        present: true,
        message: `Hubble Relay requires TLS (port 443) but the client certificates are not found in the secret ${namespace}/${clientCertsSecret}`,
      };
    }

    const relay: Relay = { namespace, servicePort, tls: tlsOptions };

    if (
      this.relay?.namespace !== relay.namespace ||
      this.relay.servicePort !== relay.servicePort ||
      Boolean(this.relay.tls) !== Boolean(relay.tls)
    ) {
      this.close();
    }

    this.relay = relay;

    const [native, version] = await Promise.all([this.isNative(), this.readVersion(namespace)]);

    return {
      available: true,
      native,
      version,
      message: `Hubble Relay detected in ${namespace} with ${running.length} running pod(s) (${tlsOptions ? "TLS" : "plaintext"})`,
    };
  }

  /** Hubble built into GKE Dataplane V2. */
  private async isNative(): Promise<boolean> {
    const [node] = await this.access.list("/api/v1/nodes?limit=1").catch(() => [] as KubeObjectJson[]);

    return Boolean(
      node?.spec?.providerID?.startsWith("gce://") && node.metadata.labels?.["cloud.google.com/gke-nodepool"],
    );
  }

  private async readVersion(namespace: string): Promise<string | undefined> {
    const config = await this.access
      .get(`/api/v1/namespaces/${namespace}/configmaps/cilium-config`)
      .catch(() => undefined);

    return config?.metadata.labels?.["cilium.io/version"];
  }

  /** A client on a live port-forward, set up again when the forward has stopped. */
  private async connect(): Promise<Connection> {
    if (this.connection?.forward.isAlive()) {
      return this.connection;
    }

    this.close();
    this.connecting ??= this.openConnection().finally(() => {
      this.connecting = undefined;
    });

    return this.connecting;
  }

  private async openConnection(): Promise<Connection> {
    if (!this.relay) {
      const detection = await this.detect();

      if (!this.relay) {
        throw new Error(detection.message ?? "Hubble Relay not found");
      }
    }

    const relay = this.relay as Relay;
    const forward = await this.access.portForward(relay.namespace, relayService, relay.servicePort);

    try {
      const client = await this.openClient(relay, forward.localPort);

      this.connection = { client, forward };

      return this.connection;
    } catch (error) {
      forward.stop();
      throw error;
    }
  }

  /** Tries plaintext and TLS, in the order the service port suggests, and keeps the first that answers. */
  private async openClient(relay: Relay, port: number): Promise<GrpcClient> {
    const plaintext = () => new GrpcClient(`http://127.0.0.1:${port}`);
    const secure = (servername: string) => new GrpcClient(`https://127.0.0.1:${port}`, { ...relay.tls, servername });
    const defaultName = `${relayService}.${relay.namespace}.svc.cluster.local`;
    const attempts: (() => Promise<GrpcClient>)[] = [];

    if (relay.tls) {
      const tryTls = async () => {
        try {
          return await this.probe(secure(defaultName));
        } catch (error) {
          const name = await readCertificateName(port, relay.tls!);

          if (name && name !== defaultName) {
            return this.probe(secure(name));
          }

          throw error;
        }
      };

      attempts.push(
        ...(relay.servicePort === 443
          ? [tryTls, () => this.probe(plaintext())]
          : [() => this.probe(plaintext()), tryTls]),
      );
    } else {
      attempts.push(() => this.probe(plaintext()));
    }

    let lastError: unknown;

    for (const attempt of attempts) {
      try {
        return await attempt();
      } catch (error) {
        lastError = error;
      }
    }

    throw new Error(
      `Cannot reach Hubble Relay in ${relay.namespace}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }

  /** Calls ServerStatus, which every relay answers, and keeps the number of nodes it reads. */
  private async probe(client: GrpcClient): Promise<GrpcClient> {
    try {
      const { messages } = await client.call(serverStatusPath, new Uint8Array(0), {
        timeoutMs: probeTimeoutMs,
        maxMessages: 1,
      });

      if (messages.length === 0) {
        throw new GrpcError("Hubble Relay did not answer", 14);
      }

      this.nodes = { count: decodeConnectedNodes(messages[0]), readAt: Date.now() };

      return client;
    } catch (error) {
      client.close();
      throw error;
    }
  }

  private async connectedNodes(client: GrpcClient): Promise<number> {
    if (this.nodes && Date.now() - this.nodes.readAt < 60_000) {
      return this.nodes.count;
    }

    try {
      await this.probe(client);
    } catch {
      return 0;
    }

    return this.nodes?.count ?? 0;
  }

  async getFlows(options: FlowOptions): Promise<FlowsResponse> {
    const now = Date.now();
    const empty = (warning: string): FlowsResponse => ({
      source: this.name,
      timestamp: now,
      flows: [],
      warning,
      warningKind: "transient",
    });

    let connection: Connection;

    try {
      connection = await this.connect();
    } catch (error) {
      return empty(error instanceof Error ? error.message : String(error));
    }

    const nodes = await this.connectedNodes(connection.client);
    // Hubble Relay returns at most `number` flows of each node, the newest
    // ones: spread the budget over the nodes so a large cluster still fits.
    const number =
      nodes > 0 ? Math.min(options.limit, Math.max(Math.ceil(totalFlowBudget / nodes), 100)) : options.limit;
    const windowStart = now - options.sinceSeconds * 1000;
    const whitelist: FlowFilter[] = options.namespaces.length
      ? [
          { sourcePod: options.namespaces.map((namespace) => `${namespace}/`) },
          { destinationPod: options.namespaces.map((namespace) => `${namespace}/`) },
        ]
      : [];
    const blacklist: FlowFilter[] = [{ reply: [true], eventTypes: [traceEvent] }, { eventTypes: ignoredEvents }];
    const request = encodeGetFlowsRequest({ number, whitelist, blacklist });

    const flows: TrafficFlow[] = [];
    const perNode = new Map<string, { count: number; oldest: number }>();
    const unavailableNodes = new Set<string>();
    let lostEvents = 0;
    let streamError: string | undefined;

    try {
      await connection.client.call(getFlowsPath, request, {
        timeoutMs: streamTimeoutMs,
        onMessage: (message) => {
          const response = decodeGetFlowsResponse(message);

          switch (response.type) {
            case "flow": {
              const { flow, nodeName } = response;

              if (flow.timeMs > 0) {
                const node = perNode.get(nodeName) ?? { count: 0, oldest: flow.timeMs };

                node.count++;
                node.oldest = Math.min(node.oldest, flow.timeMs);
                perNode.set(nodeName, node);

                if (flow.timeMs < windowStart) {
                  return true;
                }
              }

              const converted = convertHubbleFlow(flow, now);

              if (converted && inNamespaces(converted, options.namespaces)) {
                flows.push(converted);
              }

              return flows.length < totalFlowBudget;
            }
            case "node-status":
              if (unavailableNodeStates.has(response.state)) {
                response.nodeNames.forEach((name) => unavailableNodes.add(name));
              }

              return true;
            case "lost-events":
              lostEvents += response.count;

              return true;
            default:
              return true;
          }
        },
      });
    } catch (error) {
      streamError = error instanceof Error ? error.message : String(error);

      if (error instanceof GrpcError && error.code === 14) {
        // The forward or the relay went away: connect afresh next time.
        this.close();
      }
    }

    nameExternalAddresses(flows);

    let coveredSince: number | undefined;

    for (const node of perNode.values()) {
      if (node.count >= number && node.oldest > windowStart) {
        coveredSince = Math.max(coveredSince ?? 0, node.oldest);
      }
    }

    const gaps: string[] = [];

    if (streamError) {
      gaps.push(
        flows.length
          ? `the stream from Hubble Relay ended early (${streamError}), so flows after the first ${flows.length} are missing`
          : `the stream from Hubble Relay failed (${streamError}) before delivering any flows`,
      );
    }

    if (lostEvents > 0 && lostEvents * 100 >= lostEvents + flows.length) {
      gaps.push(`Hubble reported ${lostEvents} events lost before they could be delivered`);
    }

    if (unavailableNodes.size > 0) {
      gaps.push(`Hubble Relay could not read flows from ${unavailableNodes.size} node(s), so their traffic is missing`);
    }

    return {
      source: this.name,
      timestamp: now,
      flows,
      coveredSince,
      ...(gaps.length
        ? {
            warning: `Traffic data is incomplete: ${gaps.join("; ")}.`,
            warningKind: streamError && flows.length === 0 ? "transient" : "incomplete",
          }
        : {}),
    };
  }

  close() {
    this.connection?.client.close();
    this.connection?.forward.stop();
    this.connection = undefined;
  }
}
