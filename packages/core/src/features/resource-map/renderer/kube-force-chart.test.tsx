/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { compareShallow, getObserverTree, observable, reaction, runInAction } from "mobx";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KubeForceChart } from "./kube-force-chart";
import { boxOnCanvas, fakeFitMethods, nameBelowCircle } from "./test-utils/canvas";
import { fakeLogger } from "./test-utils/fake-logger";
import { kubeObject, pod, secret } from "./test-utils/kube-objects";

import type { KubeObject, Pod } from "@freelensapp/kube-object";

import type { IObservableArray } from "mobx";

import type { ResourceMapDependencies } from "./dependencies";
import type { ChartDataSeries, LinkObject } from "./helpers/types";
import type { GraphBox } from "./test-utils/canvas";

// A store, as far as the map reads it: its items in an observable array, and
// whether the watch API has loaded it, observable as in the application.
interface FakeStore {
  api: { kind: string };
  items: IObservableArray<KubeObject>;
  isLoaded: boolean;
  getChildPods(): Pod[];
}

function fakeStore(kind: string): FakeStore {
  const state = observable({ isLoaded: false });
  return {
    api: { kind },
    items: observable.array<KubeObject>([], { deep: false }),
    get isLoaded() {
      return state.isLoaded;
    },
    set isLoaded(value) {
      runInAction(() => {
        state.isLoaded = value;
      });
    },
    getChildPods: () => [],
  };
}

// The watch API, as far as the map uses it: the stores of each subscription
// that has not been disposed, and the handler of failed lists it got. Unless
// `holdLoads` is set, it loads the stores of a subscription a turn later.
const watchApi = {
  subscriptions: [] as { stores: FakeStore[]; onLoadFailure?: (error: unknown) => void }[],
  holdLoads: false,
  subscribeStores: vi.fn(),
};

const watchesOf = (store: FakeStore) =>
  watchApi.subscriptions.filter((subscription) => subscription.stores.includes(store)).length;

function fakeSubscribeStores(stores: FakeStore[], opts: { onLoadFailure?: (error: unknown) => void } = {}) {
  const subscription = { stores, onLoadFailure: opts.onLoadFailure };
  watchApi.subscriptions.push(subscription);
  if (!watchApi.holdLoads) {
    void Promise.resolve().then(() => stores.forEach((store) => (store.isLoaded = true)));
  }
  return () => {
    watchApi.subscriptions = watchApi.subscriptions.filter((other) => other !== subscription);
  };
}

// jsdom has no ResizeObserver: this one hands the sizes that a test sets to
// the callback of the observer.
class FakeResizeObserver {
  static last?: FakeResizeObserver;
  element?: Element;
  disconnected = false;

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.last = this;
  }

  observe(element: Element) {
    this.element = element;
  }

  disconnect() {
    this.disconnected = true;
  }

  resize(width: number, height: number) {
    this.callback([{ contentRect: { width, height } } as ResizeObserverEntry], this as unknown as ResizeObserver);
  }
}

interface GraphProps {
  graphData: { nodes: ChartDataSeries[]; links: LinkObject[] };
  width: number;
  height: number;
  onNodeHover(node: ChartDataSeries | null, previous: ChartDataSeries | null): void;
  onEngineStop(): void;
  onNodeClick(node: ChartDataSeries, event: MouseEvent): void;
  nodeCanvasObject(node: ChartDataSeries, ctx: CanvasRenderingContext2D, globalScale: number): void;
  maxZoom: number;
  ref?: { current: unknown };
}

// jsdom has no canvas: the graph is replaced by a component that keeps the
// props the map hands to it and puts methods that record their calls in its
// ref, as the graph does when it mounts.
const graph = vi.hoisted(() => ({
  props: undefined as GraphProps | undefined,
  methods: {} as Record<string, (...args: never[]) => unknown>,
}));
vi.mock("react-force-graph-2d", () => ({
  default: (props: GraphProps) => {
    graph.props = props;
    if (props.ref && props.ref.current !== graph.methods) {
      props.ref.current = graph.methods;
    }
    return <canvas />;
  },
}));

// The stand-ins of the models are no instances of the model classes, so every
// node gets the default tooltip, which renders the application's components.
vi.mock("./tooltips/default-tooltip", () => ({
  DefaultTooltip: ({ obj }: { obj: KubeObject }) => <p>default {obj.getName()}</p>,
}));

// The stores, the namespace store, whose onContextChange is a reaction to the
// selection as in the application, the kinds that the user may list, and where
// a click on a node goes.
const host = {
  stores: {} as Record<string, FakeStore>,
  namespaceStore: {} as object,
  listable: new Set<string>(),
  logger: fakeLogger(),
  showDetails: vi.fn(),
  showHelmRelease: vi.fn(),
};

const dependencies = () =>
  ({
    stores: host.stores,
    apis: {},
    namespaceStore: host.namespaceStore,
    logger: host.logger,
    subscribeStores: watchApi.subscribeStores,
    canListMapStore: (key: string) => host.listable.has(key),
    getCanvasColors: () => ({ background: "#1e2124", text: "#ffffff" }),
    showDetails: host.showDetails,
    showHelmRelease: host.showHelmRelease,
  }) as unknown as ResourceMapDependencies;

const kinds = {
  pods: "Pod",
  deployments: "Deployment",
  statefulSets: "StatefulSet",
  daemonSets: "DaemonSet",
  services: "Service",
  ingresses: "Ingress",
  pvcs: "PersistentVolumeClaim",
  configMaps: "ConfigMap",
  secrets: "Secret",
};

let selection: IObservableArray<string>;
// The box of the nodes that the graph gives, and the methods that fit the graph to its canvas.
let box: GraphBox;
let fit: ReturnType<typeof fakeFitMethods>;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  FakeResizeObserver.last = undefined;
  host.stores = Object.fromEntries(Object.entries(kinds).map(([key, kind]) => [key, fakeStore(kind)]));
  host.listable = new Set(Object.keys(kinds));
  watchApi.subscriptions = [];
  watchApi.holdLoads = false;
  watchApi.subscribeStores = vi.fn(fakeSubscribeStores);
  host.logger = fakeLogger();
  host.showDetails = vi.fn();
  host.showHelmRelease = vi.fn();
  selection = observable.array(["shop"]);
  host.namespaceStore = {
    onContextChange: (callback: (namespaces: string[]) => void, opts: { fireImmediately?: boolean } = {}) =>
      reaction(() => selection.slice(), callback, { fireImmediately: opts.fireImmediately, equals: compareShallow }),
  };
  const force = { strength: vi.fn(() => force), distance: vi.fn(() => force) };
  graph.props = undefined;
  box = { x: [-200, 200], y: [-150, 150] };
  fit = fakeFitMethods(
    () => box,
    () => ({ width: graph.props?.width ?? 0, height: graph.props?.height ?? 0 }),
  );
  graph.methods = {
    ...fit,
    d3Force: vi.fn(() => force),
    graph2ScreenCoords: vi.fn((x: number, y: number) => ({ x: x + 400, y: y + 300 })),
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const drawnIds = () => graph.props?.graphData.nodes.map((node) => node.id).sort();
const stores = () => Object.values(host.stores);

describe("KubeForceChart", () => {
  it("draws the selected namespaces when a store changes, and nothing of the others", async () => {
    host.stores.pods.items.replace([pod("web-1", "shop"), pod("ledger-1", "billing")]);
    render(<KubeForceChart dependencies={dependencies()} />);
    await waitFor(() => expect(drawnIds()).toEqual(["Pod/shop/web-1"]));

    act(() => {
      runInAction(() => host.stores.pods.items.push(pod("web-2", "shop")));
    });

    expect(drawnIds()).toEqual(["Pod/shop/web-1", "Pod/shop/web-2"]);
  });

  it("draws the namespaces of a new selection", async () => {
    host.stores.pods.items.replace([pod("web-1", "shop"), pod("ledger-1", "billing")]);
    render(<KubeForceChart dependencies={dependencies()} />);
    await waitFor(() => expect(drawnIds()).toEqual(["Pod/shop/web-1"]));

    act(() => {
      selection.replace(["billing"]);
    });

    await waitFor(() => expect(drawnIds()).toEqual(["Pod/billing/ledger-1"]));
  });

  it("follows the selection with one reaction through rebuilds and changes, and with none after the unmount", async () => {
    const observers = () => getObserverTree(selection).observers?.length ?? 0;
    host.stores.pods.items.replace([pod("web-1", "shop"), pod("ledger-1", "billing")]);
    const { unmount } = render(<KubeForceChart dependencies={dependencies()} />);
    await waitFor(() => expect(drawnIds()).toEqual(["Pod/shop/web-1"]));

    act(() => {
      runInAction(() => host.stores.pods.items.push(pod("web-2", "shop")));
    });
    act(() => {
      selection.replace(["billing"]);
    });
    await waitFor(() => expect(drawnIds()).toEqual(["Pod/billing/ledger-1"]));
    act(() => {
      runInAction(() => host.stores.pods.items.push(pod("ledger-2", "billing")));
    });

    expect(drawnIds()).toEqual(["Pod/billing/ledger-1", "Pod/billing/ledger-2"]);
    expect(observers()).toBe(1);

    unmount();

    expect(observers()).toBe(0);
  });

  it("shows the tooltip of the hovered node, and hides it when the pointer leaves", async () => {
    host.stores.pods.items.replace([pod("web-1", "shop")]);
    render(<KubeForceChart dependencies={dependencies()} />);
    await waitFor(() => expect(drawnIds()).toEqual(["Pod/shop/web-1"]));
    const tooltip = screen.getByTestId("resource-map-tooltip");
    expect(tooltip.style.display).toBe("none");

    act(() => graph.props?.onNodeHover(graph.props.graphData.nodes[0], null));

    expect(tooltip.textContent).toBe("default web-1");
    expect(tooltip.style.display).toBe("block");

    act(() => graph.props?.onNodeHover(null, null));

    expect(tooltip.style.display).toBe("none");
  });

  it("gives the graph the size of its container, and the new size when the container resizes", async () => {
    host.stores.pods.items.replace([pod("web-1", "shop")]);
    const { container, unmount } = render(<KubeForceChart dependencies={dependencies()} />);
    await waitFor(() => expect(drawnIds()).toEqual(["Pod/shop/web-1"]));
    const observer = FakeResizeObserver.last;
    expect(observer?.element).toBe(container.querySelector("[data-testid=resource-map-nodes]")?.parentElement);

    act(() => observer?.resize(812.5, 480));

    expect(graph.props).toMatchObject({ width: 812, height: 480 });

    act(() => observer?.resize(1024, 600));

    expect(graph.props).toMatchObject({ width: 1024, height: 600 });

    unmount();

    expect(observer?.disconnected).toBe(true);
  });

  it("opens the details of the object of a node when the node is clicked", async () => {
    const web1 = pod("web-1", "shop");
    Object.assign(web1, { selfLink: "/api/v1/namespaces/shop/pods/web-1" });
    host.stores.pods.items.replace([web1]);
    render(<KubeForceChart dependencies={dependencies()} />);
    await waitFor(() => expect(drawnIds()).toEqual(["Pod/shop/web-1"]));

    act(() => graph.props?.onNodeClick(graph.props.graphData.nodes[0], new MouseEvent("click")));

    expect(host.showDetails).toHaveBeenCalledWith("/api/v1/namespaces/shop/pods/web-1");
    expect(host.showHelmRelease).not.toHaveBeenCalled();
  });

  it("says that there is nothing to draw when the stores hold no object but config maps", async () => {
    host.stores.configMaps.items.replace([kubeObject("ConfigMap", { name: "web-config", namespace: "shop" })]);
    render(<KubeForceChart dependencies={dependencies()} />);

    expect(await screen.findByText("No visualizable resources found in this namespace.")).toBeDefined();
    expect(graph.props).toBeUndefined();
  });

  it("opens a Helm release on its route when its node is clicked", async () => {
    host.stores.secrets.items.replace([
      secret("sh.helm.release.v1.storefront.v1", "shop", "helm.sh/release.v1", { name: "storefront" }),
    ]);
    render(<KubeForceChart dependencies={dependencies()} />);
    await waitFor(() => expect(drawnIds()).toContain("HelmRelease/shop/storefront"));
    const release = graph.props?.graphData.nodes.find((node) => node.kind === "HelmRelease");

    act(() => release && graph.props?.onNodeClick(release, new MouseEvent("click")));

    expect(host.showHelmRelease).toHaveBeenCalledWith({ namespace: "shop", name: "storefront" });
  });

  it("subscribes each store once under React.StrictMode, and stops every subscription when it unmounts", async () => {
    host.stores.pods.items.replace([pod("web-1", "shop")]);
    const { unmount } = render(
      <React.StrictMode>
        <KubeForceChart dependencies={dependencies()} />
      </React.StrictMode>,
    );
    await waitFor(() => expect(drawnIds()).toEqual(["Pod/shop/web-1"]));

    expect(stores().map(watchesOf)).toEqual(stores().map(() => 1));

    unmount();

    expect(stores().map(watchesOf)).toEqual(stores().map(() => 0));
  });

  it("shows a spinner until the watch API has loaded every store, and then draws them", async () => {
    watchApi.holdLoads = true;
    host.stores.pods.items.replace([pod("web-1", "shop")]);
    render(<KubeForceChart dependencies={dependencies()} />);

    expect(graph.props).toBeUndefined();
    act(() => stores().forEach((store) => store !== host.stores.secrets && (store.isLoaded = true)));
    expect(graph.props).toBeUndefined();

    act(() => {
      host.stores.secrets.isLoaded = true;
    });

    expect(drawnIds()).toEqual(["Pod/shop/web-1"]);
  });

  it("draws at once the stores that the watch API has loaded already", () => {
    watchApi.holdLoads = true;
    stores().forEach((store) => (store.isLoaded = true));
    host.stores.pods.items.replace([pod("web-1", "shop")]);

    render(<KubeForceChart dependencies={dependencies()} />);

    expect(drawnIds()).toEqual(["Pod/shop/web-1"]);
  });

  it("leaves the stores to the watch API when the selection changes, and fits the graph again", async () => {
    host.stores.pods.items.replace([pod("web-1", "shop"), pod("ledger-1", "billing")]);
    render(<KubeForceChart dependencies={dependencies()} />);
    await waitFor(() => expect(drawnIds()).toEqual(["Pod/shop/web-1"]));
    act(() => FakeResizeObserver.last?.resize(800, 600));
    act(() => graph.props?.onEngineStop());
    expect(fit.centerAt).toHaveBeenCalledTimes(1);

    act(() => {
      selection.replace(["billing"]);
    });
    act(() => graph.props?.onEngineStop());

    expect(drawnIds()).toEqual(["Pod/billing/ledger-1"]);
    expect(fit.centerAt).toHaveBeenCalledTimes(2);
    expect(watchApi.subscribeStores).toHaveBeenCalledTimes(1);
  });

  it("neither subscribes nor waits for nor draws a kind that the user cannot list", async () => {
    watchApi.holdLoads = true;
    host.listable.delete("secrets");
    host.stores.pods.items.replace([pod("web-1", "shop")]);
    host.stores.secrets.items.replace([secret("db-credentials", "shop")]);
    render(<KubeForceChart dependencies={dependencies()} />);

    act(() => stores().forEach((store) => store !== host.stores.secrets && (store.isLoaded = true)));

    expect(drawnIds()).toEqual(["Pod/shop/web-1"]);
    expect(watchesOf(host.stores.secrets)).toBe(0);
    expect(watchesOf(host.stores.pods)).toBe(1);
  });

  it("logs a list that fails, its own or one that a watch sends again, as a warning, and draws the other kinds", async () => {
    host.stores.pods.items.replace([pod("web-1", "shop")]);
    render(<KubeForceChart dependencies={dependencies()} />);
    await waitFor(() => expect(drawnIds()).toEqual(["Pod/shop/web-1"]));

    const failure = new Error("Failed to load api/v1/secrets");
    watchApi.subscriptions[0]?.onLoadFailure?.(failure);

    expect(host.logger.warn).toHaveBeenCalledWith(
      "[RESOURCE-MAP]: cannot list the objects of a kind of the map",
      failure,
    );
    expect(host.logger.error).not.toHaveBeenCalled();
    expect(drawnIds()).toEqual(["Pod/shop/web-1"]);
  });

  it("sets its forces on the graph once the graph has mounted", async () => {
    host.stores.pods.items.replace([pod("web-1", "shop")]);
    render(<KubeForceChart dependencies={dependencies()} />);
    await waitFor(() => expect(drawnIds()).toEqual(["Pod/shop/web-1"]));

    expect(graph.methods.d3Force).toHaveBeenCalledWith("charge", expect.any(Function));
    expect(graph.methods.d3Force).toHaveBeenCalledWith("collide", expect.any(Function));
    expect(graph.methods.d3Force).toHaveBeenCalledWith("center", expect.any(Function));
  });

  it("marks itself settled, with the points of its nodes, when the graph stops, and not when its data changes", async () => {
    host.stores.pods.items.replace([pod("web-1", "shop")]);
    const { container } = render(<KubeForceChart dependencies={dependencies()} />);
    await waitFor(() => expect(drawnIds()).toEqual(["Pod/shop/web-1"]));
    const map = () => container.querySelector("[data-settled]");
    expect(map()).toBeNull();

    act(() => graph.props?.onEngineStop());

    expect(map()).not.toBeNull();
    const item = screen.getByTestId("resource-map-nodes").querySelector("li");
    expect(item?.dataset).toMatchObject({ kind: "Pod", namespace: "shop", name: "web-1", x: "400", y: "300" });

    act(() => {
      runInAction(() => host.stores.pods.items.push(pod("web-2", "shop")));
    });

    expect(map()).toBeNull();
    expect(screen.getByTestId("resource-map-nodes").children).toHaveLength(0);
  });

  const fits: [string, number, GraphBox][] = [
    ["of more than ten nodes", 11, { x: [-200, 200], y: [-150, 150] }],
    ["of ten nodes or fewer, larger than the canvas at a zoom of 1.2", 1, { x: [-300, 300], y: [-300, 300] }],
    ["of ten nodes or fewer, smaller than the canvas", 1, { x: [-40, 40], y: [-30, 30] }],
  ];
  it.each(fits)(
    "fits to its canvas a graph %s, the names below the nodes of the bottom row included",
    async (_case, count, nodesBox) => {
      box = nodesBox;
      host.stores.pods.items.replace(Array.from({ length: count }, (_, index) => pod(`web-${index}`, "shop")));
      render(<KubeForceChart dependencies={dependencies()} />);
      await waitFor(() => expect(drawnIds()).toHaveLength(count));
      act(() => FakeResizeObserver.last?.resize(800, 600));

      act(() => graph.props?.onEngineStop());

      const props = graph.props as GraphProps;
      const view = boxOnCanvas(fit, box, props);
      expect(view.zoom).toBeLessThanOrEqual(count > 10 ? props.maxZoom : 1.2);
      expect(view.left).toBeGreaterThanOrEqual(0);
      expect(view.right).toBeLessThanOrEqual(props.width);
      expect(view.top).toBeGreaterThanOrEqual(0);
      // The box holds the circles of the nodes: the name of a node of the bottom row reaches below it.
      const name = nameBelowCircle(props.nodeCanvasObject, props.graphData.nodes[0], view.zoom);
      expect(view.bottom + name).toBeLessThanOrEqual(props.height);
    },
  );

  it("refreshes in place the node of an object that its store replaces, as the store does for a change of the object", async () => {
    host.stores.pods.items.replace([pod("web-1", "shop")]);
    render(<KubeForceChart dependencies={dependencies()} />);
    await waitFor(() => expect(drawnIds()).toEqual(["Pod/shop/web-1"]));
    const data = graph.props?.graphData;
    const failed = pod("web-1", "shop", { status: "Failed" });

    // The store replaces the object of a watch event where it is: the array keeps its length.
    act(() => runInAction(() => host.stores.pods.items.splice(0, 1, failed)));

    expect(graph.props?.graphData).toBe(data);
    const node = graph.props?.graphData.nodes.find((candidate) => candidate.id === "Pod/shop/web-1");
    expect(node?.object).toBe(failed);
    expect(node?.color).toBe("#ce3933");
  });

  it("takes the points of its nodes again when its container resizes, as the graph keeps the center of its view", async () => {
    host.stores.pods.items.replace([pod("web-1", "shop")]);
    render(<KubeForceChart dependencies={dependencies()} />);
    await waitFor(() => expect(drawnIds()).toEqual(["Pod/shop/web-1"]));
    act(() => FakeResizeObserver.last?.resize(800, 600));
    act(() => graph.props?.onEngineStop());
    const item = () => screen.getByTestId("resource-map-nodes").querySelector("li");
    expect(item()?.dataset).toMatchObject({ x: "400", y: "300" });

    // On a canvas 200 px narrower and 100 px lower, the center of the view moves 100 px left and 50 px up.
    graph.methods.graph2ScreenCoords = vi.fn((x: number, y: number) => ({ x: x + 300, y: y + 250 }));
    act(() => FakeResizeObserver.last?.resize(600, 500));

    expect(item()?.dataset).toMatchObject({ x: "300", y: "250" });
  });
});
