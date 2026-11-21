/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { describe, expect, it } from "vitest";
import { kubeObject, pod, secret } from "../test-utils/kube-objects";
import { buildCardGraph, chainOf, hubEdgesOf, sameCardShape, searchCards, viewOf } from "./card-graph";
import { buildNamespaceGraph } from "./namespace-graph";

import type {
  ConfigMap,
  Deployment,
  Ingress,
  PersistentVolumeClaim,
  Pod,
  Service,
  StatefulSet,
} from "@freelensapp/kube-object";

import type { PodSpec } from "../test-utils/kube-objects";
import type { CardGraph } from "./card-graph";
import type { NamespaceGraphObjects } from "./namespace-graph";

type Workload = Deployment | StatefulSet;

const helm = (release: string) => ({
  labels: { "app.kubernetes.io/managed-by": "Helm" },
  annotations: { "meta.helm.sh/release-name": release },
});

const workload = (kind: string, name: string, release?: string) =>
  kubeObject<Workload>(kind, { name, namespace: "shop", ...(release ? helm(release) : {}) });

const service = (name: string, app: string) =>
  kubeObject<Service>("Service", { name, namespace: "shop" }, { spec: { selector: { app } } });

const ingress = (name: string, serviceName: string, tlsSecret?: string) =>
  kubeObject<Ingress>(
    "Ingress",
    { name, namespace: "shop" },
    {
      spec: {
        tls: tlsSecret ? [{ secretName: tlsSecret }] : undefined,
        rules: [{ http: { paths: [{ backend: { service: { name: serviceName } } }] } }],
      },
    },
  );

// A pod of `app` that reads `config` and `credentials` from its environment and mounts `claim`.
const appPod = (name: string, app: string, spec: PodSpec = {}, mounts: { config?: string; claim?: string } = {}) =>
  pod(name, "shop", {
    labels: { app },
    containers: [
      {
        name: app,
        envFrom: mounts.config ? [{ configMapRef: { name: mounts.config } }] : [],
        env: [{ name: "PASSWORD", valueFrom: { secretKeyRef: { name: "credentials", key: "password" } } }],
      },
    ],
    volumes: mounts.claim ? [{ name: "data", persistentVolumeClaim: { claimName: mounts.claim } }] : [],
    ...spec,
  });

/**
 * A namespace: an Ingress, with its certificate, in front of the Service of a
 * Deployment of two pods of the Helm release "storefront", a StatefulSet with a
 * volume, a pod of no workload, the release's own secret, and two cards that
 * nothing links.
 */
function shop(pods?: Pod[]) {
  const web = workload("Deployment", "web", "storefront");
  const db = workload("StatefulSet", "db");
  const allPods = pods ?? [
    appPod("web-1", "web", {}, { config: "web-config" }),
    appPod("web-2", "web", { status: "CrashLoopBackOff" }, { config: "web-config" }),
    appPod("db-0", "db", { status: "Pending" }, { claim: "data-db-0" }),
    appPod("debug", "debug", { status: "Succeeded" }),
  ];
  const objects: NamespaceGraphObjects = {
    pods: allPods,
    deployments: [web as Deployment],
    statefulSets: [db as StatefulSet],
    daemonSets: [],
    services: [service("web", "web"), service("unused", "nothing")],
    ingresses: [ingress("web", "web", "web-tls")],
    pvcs: [kubeObject<PersistentVolumeClaim>("PersistentVolumeClaim", { name: "data-db-0", namespace: "shop" })],
    configMaps: [kubeObject<ConfigMap>("ConfigMap", { name: "web-config", namespace: "shop" })],
    secrets: [
      secret("credentials", "shop"),
      secret("web-tls", "shop"),
      secret("orphan", "shop"),
      secret("sh.helm.release.v1.storefront.v1", "shop", "helm.sh/release.v1", { name: "storefront" }),
    ],
    childPods: (controller) => allPods.filter((each) => each.metadata.labels?.app === controller.getName()),
  };
  return buildNamespaceGraph(objects, ["shop"]);
}

const cardIds = (graph: CardGraph) => graph.cards.map((card) => card.id).sort();
const edgeIds = (graph: CardGraph) => graph.edges.map((edge) => edge.id).sort();
const cardOf = (graph: CardGraph, id: string) => graph.cards.find((card) => card.id === id);

describe("buildCardGraph", () => {
  const cards = buildCardGraph(shop());

  it("makes a card of every object but the pods of a workload, the Helm releases and their secrets", () => {
    expect(cardIds(cards)).toEqual([
      "ConfigMap/shop/web-config",
      "Deployment/shop/web",
      "Ingress/shop/web",
      "PersistentVolumeClaim/shop/data-db-0",
      "Pod/shop/debug",
      "Secret/shop/credentials",
      "Secret/shop/orphan",
      "Secret/shop/web-tls",
      "Service/shop/unused",
      "Service/shop/web",
      "StatefulSet/shop/db",
    ]);
  });

  it("puts every card in the column of its kind", () => {
    const columns = Object.fromEntries(cards.cards.map((card) => [card.kind, card.column]));

    expect(columns).toEqual({
      Ingress: 0,
      Service: 1,
      Deployment: 2,
      StatefulSet: 2,
      Pod: 2,
      ConfigMap: 3,
      Secret: 3,
      PersistentVolumeClaim: 3,
    });
  });

  it("folds the pods of a workload into its card, with their health", () => {
    expect(cardOf(cards, "Deployment/shop/web")?.pods.map(({ name, status }) => [name, status])).toEqual([
      ["web-1", "running"],
      ["web-2", "failed"],
    ]);
    expect(cardOf(cards, "StatefulSet/shop/db")?.pods.map(({ status }) => status)).toEqual(["pending"]);
  });

  it("keeps a pod of no workload as a card of its own, which is its one pod", () => {
    const debug = cardOf(cards, "Pod/shop/debug");

    expect(debug?.column).toBe(2);
    expect(debug?.pods.map(({ name, status }) => [name, status])).toEqual([["debug", "done"]]);
  });

  it("points the links of a folded pod at its workload once, left to right whatever the direction they had", () => {
    // The graph keeps a pod -> Service, a claim -> pod and a pod -> secret.
    expect(edgeIds(cards)).toEqual([
      "Deployment/shop/web->ConfigMap/shop/web-config",
      "Deployment/shop/web->Secret/shop/credentials",
      "Ingress/shop/web->Secret/shop/web-tls",
      "Ingress/shop/web->Service/shop/web",
      "Pod/shop/debug->Secret/shop/credentials",
      "Service/shop/web->Deployment/shop/web",
      "StatefulSet/shop/db->PersistentVolumeClaim/shop/data-db-0",
      "StatefulSet/shop/db->Secret/shop/credentials",
    ]);
  });

  it("drops an edge between two cards of one column", () => {
    // A pod that two workloads claim folds into the first by id, and the other gets no edge to it.
    const shared = appPod("shared-1", "shared");
    const objects: NamespaceGraphObjects = {
      pods: [shared],
      deployments: [workload("Deployment", "a") as Deployment, workload("Deployment", "b") as Deployment],
      statefulSets: [],
      daemonSets: [],
      services: [],
      ingresses: [],
      pvcs: [],
      configMaps: [],
      secrets: [],
      childPods: () => [shared],
    };

    const graph = buildCardGraph(buildNamespaceGraph(objects, ["shop"]));

    expect(cardOf(graph, "Deployment/shop/a")?.pods.map(({ name }) => name)).toEqual(["shared-1"]);
    expect(cardOf(graph, "Deployment/shop/b")?.pods).toEqual([]);
    expect(graph.edges).toEqual([]);
  });

  it("names the Helm release of every card that one manages, and lists the releases with their cards", () => {
    expect(cardOf(cards, "Deployment/shop/web")?.release).toBe("storefront");
    expect(cardOf(cards, "Service/shop/web")?.release).toBeUndefined();
    expect(cards.releases).toEqual([{ name: "storefront", namespace: "shop", cards: 1 }]);
  });

  it("tells the cards without an edge, and counts the consumers of config and storage", () => {
    const unlinked = cards.cards.filter((card) => !card.linked).map((card) => card.id);

    expect(unlinked.sort()).toEqual(["Secret/shop/orphan", "Service/shop/unused"]);
    expect(cardOf(cards, "Secret/shop/credentials")?.consumers).toBe(3);
    expect(cardOf(cards, "ConfigMap/shop/web-config")?.consumers).toBe(1);
  });

  it("keeps the cards of a graph built again, with the new status of a pod, and the same shape", () => {
    const web = cardOf(cards, "Deployment/shop/web");
    const next = shop([
      appPod("web-1", "web", { status: "Failed" }, { config: "web-config" }),
      appPod("web-2", "web", {}, { config: "web-config" }),
      appPod("db-0", "db", { status: "Pending" }, { claim: "data-db-0" }),
      appPod("debug", "debug", { status: "Succeeded" }),
    ]);

    const again = buildCardGraph(next, cards);

    expect(cardOf(again, "Deployment/shop/web")).toBe(web);
    expect(web?.pods.map(({ status }) => status)).toEqual(["failed", "running"]);
    expect(sameCardShape(again, cards)).toBe(true);
  });

  it("tells a graph of another shape", () => {
    const withoutDebug = shop([
      appPod("web-1", "web", {}, { config: "web-config" }),
      appPod("web-2", "web", {}, { config: "web-config" }),
      appPod("db-0", "db", {}, { claim: "data-db-0" }),
    ]);

    expect(sameCardShape(buildCardGraph(withoutDebug), cards)).toBe(false);
  });
});

describe("chainOf", () => {
  const { edges } = buildCardGraph(shop());

  it("walks left to the callers and right to the dependencies of a card, and not to the siblings", () => {
    const chain = chainOf(edges, ["Service/shop/web"]);

    expect([...chain.cards].sort()).toEqual([
      "ConfigMap/shop/web-config",
      "Deployment/shop/web",
      "Ingress/shop/web",
      "Secret/shop/credentials",
      "Service/shop/web",
    ]);
    // The certificate of the Ingress is a dependency of a caller, not of the Service.
    expect(chain.edges.has("Ingress/shop/web->Secret/shop/web-tls")).toBe(false);
    expect([...chain.edges].sort()).toEqual([
      "Deployment/shop/web->ConfigMap/shop/web-config",
      "Deployment/shop/web->Secret/shop/credentials",
      "Ingress/shop/web->Service/shop/web",
      "Service/shop/web->Deployment/shop/web",
    ]);
  });

  it("walks from a shared secret to every one of its consumers and their callers", () => {
    const chain = chainOf(edges, ["Secret/shop/credentials"]);

    expect([...chain.cards].sort()).toEqual([
      "Deployment/shop/web",
      "Ingress/shop/web",
      "Pod/shop/debug",
      "Secret/shop/credentials",
      "Service/shop/web",
      "StatefulSet/shop/db",
    ]);
  });
});

describe("viewOf", () => {
  const graph = buildCardGraph(shop());
  const none = new Set<string>();
  const folding = { hiddenKinds: none, hideUnlinked: false, fold: true };
  const heldBy = (view: ReturnType<typeof viewOf>) =>
    Object.fromEntries([...view.held].map(([id, cards]) => [id, cards.map((card) => card.id)]));
  const ids = (view: ReturnType<typeof viewOf>) => view.cards.map((card) => card.id);

  it("folds a Service of one workload into it, Services first, and points the Ingress at the workload", () => {
    const view = viewOf(graph, folding);

    expect(heldBy(view)["Deployment/shop/web"]).toEqual(["Service/shop/web", "ConfigMap/shop/web-config"]);
    expect(ids(view)).not.toContain("Service/shop/web");
    expect(view.edges.map((edge) => edge.id)).toContain("Ingress/shop/web->Deployment/shop/web");
  });

  it("then folds every config and storage card with one consumer into it, the ingress of a certificate included", () => {
    const view = viewOf(graph, folding);

    expect(heldBy(view)).toEqual({
      "Deployment/shop/web": ["Service/shop/web", "ConfigMap/shop/web-config"],
      "Ingress/shop/web": ["Secret/shop/web-tls"],
      "StatefulSet/shop/db": ["PersistentVolumeClaim/shop/data-db-0"],
    });
    for (const folded of ["ConfigMap/shop/web-config", "Secret/shop/web-tls", "PersistentVolumeClaim/shop/data-db-0"]) {
      expect(ids(view)).not.toContain(folded);
    }
    expect(view.edges.map((edge) => edge.id).sort()).toEqual([
      "Deployment/shop/web->Secret/shop/credentials",
      "Ingress/shop/web->Deployment/shop/web",
      "Pod/shop/debug->Secret/shop/credentials",
      "StatefulSet/shop/db->Secret/shop/credentials",
    ]);
  });

  it("keeps a shared secret, a Service of no pod and a secret of no consumer as cards", () => {
    const view = viewOf(graph, folding);

    expect(ids(view)).toContain("Secret/shop/credentials");
    expect(ids(view)).toContain("Service/shop/unused");
    expect(ids(view)).toContain("Secret/shop/orphan");
  });

  it("keeps a Service of two workloads as a card, with the edges of its Ingress and to both workloads", () => {
    const pods = ["a", "b"].map((app) => pod(`${app}-1`, "shop", { labels: { app, tier: "front" } }));
    const objects: NamespaceGraphObjects = {
      pods,
      deployments: [workload("Deployment", "a") as Deployment, workload("Deployment", "b") as Deployment],
      statefulSets: [],
      daemonSets: [],
      services: [
        kubeObject<Service>("Service", { name: "front", namespace: "shop" }, { spec: { selector: { tier: "front" } } }),
      ],
      ingresses: [ingress("front", "front")],
      pvcs: [],
      configMaps: [],
      secrets: [],
      childPods: (controller) => pods.filter((each) => each.metadata.labels?.app === controller.getName()),
    };

    const view = viewOf(buildCardGraph(buildNamespaceGraph(objects, ["shop"])), folding);

    expect(ids(view)).toContain("Service/shop/front");
    expect(view.held.size).toBe(0);
    expect(view.edges.map((edge) => edge.id).sort()).toEqual([
      "Ingress/shop/front->Service/shop/front",
      "Service/shop/front->Deployment/shop/a",
      "Service/shop/front->Deployment/shop/b",
    ]);
  });

  it("unfolds them all as cards with their edges", () => {
    const view = viewOf(graph, { ...folding, fold: false });

    expect(view.cards).toHaveLength(graph.cards.length);
    expect(view.edges).toHaveLength(graph.edges.length);
    expect(view.held.size).toBe(0);
  });

  it("leaves a hidden kind out of the cards and of what they hold, and counts the consumers that are shown", () => {
    expect(heldBy(viewOf(graph, { ...folding, hiddenKinds: new Set(["Secret"]) }))).toEqual({
      "Deployment/shop/web": ["Service/shop/web", "ConfigMap/shop/web-config"],
      "StatefulSet/shop/db": ["PersistentVolumeClaim/shop/data-db-0"],
    });
    expect(heldBy(viewOf(graph, { ...folding, hiddenKinds: new Set(["Service"]) }))["Deployment/shop/web"]).toEqual([
      "ConfigMap/shop/web-config",
    ]);

    // Without the Deployment, its Service has no target, and its config map no consumer: both stay cards.
    const withoutDeployments = viewOf(graph, { ...folding, hiddenKinds: new Set(["Deployment"]) });

    expect(ids(withoutDeployments)).toContain("ConfigMap/shop/web-config");
    expect(ids(withoutDeployments)).toContain("Service/shop/web");
  });

  it("leaves out the cards without an edge when asked", () => {
    expect(ids(viewOf(graph, { ...folding, hideUnlinked: true }))).not.toContain("Secret/shop/orphan");
  });
});

describe("searchCards", () => {
  const { cards } = buildCardGraph(shop());
  const found = (query: string) => searchCards(cards, query).map((card) => card.id);

  it("finds the card that holds a folded object by the name of the object", () => {
    const view = viewOf(buildCardGraph(shop()), { hiddenKinds: new Set(), hideUnlinked: false, fold: true });
    const holders = (query: string) => searchCards(view.cards, query, view.held).map((card) => card.id);

    expect(holders("WEB-TLS")).toEqual(["Ingress/shop/web"]);
    // The Service "web" folded into the Deployment of the same name.
    expect(holders("web")).toEqual(["Deployment/shop/web", "Ingress/shop/web"]);
    expect(holders("unused")).toEqual(["Service/shop/unused"]);
  });

  it("finds the pod that holds a folded Service of another name by the name of the Service", () => {
    const debug = pod("debug-1", "shop", { labels: { app: "debug" } });
    const objects: NamespaceGraphObjects = {
      pods: [debug],
      deployments: [],
      statefulSets: [],
      daemonSets: [],
      services: [service("admin-http", "debug")],
      ingresses: [],
      pvcs: [],
      configMaps: [],
      secrets: [],
      childPods: () => [],
    };
    const view = viewOf(buildCardGraph(buildNamespaceGraph(objects, ["shop"])), {
      hiddenKinds: new Set(),
      hideUnlinked: false,
      fold: true,
    });

    expect(view.cards.map((card) => card.id)).toEqual(["Pod/shop/debug-1"]);
    expect(searchCards(view.cards, "ADMIN-HTTP", view.held).map((card) => card.id)).toEqual(["Pod/shop/debug-1"]);
  });

  it("finds a card by its name, its kind, its release and the names of its pods, whatever the case", () => {
    expect(found("ORPHAN")).toEqual(["Secret/shop/orphan"]);
    expect(found("stateful set")).toEqual(["StatefulSet/shop/db"]);
    expect(found("storefront")).toEqual(["Deployment/shop/web"]);
    expect(found("web-2")).toEqual(["Deployment/shop/web"]);
    expect(found("  ")).toEqual([]);
  });
});

describe("hubEdgesOf", () => {
  const into = (target: string, count: number) =>
    Array.from({ length: count }, (_, index) => ({
      id: `Pod/shop/pod-${index}->${target}`,
      source: `Pod/shop/pod-${index}`,
      target,
    }));

  it("names the edges into a card of five consumers or more, and none into a card of four", () => {
    const hub = into("Secret/shop/shared", 5);
    const team = into("Secret/shop/team", 4);

    expect([...hubEdgesOf([...hub, ...team])].sort()).toEqual(hub.map((edge) => edge.id).sort());
  });
});
