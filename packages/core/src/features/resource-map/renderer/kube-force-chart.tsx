/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Deployment, StatefulSet } from "@freelensapp/kube-object";
import { Spinner } from "@freelensapp/spinner";
import { compareStructural, observable, reaction, runInAction } from "mobx";
import { observer } from "mobx-react";
import React from "react";
import ForceGraph2D from "react-force-graph-2d";
import { logPrefix } from "./dependencies";
import { loadConfigImages } from "./helpers/config";
import { ElementSize } from "./helpers/element-size";
import {
  applyMapForces,
  fitGraph,
  type GraphMethods,
  type NodePoint,
  nodePointsOf,
  refWithSetter,
  smallGraphZoom,
} from "./helpers/graph-methods";
import { helmReleaseKind } from "./helpers/helm";
import { buildNamespaceGraph, type NamespaceGraphObjects, sameGraph } from "./helpers/namespace-graph";
import styles from "./kube-force-chart.module.scss";
import { MapNodeList } from "./map-node-list";
import { MapTooltip } from "./tooltips/map-tooltip";

import type { KubeObject } from "@freelensapp/kube-object";

import type { MapStores, ResourceMapDependencies } from "./dependencies";
import type { ChartDataSeries, LinkObject } from "./helpers/types";

export interface KubeForceChartProps {
  dependencies: ResourceMapDependencies;
}

interface State {
  data: {
    nodes: ChartDataSeries[];
    links: LinkObject[];
  };
  highlightLinks: Set<LinkObject>;
  hoverNode?: ChartDataSeries;
}

/** What the map reads of a store, whose loads and watches the watch API runs. */
interface MapStore {
  readonly api: { readonly kind: string };
  readonly items: readonly KubeObject[];
  /** Observable: the watch API has loaded the store. */
  readonly isLoaded: boolean;
}

// The largest zoom of the graph of the page and of the panel.
const maxZoom = 2;

@observer
export class KubeForceChart extends React.Component<KubeForceChartProps, State> {
  @observable accessor isReady = false;
  /** The graph has stopped moving and has its first zoom: its nodes stay where they are. */
  @observable accessor settled = false;
  @observable accessor nodePoints: readonly NodePoint[] = [];

  protected links: LinkObject[] = [];
  protected nodes: ChartDataSeries[] = [];

  private chart?: GraphMethods;
  // The graph sets its methods in this ref when it mounts, so the forces go on
  // a simulation that exists.
  private readonly chartRef = refWithSetter<GraphMethods>((chart) => {
    this.chart = chart ?? undefined;
    if (chart) {
      applyMapForces(chart);
    }
  });
  private readonly tooltip = React.createRef<MapTooltip>();
  // The size of the container, which the graph takes.
  private readonly size = new ElementSize();
  private readonly followContainer = (element: HTMLDivElement | null) => this.size.follow(element);

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

  state: Readonly<State> = {
    data: {
      nodes: [],
      links: [],
    },
    highlightLinks: new Set<LinkObject>(),
  };

  initZoomDone = false;

  constructor(props: KubeForceChartProps) {
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
  }

  // force-graph keeps the center of its view when its canvas changes size, so
  // every node moves on the screen: a settled map takes their points again.
  componentDidUpdate() {
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
    this.initZoomDone = false;
    this.generateChartDataSeries();
  };

  getLinksForNode(node: ChartDataSeries): LinkObject[] {
    return this.links.filter((link) => link.source == node || link.target == node);
  }

  handleNodeHover(node: ChartDataSeries | null) {
    const highlightLinks = new Set<LinkObject>();
    if (node) {
      this.getLinksForNode(node).forEach((link) => highlightLinks.add(link));
    }
    this.setState({ highlightLinks: highlightLinks, hoverNode: node ?? undefined });
  }

  generateChartDataSeries = () => {
    const previous = { nodes: this.nodes, links: this.links };
    const graph = buildNamespaceGraph(this.mapObjects(), this.namespaces ?? [], previous);
    if (!previous.nodes.length || !sameGraph(graph, previous)) {
      this.nodes = graph.nodes;
      this.links = graph.links;
      this.unsettle();
      this.setState({
        data: graph,
        highlightLinks: new Set<LinkObject>(),
      });
    }
  };

  // The graph reached its first zoom and stopped: the points of its nodes, for
  // the hidden list, and the data-settled mark.
  private settle() {
    this.pointsSize = { width: this.size.width, height: this.size.height };
    runInAction(() => {
      this.nodePoints = nodePointsOf(this.chart, this.nodes);
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

    const { hoverNode } = this.state;

    return (
      <div
        ref={this.followContainer}
        className={styles.kubeForceChart}
        data-settled={this.settled || undefined}
        onMouseMove={(event) => this.tooltip.current?.follow(event)}
      >
        <MapTooltip ref={this.tooltip} object={hoverNode?.object} />
        <MapNodeList points={this.nodePoints} />

        <ForceGraph2D
          graphData={this.state.data}
          ref={this.chartRef}
          width={this.size.width}
          height={this.size.height}
          autoPauseRedraw={false}
          linkWidth={(link) => (this.state.highlightLinks.has(link) ? 2 : 1)}
          maxZoom={maxZoom}
          cooldownTicks={200}
          onEngineStop={() => {
            if (this.initZoomDone) {
              this.settle();
            } else if (this.nodes.length > 10) {
              this.initZoomDone = true;
              fitGraph(this.chart, this.size, maxZoom, 400);
              this.settleTimer = setTimeout(() => this.settle(), 400);
            } else {
              this.initZoomDone = true;
              fitGraph(this.chart, this.size, smallGraphZoom, 0);
              this.settle();
            }
          }}
          onNodeHover={(node) => this.handleNodeHover(node)}
          onNodeDrag={(node) => this.handleNodeHover(node)}
          nodeVal="value"
          nodeLabel={() => ""}
          nodeVisibility={"visible"}
          linkColor={(link) => {
            return (link.source as ChartDataSeries).color ?? "";
          }}
          onNodeClick={(node) => {
            const { object } = node;
            if (object) {
              if (object.kind === helmReleaseKind) {
                this.dependencies.showHelmRelease({ namespace: object.getNs(), name: object.getName() });
              } else {
                this.dependencies.showDetails(object.selfLink);
              }
            }
          }}
          nodeCanvasObject={(node, ctx, globalScale) => {
            const padAmount = 0;
            const label = node.name;
            const fontSize = 8;
            const x = node.x ?? 0;
            const y = node.y ?? 0;

            const r = Math.sqrt(Math.max(0, node.value || 10)) * 4 + padAmount;

            // draw outer circle
            if (["Deployment", "DaemonSet", "StatefulSet"].includes(node.kind)) {
              ctx.beginPath();
              ctx.lineWidth = 2;
              ctx.arc(x, y, r + 3, 0, 2 * Math.PI, false);
              ctx.strokeStyle = node.color ?? "";
              ctx.stroke();
              ctx.fillStyle = colors.background;
              ctx.fill();
              ctx.closePath();
            }

            // draw circle
            const size = hoverNode == node ? r + 1 : r;

            ctx.beginPath();
            ctx.arc(x, y, size, 0, 2 * Math.PI, false);
            ctx.fillStyle = node.color || "rgba(31, 120, 180, 0.92)";
            ctx.fill();

            // draw icon
            const image = node.image;
            if (image) {
              try {
                ctx.drawImage(image, x - 15, y - 15, 30, 30);
              } catch (error) {
                this.dependencies.logger.error(`${logPrefix}: cannot draw the icon of ${node.kind}`, error);
              }
            }

            // draw label
            ctx.textAlign = "center";
            ctx.font = `${fontSize}px Arial`;
            ctx.textBaseline = "middle";
            ctx.fillStyle = colors.text;
            ctx.fillText(label, x, y + r + 10 / globalScale);
          }}
        />
      </div>
    );
  }
}
