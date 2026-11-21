/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { kindLabel, podHealth, podHealthStyles } from "./config";
import { getHelmReleaseName, helmReleaseKind } from "./helm";

import type { KubeObject, Pod, Secret } from "@freelensapp/kube-object";

import type { PodHealth } from "./config";
import type { NamespaceGraph } from "./namespace-graph";
import type { ChartDataSeries, LinkObject } from "./types";

/** The names of the columns of the map, left to right. */
export const cardColumnNames = ["Ingresses", "Services", "Workloads", "Config & storage"] as const;

/** The column of a card by the kind of its object; a kind out of it gets no card. */
const columnOfKind: Partial<Record<string, number>> = {
  Ingress: 0,
  Service: 1,
  Deployment: 2,
  StatefulSet: 2,
  DaemonSet: 2,
  Pod: 2,
  ConfigMap: 3,
  Secret: 3,
  PersistentVolumeClaim: 3,
};

const workloadKinds = new Set(["Deployment", "StatefulSet", "DaemonSet"]);
const configColumn = 3;

/** A pod of a card. */
export interface CardPod {
  name: string;
  status: PodHealth;
  color: string;
  object: Pod;
}

/** A card of the map: an object, with the pods folded into it when it is a workload. */
export interface MapCard {
  /** The id of the node of the object in the namespace graph. */
  id: string;
  kind: string;
  name: string;
  namespace?: string;
  object: KubeObject;
  column: number;
  /** The Helm release that manages the object. */
  release?: string;
  /** The pods of a workload, or the pod of a pod card; none on other cards. */
  pods: CardPod[];
  /** The cards with an edge to this one; counted on the cards of config and storage. */
  consumers: number;
  /** The card has an edge. */
  linked: boolean;
}

/** An edge from a card to a card in a column further right. */
export interface MapEdge {
  id: string;
  source: string;
  target: string;
}

/** A Helm release of the map, and how many cards it manages. */
export interface MapRelease {
  name: string;
  namespace?: string;
  cards: number;
}

export interface CardGraph {
  cards: MapCard[];
  edges: MapEdge[];
  releases: MapRelease[];
}

/** The key of a release, unique across namespaces. */
export const releaseKey = (release: { name: string; namespace?: string }) =>
  `${release.namespace ?? ""}/${release.name}`;

/** The key of the release of a card, if it has one. */
export const cardReleaseKey = (card: MapCard) =>
  card.release ? releaseKey({ name: card.release, namespace: card.namespace }) : undefined;

const endId = (end: LinkObject["source"]) => (typeof end === "object" ? end.id : String(end));

const isReleaseSecret = (node: ChartDataSeries) =>
  node.kind === "Secret" && String((node.object as Secret).type) === "helm.sh/release.v1";

function cardPod(pod: Pod): CardPod {
  const status = podHealth(pod);
  return { name: pod.getName(), status, color: podHealthStyles[status].color, object: pod };
}

/**
 * The cards and edges of the map of a namespace graph: a card per object but
 * the Helm releases and their secrets, the pods of a workload folded into its
 * card, and every link between two cards of different columns as one edge
 * from left to right, whatever the direction the graph keeps it in.
 *
 * The cards of `previous` are reused: a card whose id is built again is the
 * same object, refreshed, so a change of the status of a pod reaches the
 * card that the map draws without laying it out again.
 */
export function buildCardGraph(graph: NamespaceGraph, previous?: CardGraph): CardGraph {
  const previousCards = new Map(previous?.cards.map((card) => [card.id, card]));
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));

  // The workload of each pod that one owns: the first by id, if several are linked to it.
  const ownerOf = new Map<string, string>();
  for (const link of graph.links) {
    const ends = [nodes.get(endId(link.source)), nodes.get(endId(link.target))];
    const workload = ends.find((node) => node && workloadKinds.has(node.kind));
    const pod = ends.find((node) => node?.kind === "Pod");
    if (!workload || !pod) continue;
    const owner = ownerOf.get(pod.id);
    if (!owner || workload.id < owner) ownerOf.set(pod.id, workload.id);
  }

  const cardIdOf = (node: ChartDataSeries) => {
    if (node.kind === helmReleaseKind || columnOfKind[node.kind] === undefined || isReleaseSecret(node)) {
      return undefined;
    }
    return ownerOf.get(node.id) ?? node.id;
  };

  const cards = new Map<string, MapCard>();
  for (const node of [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id))) {
    if (cardIdOf(node) !== node.id) continue;
    const card: MapCard = Object.assign(previousCards.get(node.id) ?? ({} as MapCard), {
      id: node.id,
      kind: node.kind,
      name: node.name,
      namespace: node.namespace,
      object: node.object,
      column: columnOfKind[node.kind] ?? 0,
      release: getHelmReleaseName(node.object),
      pods: [],
      consumers: 0,
      linked: false,
    });
    cards.set(card.id, card);
  }

  for (const node of graph.nodes) {
    if (node.kind !== "Pod") continue;
    const card = cards.get(cardIdOf(node) ?? "");
    card?.pods.push(cardPod(node.object as Pod));
  }
  for (const card of cards.values()) {
    card.pods.sort((a, b) => a.name.localeCompare(b.name));
  }

  const edges = new Map<string, MapEdge>();
  for (const link of graph.links) {
    const [from, to] = [link.source, link.target].map((end) => {
      const node = nodes.get(endId(end));
      return node && cards.get(cardIdOf(node) ?? "");
    });
    if (!from || !to || from.column === to.column) continue;
    const [source, target] = from.column < to.column ? [from, to] : [to, from];
    const id = `${source.id}->${target.id}`;
    if (!edges.has(id)) edges.set(id, { id, source: source.id, target: target.id });
  }

  for (const edge of edges.values()) {
    const source = cards.get(edge.source) as MapCard;
    const target = cards.get(edge.target) as MapCard;
    source.linked = true;
    target.linked = true;
    if (target.column === configColumn) target.consumers++;
  }

  const releases = new Map<string, MapRelease>();
  for (const card of cards.values()) {
    const key = cardReleaseKey(card);
    if (!key || !card.release) continue;
    const release = releases.get(key) ?? { name: card.release, namespace: card.namespace, cards: 0 };
    release.cards++;
    releases.set(key, release);
  }

  return {
    cards: [...cards.values()],
    edges: [...edges.values()].sort((a, b) => a.id.localeCompare(b.id)),
    releases: [...releases.values()].sort(
      (a, b) => a.name.localeCompare(b.name) || (a.namespace ?? "").localeCompare(b.namespace ?? ""),
    ),
  };
}

/** Whether two card graphs have the same cards and edges, by id, so the map can keep its layout. */
export function sameCardShape(a: CardGraph, b: CardGraph): boolean {
  const cardIds = new Set(a.cards.map((card) => card.id));
  const edgeIds = new Set(a.edges.map((edge) => edge.id));
  return (
    a.cards.length === b.cards.length &&
    a.edges.length === b.edges.length &&
    b.cards.every((card) => cardIds.has(card.id)) &&
    b.edges.every((edge) => edgeIds.has(edge.id))
  );
}

/** The cards that a highlight brings forward, and the edges between them. */
export interface CardChain {
  cards: ReadonlySet<string>;
  edges: ReadonlySet<string>;
}

/**
 * The chain of the cards `ids`: every card reachable from one of them going
 * left, its callers, and going right, its dependencies, transitively, with
 * the edges walked.
 */
export function chainOf(edges: readonly MapEdge[], ids: Iterable<string>): CardChain {
  const cards = new Set<string>(ids);
  const walked = new Set<string>();
  const walk = (from: "source" | "target", to: "source" | "target") => {
    const queue = [...cards];
    const seen = new Set(queue);
    while (queue.length) {
      const id = queue.shift() as string;
      for (const edge of edges) {
        if (edge[from] !== id) continue;
        walked.add(edge.id);
        if (!seen.has(edge[to])) {
          seen.add(edge[to]);
          queue.push(edge[to]);
        }
      }
    }
    return seen;
  };
  const right = walk("source", "target");
  const left = walk("target", "source");
  return { cards: new Set([...right, ...left]), edges: walked };
}

/** The objects that cards hold, by the id of the card that holds them. */
export type HeldObjects = ReadonlyMap<string, readonly MapCard[]>;

/** What the map shows of a card graph, with its filters applied. */
export interface MapView {
  cards: MapCard[];
  edges: MapEdge[];
  /** The Services, config and storage folded into the card of their one target or consumer. */
  held: HeldObjects;
}

export interface ViewFilters {
  /** The kinds whose cards the map leaves out, folded ones included. */
  hiddenKinds: ReadonlySet<string>;
  /** The map leaves out the cards without an edge. */
  hideUnlinked: boolean;
  /**
   * Folds every Service with one target into that target, and every card of
   * config or storage with one consumer into that consumer.
   */
  fold: boolean;
}

// The kinds that a card shows it holds, in this order.
export const heldKinds = ["Service", "ConfigMap", "Secret", "PersistentVolumeClaim"] as const;

const serviceColumn = 1;

const groupBy = (edges: readonly MapEdge[], end: "source" | "target") => {
  const groups = new Map<string, MapEdge[]>();
  for (const edge of edges) groups.set(edge[end], [...(groups.get(edge[end]) ?? []), edge]);
  return groups;
};

/**
 * The cards and edges that the map shows: without the hidden kinds and,
 * with `hideUnlinked`, the cards without an edge. With `fold`, a Service whose
 * one target is a card shown is folded into that card, which its callers then
 * call, and then every card of config or storage that one card shown uses is
 * folded into that card; their edges are dropped. The others stay cards: a
 * Service of no target or of several, and config used by several cards or by
 * none.
 */
export function viewOf(graph: CardGraph, { hiddenKinds, hideUnlinked, fold }: ViewFilters): MapView {
  const filtered = graph.cards.filter((card) => !hiddenKinds.has(card.kind) && (card.linked || !hideUnlinked));
  const shown = new Set(filtered.map((card) => card.id));
  const edges = graph.edges.filter((edge) => shown.has(edge.source) && shown.has(edge.target));
  if (!fold) return { cards: filtered, edges, held: new Map() };

  const held = new Map<string, MapCard[]>();
  const hold = (holder: string, card: MapCard) => held.set(holder, [...(held.get(holder) ?? []), card]);

  // The Services of one target, and the card each one is folded into.
  const outgoing = groupBy(edges, "source");
  const servedBy = new Map<string, string>();
  for (const card of filtered) {
    const targets = outgoing.get(card.id) ?? [];
    if (card.column !== serviceColumn || targets.length !== 1) continue;
    servedBy.set(card.id, targets[0].target);
    hold(targets[0].target, card);
  }
  const repointed = new Map<string, MapEdge>();
  for (const edge of edges) {
    if (servedBy.has(edge.source)) continue;
    const target = servedBy.get(edge.target);
    const kept = target ? { id: `${edge.source}->${target}`, source: edge.source, target } : edge;
    if (!repointed.has(kept.id)) repointed.set(kept.id, kept);
  }

  // The config and storage of one consumer.
  const consumers = groupBy([...repointed.values()], "target");
  const dropped = new Set<string>();
  for (const card of filtered) {
    const incoming = consumers.get(card.id) ?? [];
    if (card.column !== configColumn || incoming.length !== 1) continue;
    dropped.add(incoming[0].id);
    hold(incoming[0].source, card);
  }

  const order = (kind: string) => heldKinds.indexOf(kind as (typeof heldKinds)[number]);
  const folded = new Set<string>();
  for (const cards of held.values()) {
    cards.sort((a, b) => order(a.kind) - order(b.kind) || a.name.localeCompare(b.name));
    for (const card of cards) folded.add(card.id);
  }
  return {
    cards: filtered.filter((card) => !folded.has(card.id)),
    edges: [...repointed.values()].filter((edge) => !dropped.has(edge.id)),
    held,
  };
}

/**
 * The fewest incoming edges of a hub: a card that so many cards use, such as a
 * shared secret, whose edges would fill the map. Its edges are drawn only in a
 * chain that the map brings forward.
 */
export const hubThreshold = 5;

/** The ids of the edges into a hub. */
export function hubEdgesOf(edges: readonly MapEdge[]): Set<string> {
  const incoming = groupBy(edges, "target");
  return new Set(
    [...incoming.values()].filter((into) => into.length >= hubThreshold).flatMap((into) => into.map((edge) => edge.id)),
  );
}

/**
 * The cards whose name, kind, release, pods or folded objects hold `query`,
 * whatever the case, by name.
 */
export function searchCards(cards: readonly MapCard[], query: string, held: HeldObjects = new Map()): MapCard[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const holds = (text: string | undefined) => Boolean(text?.toLowerCase().includes(needle));
  return cards
    .filter(
      (card) =>
        holds(card.name) ||
        holds(kindLabel(card.kind)) ||
        holds(card.release) ||
        card.pods.some((pod) => holds(pod.name)) ||
        held.get(card.id)?.some((config) => holds(config.name)),
    )
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
