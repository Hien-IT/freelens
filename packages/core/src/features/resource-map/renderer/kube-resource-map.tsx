/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Button } from "@freelensapp/button";
import { Icon } from "@freelensapp/icon";
import { Deployment, StatefulSet } from "@freelensapp/kube-object";
import { Spinner } from "@freelensapp/spinner";
import { cssNames } from "@freelensapp/utilities";
import { compareStructural, observable, reaction, runInAction } from "mobx";
import { observer } from "mobx-react";
import React from "react";
import ForceGraph2D from "react-force-graph-2d";
import { cardHeight, cardWidth, fitTransform } from "../../traffic-map/renderer/layout";
import { logPrefix } from "./dependencies";
import { edgeStyle, kindColor, paintCard, paintCardArea, paintEdge, paintHeaders } from "./helpers/card-canvas";
import {
  buildCardGraph,
  cardReleaseKey,
  chainOf,
  hubEdgesOf,
  releaseKey,
  sameCardShape,
  searchCards,
  viewOf,
} from "./helpers/card-graph";
import { layoutCards, readableFit, releaseColors } from "./helpers/card-layout";
import { loadConfigImages, podHealthStyles } from "./helpers/config";
import { fontFamilyOf } from "./helpers/draw";
import { ElementSize } from "./helpers/element-size";
import { type NodePoint, nodePointsOf, refWithSetter, zoomGraphBy } from "./helpers/graph-methods";
import { buildNamespaceGraph, type NamespaceGraphObjects } from "./helpers/namespace-graph";
import styles from "./kube-resource-map.module.scss";
import { kindCounts, MapKindChips, MapReleaseChips } from "./map-kind-chips";
import { MapNodeList } from "./map-node-list";
import { MapZoomControls } from "./map-zoom-controls";
import { MapTooltip } from "./tooltips/map-tooltip";

import type { KubeObject } from "@freelensapp/kube-object";

import type { ForceGraphMethods } from "react-force-graph-2d";

import type { EdgeRoute, RoutePoint } from "../../traffic-map/renderer/layout";
import type { MapStores, ResourceMapDependencies } from "./dependencies";
import type { CardEmphasis, EdgeEmphasis } from "./helpers/card-canvas";
import type { CardChain, CardGraph, HeldObjects, MapCard, MapEdge } from "./helpers/card-graph";
import type { ColumnHeader } from "./helpers/card-layout";
import type { ChartDataSeries, LinkObject } from "./helpers/types";

export interface KubeResourceMapProps {
  dependencies: ResourceMapDependencies;
}

/** A card as the canvas draws it: pinned where the layout put it. */
interface DrawnCard {
  id: string;
  card: MapCard;
  x: number;
  y: number;
  fx: number;
  fy: number;
}

/** An edge as the canvas draws it, along its route, in the colour of the kind of its source. */
interface DrawnEdge {
  id: string;
  source: string | DrawnCard;
  target: string | DrawnCard;
  route: EdgeRoute;
  color: string;
}

type GraphMethods = ForceGraphMethods<DrawnCard, DrawnEdge>;

/** What the canvas draws of the map, laid out once for the cards that the filters show. */
interface Drawing {
  graph: { nodes: DrawnCard[]; links: DrawnEdge[] };
  cards: MapCard[];
  edges: MapEdge[];
  /** The Services, config and storage folded into the cards. */
  held: HeldObjects;
  /** The edges into a hub, drawn only in a chain that the map brings forward. */
  hubEdges: ReadonlySet<string>;
  /** How many objects the folding folds, whether the map folds them or not. */
  foldable: number;
  headers: ColumnHeader[];
  fitPoints: RoutePoint[];
}

/** What the map brings forward, and which cards of it stand out. */
interface Focus extends CardChain {
  strong: ReadonlySet<string>;
}

interface State {
  /** The cards of the namespaces, the newest. */
  graph: CardGraph;
  /** The graph whose shape the layout is of: the same cards and edges, refreshed in place. */
  layoutOf: CardGraph;
  hovered?: string;
  /** The card clicked last, whose chain stays forward until the background is clicked or Escape pressed. */
  selected?: string;
  /** The text of the search. */
  query: string;
  /** The match that the view was last centred on, -1 before the first. */
  matchIndex: number;
  /** The kinds whose cards the map leaves out. */
  hiddenKinds: ReadonlySet<string>;
  /** The map leaves out the cards without an edge. */
  hideUnlinked: boolean;
  /** Every object is a card of its own: no Service, config or storage is folded into the card that uses it. */
  showEvery: boolean;
  /** The key of the Helm release that the map focuses. */
  release?: string;
}

type Filters = Pick<State, "hiddenKinds" | "hideUnlinked" | "showEvery">;

/** What the map reads of a store, whose loads and watches the watch API runs. */
interface MapStore {
  readonly api: { readonly kind: string };
  readonly items: readonly KubeObject[];
  /** Observable: the watch API has loaded the store. */
  readonly isLoaded: boolean;
}

const emptyGraph: CardGraph = { cards: [], edges: [], releases: [] };

// The zoom of the map, as the Traffic Map's: the most a fit zooms in, so that a few cards are not blown up, and
// the room a fit keeps around the cards.
const minZoom = 0.1;
const maxZoom = 4;
const maxFitZoom = 1.25;
const fitPadding = 48;
// The zoom that the view takes, at least, on a match of the search.
const matchZoom = 1;

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/**
 * The Resource Map of the namespaces of the filter: a card per object, in the
 * columns of their kinds, Ingresses, Services, workloads, config and storage,
 * with the pods of a workload folded into its card, and an edge for every
 * reference between two cards. force-graph only pans and zooms the canvas: the
 * cards are pinned where the layout puts them.
 */
@observer
export class KubeResourceMap extends React.Component<KubeResourceMapProps, State> {
  @observable accessor isReady = false;
  /** The map is laid out and fitted: its cards stay where they are. */
  @observable accessor settled = false;
  @observable accessor nodePoints: readonly NodePoint[] = [];

  protected links: LinkObject[] = [];
  protected nodes: ChartDataSeries[] = [];

  private chart?: GraphMethods;
  // force-graph takes no callback ref.
  private readonly chartRef = refWithSetter<GraphMethods>((chart) => {
    this.chart = chart ?? undefined;
  });
  private readonly tooltip = React.createRef<MapTooltip>();
  // The size of the container, which the graph takes.
  private readonly size = new ElementSize();
  // The font of the application, for the text on the canvas, and the texts fitted to the cards in it.
  private fontFamily = "sans-serif";
  private readonly fitted = new Map<string, string>();
  // The canvas area, which the tooltip is placed in.
  private canvasElement?: HTMLDivElement;
  private readonly followContainer = (element: HTMLDivElement | null) => {
    this.size.follow(element);
    this.canvasElement = element ?? undefined;
    if (element) this.fontFamily = fontFamilyOf(element);
  };

  // What the map takes from the application, which does not change; a field,
  // as mobx-react lets no reaction read this.props.
  private readonly dependencies: ResourceMapDependencies;
  private readonly namespaceStore: ResourceMapDependencies["namespaceStore"];
  private readonly stores: ResourceMapDependencies["stores"];

  private listable = new Set<keyof MapStores>();
  // The selection of the filter, which the one reaction of the view keeps.
  private namespaces?: string[];
  private kubeObjectStores: MapStore[] = [];
  private disposers: (() => void)[] = [];
  private settleTimer?: ReturnType<typeof setTimeout>;
  // The size of the canvas when the points of the hidden list were taken.
  private pointsSize = { width: 0, height: 0 };
  // The cards of the last build, which the next one refreshes in place.
  private cardGraph?: CardGraph;
  // The drawing of the filters of the state, kept while neither changes: a new one lays the map out again.
  private drawn?: { layoutOf: CardGraph; filters: Filters; drawing: Drawing };
  // The drawing that the view was last fitted to.
  private fittedTo?: Drawing;

  state: Readonly<State> = {
    graph: emptyGraph,
    layoutOf: emptyGraph,
    query: "",
    matchIndex: -1,
    hiddenKinds: new Set(),
    hideUnlinked: false,
    showEvery: false,
  };

  constructor(props: KubeResourceMapProps) {
    super(props);
    this.dependencies = props.dependencies;
    this.namespaceStore = props.dependencies.namespaceStore;
    this.stores = props.dependencies.stores;
    loadConfigImages();
  }

  // Everything a mount starts, its next unmount stops: React.StrictMode, in
  // Freelens dev, mounts, unmounts and mounts again the same instance.
  //
  // The watch API loads and watches the stores, for the namespaces of the
  // filter, and loads them again when the selection changes; it shares its
  // watch of a store with the other views that follow it. A list that fails,
  // the load's own or one that a watch sends again after the API server
  // answered 410 Gone, is logged as a warning, and the map draws the rest.
  componentDidMount() {
    const keys = Object.keys(this.stores) as (keyof MapStores)[];
    this.listable = new Set(keys.filter((key) => this.dependencies.canListMapStore(key)));
    const listed = [...this.listable].map((key) => this.stores[key]);
    this.kubeObjectStores = listed;

    this.disposers.push(
      this.namespaceStore.onContextChange(
        (namespaces) => {
          const changed = this.namespaces !== undefined;
          this.namespaces = namespaces;
          if (changed && this.isReady) {
            this.displayChart();
          }
        },
        { fireImmediately: true },
      ),
      ...listed.map((store) =>
        reaction(
          () => store.items.toJSON(),
          () => {
            if (this.isReady) this.generateChartDataSeries();
          },
          { equals: compareStructural },
        ),
      ),
      reaction(
        () => listed.every((store) => store.isLoaded),
        (loaded) => {
          if (!loaded || this.isReady) return;
          runInAction(() => {
            this.isReady = true;
          });
          this.displayChart();
        },
        { fireImmediately: true },
      ),
      this.dependencies.subscribeStores(listed, {
        onLoadFailure: (error) => {
          this.dependencies.logger.warn(`${logPrefix}: cannot list the objects of a kind of the map`, error);
        },
      }),
    );
    window.addEventListener("keydown", this.keyDown);
    this.disposers.push(() => window.removeEventListener("keydown", this.keyDown));
  }

  // A new layout is fitted to the canvas once the canvas has a size. force-graph
  // keeps the center of its view when its canvas changes size, so every card
  // moves on the screen: a settled map takes their points again.
  componentDidUpdate() {
    this.fitNewDrawing();
    this.anchorTooltip();
    this.followResize();
  }

  componentWillUnmount() {
    this.disposers.forEach((dispose) => dispose());
    this.disposers.length = 0;
    this.namespaces = undefined;
    clearTimeout(this.settleTimer);
    runInAction(() => {
      this.isReady = false;
    });
  }

  displayChart = () => {
    this.nodes = [];
    this.links = [];
    this.cardGraph = undefined;
    this.fittedTo = undefined;
    this.generateChartDataSeries();
  };

  // The cards of the objects of the stores. A graph of the same shape is
  // refreshed in place, and keeps its layout and its zoom.
  generateChartDataSeries = () => {
    const previous = { nodes: this.nodes, links: this.links };
    const namespaceGraph = buildNamespaceGraph(this.mapObjects(), this.namespaces ?? [], previous);
    this.nodes = namespaceGraph.nodes;
    this.links = namespaceGraph.links;
    const before = this.cardGraph;
    const graph = buildCardGraph(namespaceGraph, before);
    this.cardGraph = graph;
    if (!before || !sameCardShape(graph, before)) {
      this.unsettle();
      this.setState({ graph, layoutOf: graph });
    } else {
      this.setState({ graph });
    }
  };

  // The cards that the filters show, laid out, and the edges between them.
  private drawing(): Drawing {
    const { layoutOf, hiddenKinds, hideUnlinked, showEvery } = this.state;
    const drawn = this.drawn;
    if (
      drawn?.layoutOf === layoutOf &&
      drawn.filters.hiddenKinds === hiddenKinds &&
      drawn.filters.hideUnlinked === hideUnlinked &&
      drawn.filters.showEvery === showEvery
    ) {
      return drawn.drawing;
    }
    const folded = viewOf(layoutOf, { hiddenKinds, hideUnlinked, fold: true });
    const { cards, edges, held } = showEvery ? viewOf(layoutOf, { hiddenKinds, hideUnlinked, fold: false }) : folded;
    const shown = new Map(cards.map((card) => [card.id, card]));
    const layout = layoutCards(cards, edges);
    const drawing: Drawing = {
      graph: {
        nodes: cards.map((card) => {
          const { x, y } = layout.points.get(card.id) ?? { x: 0, y: 0 };
          return { id: card.id, card, x, y, fx: x, fy: y };
        }),
        links: edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          route: layout.routes.get(edge.id) as EdgeRoute,
          color: kindColor(shown.get(edge.source)?.kind ?? ""),
        })),
      },
      cards,
      edges,
      held,
      foldable: [...folded.held.values()].reduce((count, each) => count + each.length, 0),
      hubEdges: hubEdgesOf(edges),
      headers: layout.headers,
      fitPoints: layout.fitPoints,
    };
    this.drawn = { layoutOf, filters: { hiddenKinds, hideUnlinked, showEvery }, drawing };
    return drawing;
  }

  // The chain that the map brings forward: of the hovered card, else of the
  // selected one, else the matches of the search, else the cards of the
  // focused release and their chains.
  private focus(drawing: Drawing): Focus | undefined {
    const { hovered, selected, query, release } = this.state;
    const shown = new Set(drawing.cards.map((card) => card.id));
    const of = (ids: readonly string[]): Focus => ({ ...chainOf(drawing.edges, ids), strong: new Set(ids) });
    if (hovered && shown.has(hovered)) return of([hovered]);
    if (selected && shown.has(selected)) return of([selected]);
    if (query.trim()) {
      const ids = new Set(searchCards(drawing.cards, query, drawing.held).map((card) => card.id));
      const edges = drawing.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
      return { cards: ids, edges: new Set(edges.map((edge) => edge.id)), strong: ids };
    }
    if (release) {
      return of(drawing.cards.filter((card) => cardReleaseKey(card) === release).map((card) => card.id));
    }
    return undefined;
  }

  // The tooltip of the hovered card sits by the card, not by the pointer: below
  // it or above it, where it hides the least of the edges, which leave a card by
  // its sides.
  private readonly anchorTooltip = () => {
    const { hovered } = this.state;
    const node = hovered ? this.drawing().graph.nodes.find((each) => each.id === hovered) : undefined;
    if (!node || !this.chart || !this.canvasElement) return;
    const zoom = this.chart.zoom() || 1;
    const corner = this.chart.graph2ScreenCoords(node.x - cardWidth / 2, node.y - cardHeight / 2);
    this.tooltip.current?.anchor(this.canvasElement, {
      left: corner.x,
      top: corner.y,
      width: cardWidth * zoom,
      height: cardHeight * zoom,
    });
  };

  private fitNewDrawing() {
    if (!this.isReady || !this.chart || !this.size.width || !this.size.height) return;
    const drawing = this.drawing();
    if (this.fittedTo === drawing || !drawing.cards.length) return;
    const first = this.fittedTo === undefined;
    this.fittedTo = drawing;
    clearTimeout(this.settleTimer);
    if (first) {
      this.fit(0, true);
      this.settle();
    } else {
      this.fit(300, true);
      this.settleTimer = setTimeout(() => this.settle(), 300);
    }
  }

  // A fit of every card, or, for a new layout, one that keeps the cards
  // readable and shows the top left of the map when they cannot all be.
  private fit(durationMs: number, readable: boolean) {
    const drawing = this.drawing();
    if (!this.chart || !drawing.cards.length) return;
    const options = { padding: fitPadding, minZoom, maxZoom: maxFitZoom };
    const { x, y, k } = readable
      ? readableFit(drawing.fitPoints, this.size, options)
      : fitTransform(drawing.fitPoints, this.size, options);
    this.chart.centerAt(x, y, durationMs);
    this.chart.zoom(k, durationMs);
  }

  // The map is laid out and fitted: the points of its cards, for the hidden
  // list, and the data-settled mark.
  private settle() {
    this.pointsSize = { width: this.size.width, height: this.size.height };
    const nodes = this.drawing().graph.nodes.map(({ id, card, x, y }) => ({ ...card, id, x, y }));
    runInAction(() => {
      this.nodePoints = nodePointsOf(this.chart, nodes);
      this.settled = true;
    });
  }

  private followResize() {
    const { width, height } = this.size;
    if (this.settled && (width !== this.pointsSize.width || height !== this.pointsSize.height)) {
      this.settle();
    }
  }

  private unsettle() {
    clearTimeout(this.settleTimer);
    runInAction(() => {
      this.settled = false;
      this.nodePoints = [];
    });
  }

  private readonly keyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && this.state.selected) {
      this.setState({ selected: undefined });
    }
  };

  // The filters lay the map out again, and fit it once it is laid out.
  private setFilters(filters: Partial<Filters>) {
    const { hiddenKinds, hideUnlinked, showEvery } = this.state;
    this.unsettle();
    this.setState({ hiddenKinds, hideUnlinked, showEvery, ...filters, hovered: undefined, matchIndex: -1 });
  }

  private readonly toggleKind = (kind: string) => {
    const hiddenKinds = new Set(this.state.hiddenKinds);
    if (!hiddenKinds.delete(kind)) hiddenKinds.add(kind);
    this.setFilters({ hiddenKinds });
  };

  private readonly toggleUnlinked = () => this.setFilters({ hideUnlinked: !this.state.hideUnlinked });

  private readonly toggleEvery = () => this.setFilters({ showEvery: !this.state.showEvery });

  // The pointer left the canvas, for a place where force-graph does not see it go: off the map, or onto an overlay.
  private readonly pointerLeft = () => {
    if (this.state.hovered) this.setState({ hovered: undefined });
  };

  private readonly showAll = () => this.setFilters({ hiddenKinds: new Set(), hideUnlinked: false });

  private readonly focusRelease = (release: string | undefined) => this.setState({ release });

  private readonly openRelease = () => {
    const release = this.state.graph.releases.find((each) => releaseKey(each) === this.state.release);
    if (release) this.dependencies.showHelmRelease({ namespace: release.namespace, name: release.name });
  };

  private readonly searchChanged = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.setState({ query: event.target.value, matchIndex: -1 });
  };

  // Enter centres the view on the next match, Escape clears the search.
  private readonly searchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      this.focusNextMatch();
    } else if (event.key === "Escape" && this.state.query) {
      event.preventDefault();
      event.stopPropagation();
      this.setState({ query: "", matchIndex: -1 });
    }
  };

  private focusNextMatch() {
    const drawing = this.drawing();
    const matches = searchCards(drawing.cards, this.state.query, drawing.held);
    if (!matches.length) return;
    const matchIndex = (this.state.matchIndex + 1) % matches.length;
    this.setState({ matchIndex });
    const node = drawing.graph.nodes.find((each) => each.id === matches[matchIndex].id);
    if (!this.chart || !node) return;
    this.chart.centerAt(node.x, node.y, 400);
    this.chart.zoom(Math.min(maxZoom, Math.max(this.chart.zoom() || 0, matchZoom)), 400);
  }

  private readonly cardClicked = (node: DrawnCard) => {
    this.setState({ selected: node.id });
    this.dependencies.showDetails(node.card.object.selfLink);
  };

  // The items of a store, or none for a kind that the user cannot list.
  private itemsOf<K extends keyof MapStores>(key: K): MapStores[K]["items"] | [] {
    return this.listable.has(key) ? this.stores[key].items : [];
  }

  private mapObjects(): NamespaceGraphObjects {
    const { stores } = this;
    return {
      pods: this.itemsOf("pods"),
      deployments: this.itemsOf("deployments"),
      statefulSets: this.itemsOf("statefulSets"),
      daemonSets: this.itemsOf("daemonSets"),
      services: this.itemsOf("services"),
      ingresses: this.itemsOf("ingresses"),
      pvcs: this.itemsOf("pvcs"),
      configMaps: this.itemsOf("configMaps"),
      secrets: this.itemsOf("secrets"),
      childPods: (controller) => {
        if (controller instanceof Deployment) return stores.deployments.getChildPods(controller);
        if (controller instanceof StatefulSet) return stores.statefulSets.getChildPods(controller);
        return stores.daemonSets.getChildPods(controller);
      },
    };
  }

  // Whether the stores hold no object of the selected namespaces, the config
  // maps aside, which the map draws only with the pods that use them.
  private noResourcesFound() {
    const namespaces = this.namespaces ?? [];
    return this.kubeObjectStores
      .filter((store) => store.api.kind !== "ConfigMap")
      .every((store) => !store.items.some((item) => !namespaces.length || namespaces.includes(item.getNs() ?? "")));
  }

  private searchNote(matches: number) {
    const { matchIndex } = this.state;
    if (!matches) return "No match";
    if (matchIndex >= 0 && matchIndex < matches) return `${matchIndex + 1} of ${matches}`;
    return plural(matches, "match", "matches");
  }

  render() {
    if (!this.isReady) {
      return (
        <div className={styles.status}>
          <Spinner />
        </div>
      );
    }

    if (this.noResourcesFound()) {
      return (
        <div className={styles.status}>
          <h3 className={styles.noResources}>No visualizable resources found in this namespace.</h3>
        </div>
      );
    }

    const colors = this.dependencies.getCanvasColors();
    const { graph, hovered, selected, query, hiddenKinds, hideUnlinked, showEvery, release } = this.state;
    const drawing = this.drawing();
    const focus = this.focus(drawing);
    const searching = query.trim() !== "";
    const matches = searching ? searchCards(drawing.cards, query, drawing.held).length : 0;
    const colorOf = releaseColors(graph.releases);
    const showNamespace = new Set(graph.cards.map((card) => card.namespace)).size > 1;
    const hoveredCard = graph.cards.find((card) => card.id === hovered);
    const kindsShown = graph.cards.filter((card) => !hiddenKinds.has(card.kind));
    const folded = [...drawing.held.values()].reduce((count, each) => count + each.length, 0);
    const resources = drawing.cards.length + folded;
    const hiddenCount = graph.cards.length - resources;
    const pods = drawing.cards.reduce((count, card) => count + card.pods.length, 0);
    const empty = graph.cards.length > 0 && drawing.cards.length === 0;
    const allKindsHidden = empty && kindsShown.length === 0;

    const cardEmphasis = (id: string): CardEmphasis => {
      if (focus && !focus.cards.has(id)) return "dim";
      if (id === selected) return "selected";
      if (focus?.strong.has(id)) return "highlight";
      return "normal";
    };
    const edgeEmphasis = (id: string): EdgeEmphasis => (!focus ? "rest" : focus.edges.has(id) ? "highlight" : "dim");
    const paintNode = (node: DrawnCard, ctx: CanvasRenderingContext2D) =>
      paintCard(ctx, node.card, node.x, node.y, {
        emphasis: cardEmphasis(node.id),
        colors,
        fontFamily: this.fontFamily,
        releaseColor: colorOf.get(cardReleaseKey(node.card) ?? ""),
        showNamespace,
        held: drawing.held.get(node.id),
        fitted: this.fitted,
        onIconError: (error) =>
          this.dependencies.logger.error(`${logPrefix}: cannot draw the icon of ${node.card.kind}`, error),
      });
    const paintLink = (link: DrawnEdge, ctx: CanvasRenderingContext2D) =>
      paintEdge(ctx, link.route, link.color, edgeStyle(edgeEmphasis(link.id), drawing.edges.length));
    // While a chain is forward, force-graph paints the rest: the faded edges, then the faded cards. The edges
    // of the chain go over those cards, and its cards over everything, so that no edge crosses their text.
    const forward = (id: string) => focus?.cards.has(id) ?? false;
    const paintForward = (ctx: CanvasRenderingContext2D) => {
      if (!focus) return;
      for (const link of drawing.graph.links) {
        if (focus.edges.has(link.id)) paintLink(link, ctx);
      }
      for (const node of drawing.graph.nodes) {
        if (forward(node.id)) paintNode(node, ctx);
      }
    };

    return (
      <div className={styles.map}>
        <div className={styles.toolbar}>
          <div className={styles.searchRow}>
            <div className={styles.searchField}>
              <Icon material="search" smallest className={styles.searchIcon} />
              <input
                type="search"
                className={styles.searchInput}
                placeholder="Find a resource…"
                aria-label="Find a resource on the map"
                value={query}
                onChange={this.searchChanged}
                onKeyDown={this.searchKeyDown}
              />
            </div>
            {searching && (
              <span className={styles.searchNote} role="status">
                {this.searchNote(matches)}
              </span>
            )}
          </div>
          <MapKindChips
            kinds={kindCounts(graph.cards)}
            hidden={hiddenKinds}
            onToggle={this.toggleKind}
            onShowAll={this.showAll}
            unlinked={{
              count: kindsShown.filter((card) => !card.linked).length,
              shown: !hideUnlinked,
              onToggle: this.toggleUnlinked,
            }}
            showEvery={{ count: drawing.foldable, shown: showEvery, onToggle: this.toggleEvery }}
          />
          <MapReleaseChips
            releases={graph.releases.map((each) => ({
              key: releaseKey(each),
              name: each.name,
              count: each.cards,
              color: colorOf.get(releaseKey(each)) ?? "",
            }))}
            focused={release}
            onFocus={this.focusRelease}
            onOpen={this.openRelease}
          />
        </div>

        <div
          ref={this.followContainer}
          className={cssNames(styles.canvas, styles.frame)}
          data-settled={this.settled || undefined}
        >
          <MapTooltip
            ref={this.tooltip}
            object={hoveredCard?.object}
            includes={hovered ? drawing.held.get(hovered)?.map((card) => card.object) : undefined}
          />
          <MapNodeList points={this.nodePoints} />

          {empty ? (
            <div className={styles.allHidden}>
              <p>{allKindsHidden ? "All kinds are hidden." : "The filters hide every card."}</p>
              <Button primary label="Show all" onClick={this.showAll} />
            </div>
          ) : (
            <div className={styles.graph} onMouseLeave={this.pointerLeft}>
              <ForceGraph2D<DrawnCard, DrawnEdge>
                graphData={drawing.graph}
                ref={this.chartRef}
                width={this.size.width}
                height={this.size.height}
                nodeId="id"
                cooldownTicks={0}
                warmupTicks={0}
                enableNodeDrag={false}
                minZoom={minZoom}
                maxZoom={maxZoom}
                nodeLabel={() => ""}
                nodeCanvasObject={(node, ctx) => {
                  if (!forward(node.id)) paintNode(node, ctx);
                }}
                nodePointerAreaPaint={(node, color, ctx) => paintCardArea(ctx, node.x, node.y, color)}
                linkCanvasObjectMode={() => "replace"}
                linkCanvasObject={(link, ctx) => {
                  // A chain's edges go over the cards; a hub's edges show only in a chain.
                  if (!focus?.edges.has(link.id) && !drawing.hubEdges.has(link.id)) paintLink(link, ctx);
                }}
                linkPointerAreaPaint={() => {}}
                onRenderFramePre={(ctx) => paintHeaders(ctx, drawing.headers, colors, this.fontFamily)}
                onRenderFramePost={paintForward}
                onNodeHover={(node) => this.setState({ hovered: node?.id })}
                onNodeClick={this.cardClicked}
                onZoom={this.anchorTooltip}
                onBackgroundClick={() => this.setState({ selected: undefined })}
              />
            </div>
          )}

          {!empty && (
            <MapZoomControls
              zoomBy={(factor) => zoomGraphBy(this.chart, factor, maxZoom, 200, minZoom)}
              fit={() => this.fit(300, false)}
            />
          )}
        </div>

        <div className={styles.stats}>
          <span>
            {plural(resources, "resource")} · {plural(pods, "pod")} · {plural(drawing.edges.length, "link")}
            {hiddenCount > 0 && ` · ${hiddenCount} hidden`}
          </span>
          {Object.values(podHealthStyles).map(({ label, color }) => (
            <span key={label} className={styles.legendItem}>
              <span className={styles.legendDot} style={{ background: color }} />
              {label}
            </span>
          ))}
        </div>
      </div>
    );
  }
}
