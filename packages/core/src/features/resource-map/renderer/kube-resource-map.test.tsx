/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { compareShallow, getObserverTree, observable, reaction, runInAction } from "mobx";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KubeResourceMap } from "./kube-resource-map";
import { boxOnCanvas, fakeFitMethods } from "./test-utils/canvas";
import { fakeLogger } from "./test-utils/fake-logger";
import { kubeObject, pod, secret } from "./test-utils/kube-objects";

import type { Deployment, Ingress, KubeObject, Pod, Service } from "@freelensapp/kube-object";

import type { IObservableArray } from "mobx";

import type { ResourceMapDependencies } from "./dependencies";
import type { MapCard } from "./helpers/card-graph";
import type { GraphBox } from "./test-utils/canvas";

// A store, as far as the map reads it: its items in an observable array, and
// whether the watch API has loaded it, observable as in the application. The
// pods of a workload are those labelled with its name.
interface FakeStore {
  api: { kind: string };
  items: IObservableArray<KubeObject>;
  isLoaded: boolean;
  getChildPods(controller: KubeObject): Pod[];
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
    getChildPods: (controller) =>
      (host.stores.pods.items as unknown as Pod[]).filter(
        (each) => each.metadata.labels?.app === controller.getName() && each.getNs() === controller.getNs(),
      ),
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

interface DrawnCard {
  id: string;
  card: MapCard;
  x: number;
  y: number;
  fx: number;
  fy: number;
}

interface DrawnEdge {
  id: string;
  source: string;
  target: string;
  route: { start: { x: number; y: number } };
}

interface GraphProps {
  graphData: { nodes: DrawnCard[]; links: DrawnEdge[] };
  width: number;
  height: number;
  cooldownTicks: number;
  enableNodeDrag: boolean;
  onNodeHover(node: DrawnCard | null, previous: DrawnCard | null): void;
  onNodeClick(node: DrawnCard, event: MouseEvent): void;
  onBackgroundClick(event: MouseEvent): void;
  nodeCanvasObject(node: DrawnCard, ctx: CanvasRenderingContext2D, globalScale: number): void;
  linkCanvasObject(link: DrawnEdge, ctx: CanvasRenderingContext2D, globalScale: number): void;
  onRenderFramePost(ctx: CanvasRenderingContext2D, globalScale: number): void;
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

// The application's Icon takes its logger from the injection container, which the map is rendered without.
vi.mock("@freelensapp/icon", () => ({
  Icon: ({ material, onClick, ...props }: { material?: string; onClick?: () => void; "aria-label"?: string }) => (
    <i role={onClick ? "button" : undefined} aria-label={props["aria-label"]} onClick={onClick}>
      {material}
    </i>
  ),
}));

// The stores, the namespace store, whose onContextChange is a reaction to the
// selection as in the application, the kinds that the user may list, and where
// a click goes.
const host = {
  stores: {} as Record<string, FakeStore>,
  namespaceStore: {} as object,
  listable: new Set<string>(),
  logger: fakeLogger(),
  showDetails: vi.fn(),
  showHelmRelease: vi.fn(),
};

const canvasColors = {
  background: "#1e2124",
  text: "#ffffff",
  secondaryText: "#a0a0a0",
  card: "#1f2123",
  border: "#4c5053",
  selected: "#00a7a0",
};

const dependencies = () =>
  ({
    stores: host.stores,
    apis: {},
    namespaceStore: host.namespaceStore,
    logger: host.logger,
    subscribeStores: watchApi.subscribeStores,
    canListMapStore: (key: string) => host.listable.has(key),
    getCanvasColors: () => canvasColors,
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
  graph.props = undefined;
  fit = fakeFitMethods(
    () => ({ x: [0, 0], y: [0, 0] }),
    () => ({ width: graph.props?.width ?? 0, height: graph.props?.height ?? 0 }),
  );
  graph.methods = {
    ...fit,
    graph2ScreenCoords: vi.fn((x: number, y: number) => ({ x: x + 400, y: y + 300 })),
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const props = () => graph.props as GraphProps;
const drawnIds = () => graph.props?.graphData.nodes.map((node) => node.id).sort();
const stores = () => Object.values(host.stores);

describe("KubeResourceMap", () => {
  it("draws the selected namespaces when a store changes, and nothing of the others", async () => {
    host.stores.pods.items.replace([pod("web-1", "shop"), pod("ledger-1", "billing")]);
    render(<KubeResourceMap dependencies={dependencies()} />);
    await waitFor(() => expect(drawnIds()).toEqual(["Pod/shop/web-1"]));

    act(() => {
      runInAction(() => host.stores.pods.items.push(pod("web-2", "shop")));
    });

    expect(drawnIds()).toEqual(["Pod/shop/web-1", "Pod/shop/web-2"]);
  });

  it("draws the namespaces of a new selection", async () => {
    host.stores.pods.items.replace([pod("web-1", "shop"), pod("ledger-1", "billing")]);
    render(<KubeResourceMap dependencies={dependencies()} />);
    await waitFor(() => expect(drawnIds()).toEqual(["Pod/shop/web-1"]));

    act(() => {
      selection.replace(["billing"]);
    });

    await waitFor(() => expect(drawnIds()).toEqual(["Pod/billing/ledger-1"]));
  });

  it("follows the selection with one reaction through rebuilds and changes, and with none after the unmount", async () => {
    const observers = () => getObserverTree(selection).observers?.length ?? 0;
    host.stores.pods.items.replace([pod("web-1", "shop"), pod("ledger-1", "billing")]);
    const { unmount } = render(<KubeResourceMap dependencies={dependencies()} />);
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

  it("shows the tooltip of the hovered card, and hides it when the pointer leaves", async () => {
    host.stores.pods.items.replace([pod("web-1", "shop")]);
    render(<KubeResourceMap dependencies={dependencies()} />);
    await waitFor(() => expect(drawnIds()).toEqual(["Pod/shop/web-1"]));
    const tooltip = screen.getByTestId("resource-map-tooltip");
    expect(tooltip.style.display).toBe("none");

    act(() => props().onNodeHover(props().graphData.nodes[0], null));

    expect(tooltip.textContent).toBe("default web-1");
    expect(tooltip.style.display).toBe("block");

    act(() => props().onNodeHover(null, null));

    expect(tooltip.style.display).toBe("none");
  });

  it("gives the graph the size of its container, and the new size when the container resizes", async () => {
    host.stores.pods.items.replace([pod("web-1", "shop")]);
    const { container, unmount } = render(<KubeResourceMap dependencies={dependencies()} />);
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

  it("opens the details of the object of a card when the card is clicked", async () => {
    const web1 = pod("web-1", "shop");
    Object.assign(web1, { selfLink: "/api/v1/namespaces/shop/pods/web-1" });
    host.stores.pods.items.replace([web1]);
    render(<KubeResourceMap dependencies={dependencies()} />);
    await waitFor(() => expect(drawnIds()).toEqual(["Pod/shop/web-1"]));

    act(() => props().onNodeClick(props().graphData.nodes[0], new MouseEvent("click")));

    expect(host.showDetails).toHaveBeenCalledWith("/api/v1/namespaces/shop/pods/web-1");
    expect(host.showHelmRelease).not.toHaveBeenCalled();
  });

  it("says that there is nothing to draw when the stores hold no object but config maps", async () => {
    host.stores.configMaps.items.replace([kubeObject("ConfigMap", { name: "web-config", namespace: "shop" })]);
    render(<KubeResourceMap dependencies={dependencies()} />);

    expect(await screen.findByText("No visualizable resources found in this namespace.")).toBeDefined();
    expect(graph.props).toBeUndefined();
  });

  it("subscribes each store once under React.StrictMode, and stops every subscription when it unmounts", async () => {
    host.stores.pods.items.replace([pod("web-1", "shop")]);
    const { unmount } = render(
      <React.StrictMode>
        <KubeResourceMap dependencies={dependencies()} />
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
    render(<KubeResourceMap dependencies={dependencies()} />);

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

    render(<KubeResourceMap dependencies={dependencies()} />);

    expect(drawnIds()).toEqual(["Pod/shop/web-1"]);
  });

  it("leaves the stores to the watch API when the selection changes, and fits the map again", async () => {
    host.stores.pods.items.replace([pod("web-1", "shop"), pod("ledger-1", "billing")]);
    render(<KubeResourceMap dependencies={dependencies()} />);
    await waitFor(() => expect(drawnIds()).toEqual(["Pod/shop/web-1"]));
    act(() => FakeResizeObserver.last?.resize(800, 600));
    expect(fit.centerAt).toHaveBeenCalledTimes(1);

    act(() => {
      selection.replace(["billing"]);
    });

    expect(drawnIds()).toEqual(["Pod/billing/ledger-1"]);
    expect(fit.centerAt).toHaveBeenCalledTimes(2);
    expect(watchApi.subscribeStores).toHaveBeenCalledTimes(1);
  });

  it("neither subscribes nor waits for nor draws a kind that the user cannot list", async () => {
    watchApi.holdLoads = true;
    host.listable.delete("secrets");
    host.stores.pods.items.replace([pod("web-1", "shop")]);
    host.stores.secrets.items.replace([secret("db-credentials", "shop")]);
    render(<KubeResourceMap dependencies={dependencies()} />);

    act(() => stores().forEach((store) => store !== host.stores.secrets && (store.isLoaded = true)));

    expect(drawnIds()).toEqual(["Pod/shop/web-1"]);
    expect(watchesOf(host.stores.secrets)).toBe(0);
    expect(watchesOf(host.stores.pods)).toBe(1);
  });

  it("logs a list that fails, its own or one that a watch sends again, as a warning, and draws the other kinds", async () => {
    host.stores.pods.items.replace([pod("web-1", "shop")]);
    render(<KubeResourceMap dependencies={dependencies()} />);
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

  it("pins every card where the layout puts it, and lets the graph only pan and zoom", async () => {
    host.stores.pods.items.replace([pod("web-1", "shop"), pod("web-2", "shop")]);
    render(<KubeResourceMap dependencies={dependencies()} />);
    await waitFor(() => expect(drawnIds()).toHaveLength(2));

    expect(props()).toMatchObject({ cooldownTicks: 0, enableNodeDrag: false });
    for (const node of props().graphData.nodes) {
      expect(node).toMatchObject({ fx: node.x, fy: node.y });
    }
  });

  it("marks itself settled, with the points of its cards, once laid out and fitted, and not when its cards change", async () => {
    host.stores.pods.items.replace([pod("web-1", "shop")]);
    const { container } = render(<KubeResourceMap dependencies={dependencies()} />);
    await waitFor(() => expect(drawnIds()).toEqual(["Pod/shop/web-1"]));
    const map = () => container.querySelector("[data-settled]");
    expect(map()).toBeNull();

    act(() => FakeResizeObserver.last?.resize(800, 600));

    expect(map()).not.toBeNull();
    const item = screen.getByTestId("resource-map-nodes").querySelector("li");
    expect(item?.dataset).toMatchObject({ kind: "Pod", namespace: "shop", name: "web-1", x: "400", y: "300" });

    act(() => {
      runInAction(() => host.stores.pods.items.push(pod("web-2", "shop")));
    });

    expect(map()).toBeNull();
    expect(screen.getByTestId("resource-map-nodes").children).toHaveLength(0);
  });

  it("fits the whole cards and the headers of the columns to its canvas", async () => {
    host.stores.pods.items.replace([pod("web-1", "shop")]);
    render(<KubeResourceMap dependencies={dependencies()} />);
    await waitFor(() => expect(drawnIds()).toEqual(["Pod/shop/web-1"]));

    act(() => FakeResizeObserver.last?.resize(800, 600));

    // The card of 200 × 56 centred on the origin, and the header of its column above it.
    const [node] = props().graphData.nodes;
    const box: GraphBox = { x: [node.x - 100, node.x + 100], y: [node.y - 28 - 26, node.y + 28] };
    const view = boxOnCanvas(fit, box, { width: 800, height: 600, maxZoom: 4 });
    expect(view.zoom).toBeLessThanOrEqual(1.25);
    expect(view.left).toBeGreaterThanOrEqual(0);
    expect(view.right).toBeLessThanOrEqual(800);
    expect(view.top).toBeGreaterThanOrEqual(0);
    expect(view.bottom).toBeLessThanOrEqual(600);
  });

  it("fits a new layout too large to read at a readable zoom, from its top left corner, and the Fit button fits it all", async () => {
    host.stores.pods.items.replace(Array.from({ length: 40 }, (_, index) => pod(`job-${index}`, "shop")));
    render(<KubeResourceMap dependencies={dependencies()} />);
    await waitFor(() => expect(drawnIds()).toHaveLength(40));

    act(() => FakeResizeObserver.last?.resize(600, 400));

    // The top left of the first card, and of the header above it.
    const nodes = props().graphData.nodes;
    const left = Math.min(...nodes.map((node) => node.x)) - 100;
    const top = Math.min(...nodes.map((node) => node.y)) - 28 - 26;
    const view = boxOnCanvas(fit, { x: [left, left], y: [top, top] }, { width: 600, height: 400, maxZoom: 4 });
    expect(view.zoom).toBe(0.8);
    expect(view.left).toBeCloseTo(48);
    expect(view.top).toBeCloseTo(48);

    fireEvent.click(screen.getByRole("button", { name: "Fit the map to the view" }));

    expect(fit.zoom()).toBeLessThan(0.8);
  });

  it("refreshes in place the card of a pod that its store replaces, as the store does for a change of the object", async () => {
    host.stores.pods.items.replace([pod("web-1", "shop")]);
    render(<KubeResourceMap dependencies={dependencies()} />);
    await waitFor(() => expect(drawnIds()).toEqual(["Pod/shop/web-1"]));
    const data = props().graphData;
    const failed = pod("web-1", "shop", { status: "CrashLoopBackOff" });

    // The store replaces the object of a watch event where it is: the array keeps its length.
    act(() => runInAction(() => host.stores.pods.items.splice(0, 1, failed)));

    expect(props().graphData).toBe(data);
    const { card } = props().graphData.nodes[0];
    expect(card.object).toBe(failed);
    expect(card.pods.map(({ status }) => status)).toEqual(["failed"]);
  });

  it("takes the points of its cards again when its container resizes, as the graph keeps the center of its view", async () => {
    host.stores.pods.items.replace([pod("web-1", "shop")]);
    render(<KubeResourceMap dependencies={dependencies()} />);
    await waitFor(() => expect(drawnIds()).toEqual(["Pod/shop/web-1"]));
    act(() => FakeResizeObserver.last?.resize(800, 600));
    const item = () => screen.getByTestId("resource-map-nodes").querySelector("li");
    expect(item()?.dataset).toMatchObject({ x: "400", y: "300" });

    // On a canvas 200 px narrower and 100 px lower, the center of the view moves 100 px left and 50 px up.
    graph.methods.graph2ScreenCoords = vi.fn((x: number, y: number) => ({ x: x + 300, y: y + 250 }));
    act(() => FakeResizeObserver.last?.resize(600, 500));

    expect(item()?.dataset).toMatchObject({ x: "300", y: "250" });
  });

  describe("over its canvas", () => {
    const nodeOf = (id: string) => props().graphData.nodes.find((node) => node.id === id) as DrawnCard;
    const linkOf = (id: string) => props().graphData.links.find((link) => link.id === id) as DrawnEdge;

    // A context that paints nothing and records what is painted, in order: the strokes, each with its opacity,
    // its width and where its path starts, and the texts.
    function recorder() {
      const record: { op: "stroke" | "text"; alpha: number; width: number; from?: string; text?: string }[] = [];
      const state: Record<string, unknown> = { globalAlpha: 1, lineWidth: 1 };
      let from: string | undefined;
      const ctx = new Proxy(state, {
        get: (target, key) => {
          // About as wide as the 11 px text of a card.
          if (key === "measureText") return (text: string) => ({ width: text.length * 5 });
          if (key === "beginPath") return () => (from = undefined);
          if (key === "moveTo") return (x: number, y: number) => (from = `${x},${y}`);
          if (key === "stroke") {
            return () =>
              record.push({
                op: "stroke",
                alpha: target.globalAlpha as number,
                width: target.lineWidth as number,
                from,
              });
          }
          if (key === "fillText") {
            return (text: string) => record.push({ op: "text", alpha: target.globalAlpha as number, width: 0, text });
          }
          return key in target ? target[key as string] : () => {};
        },
        set: (target, key, value) => {
          target[key as string] = value;
          return true;
        },
      });
      return { ctx: ctx as unknown as CanvasRenderingContext2D, record };
    }

    // How the map strokes an edge, whether force-graph paints it with the others or the map over the cards.
    const strokeOf = (id: string) => {
      const link = linkOf(id);
      const start = `${link.route.start.x},${link.route.start.y}`;
      const withTheOthers = recorder();
      props().linkCanvasObject(link, withTheOthers.ctx, 1);
      const over = recorder();
      props().onRenderFramePost(over.ctx, 1);
      const stroke = [...withTheOthers.record, ...over.record].find(
        (each) => each.op === "stroke" && each.from === start,
      );
      return stroke && { alpha: stroke.alpha, width: stroke.width };
    };
    // The texts that force-graph paints for a card, with the others.
    const textsOf = (id: string) => {
      const { ctx, record } = recorder();
      props().nodeCanvasObject(nodeOf(id), ctx, 1);
      return record.filter((each) => each.op === "text").map((each) => each.text);
    };
    const highlighted = { alpha: 1, width: 2.5 };
    const faded = { alpha: 0.1, width: 1.5 };
    const atRest = { alpha: 0.8, width: 1.5 };

    const deployment = "Deployment/shop/web";
    const credentials = "Secret/shop/credentials";
    const webConfig = "ConfigMap/shop/web-config";
    const toWeb = `Ingress/shop/web->${deployment}`;
    const toCredentials = `${deployment}->${credentials}`;
    const adminToCredentials = `Pod/shop/admin-1->${credentials}`;

    // An Ingress in front of the Service of a Deployment of two pods, of the Helm release "storefront", which
    // alone read a config map; the Service of a pod of its own; a secret that the pods of both read, and one that
    // nothing uses. The map folds both Services, which select one card each, and the config map into their cards.
    async function renderShop() {
      const reads = (app: string, spec: Parameters<typeof pod>[2] = {}) => ({
        labels: { app },
        containers: [
          {
            name: app,
            env: [{ name: "PASSWORD", valueFrom: { secretKeyRef: { name: "credentials" } } }],
            envFrom: app === "web" ? [{ configMapRef: { name: "web-config" } }] : [],
          },
        ],
        ...spec,
      });
      host.stores.pods.items.replace([
        pod("web-7d9c5-x2x4p", "shop", reads("web")),
        pod("web-7d9c5-q8n2k", "shop", reads("web", { status: "Pending" })),
        pod("admin-1", "shop", reads("admin")),
      ]);
      host.stores.deployments.items.replace([
        kubeObject<Deployment>("Deployment", {
          name: "web",
          namespace: "shop",
          labels: { "app.kubernetes.io/managed-by": "Helm" },
          annotations: { "meta.helm.sh/release-name": "storefront" },
        }),
      ]);
      host.stores.services.items.replace(
        ["web", "admin"].map((name) =>
          kubeObject<Service>("Service", { name, namespace: "shop" }, { spec: { selector: { app: name } } }),
        ),
      );
      host.stores.ingresses.items.replace([
        kubeObject<Ingress>(
          "Ingress",
          { name: "web", namespace: "shop" },
          { spec: { rules: [{ http: { paths: [{ backend: { service: { name: "web" } } }] } }] } },
        ),
      ]);
      host.stores.secrets.items.replace([secret("credentials", "shop"), secret("orphan", "shop")]);
      host.stores.configMaps.items.replace([kubeObject("ConfigMap", { name: "web-config", namespace: "shop" })]);
      const result = render(<KubeResourceMap dependencies={dependencies()} />);
      await waitFor(() => expect(drawnIds()).toHaveLength(5));
      return result;
    }

    it("folds pods, a Service of one card and a config map of one into their cards, in columns left to right", async () => {
      await renderShop();

      expect(drawnIds()).toEqual([
        deployment,
        "Ingress/shop/web",
        "Pod/shop/admin-1",
        credentials,
        "Secret/shop/orphan",
      ]);
      expect(nodeOf(deployment).card.pods.map(({ name, status }) => [name, status])).toEqual([
        ["web-7d9c5-q8n2k", "pending"],
        ["web-7d9c5-x2x4p", "running"],
      ]);
      // The Ingress calls the Deployment that its Service selects, and the Services column is gone.
      expect(
        props()
          .graphData.links.map((link) => link.id)
          .sort(),
      ).toEqual([toWeb, toCredentials, adminToCredentials].sort());
      const x = (id: string) => nodeOf(id).x;
      expect(x("Ingress/shop/web")).toBeLessThan(x(deployment));
      expect(x(deployment)).toBe(x("Pod/shop/admin-1"));
      expect(x(deployment)).toBeLessThan(x(credentials));
      // The second line names the kind in full and counts what the card holds: a Service and a config map.
      expect(textsOf(deployment)).toEqual(["web", "Deployment · +2", "1/2"]);
    });

    it("shows a chip per kind and per release, the unlinked cards, the folding, the numbers and the health of pods", async () => {
      await renderShop();

      for (const name of [
        "Ingress (1)",
        "Service (2)",
        "Deployment (1)",
        "Pod (1)",
        "Config Map (1)",
        "Secret (2)",
        "Unlinked (1)",
      ]) {
        expect(screen.getByRole("button", { name }).getAttribute("aria-pressed")).toBe("true");
      }
      expect(screen.getByRole("button", { name: "Show every object (3)" }).getAttribute("aria-pressed")).toBe("false");
      expect(screen.getByRole("button", { name: "Helm release storefront (1)" }).getAttribute("aria-pressed")).toBe(
        "false",
      );
      // The folded objects count among the resources; the numbers sit under the canvas, not over its cards.
      const numbers = screen.getByText("8 resources · 3 pods · 3 links");
      expect(FakeResizeObserver.last?.element?.contains(numbers)).toBe(false);
      for (const label of ["Running", "Pending / not ready", "Failed", "Completed / terminating"]) {
        expect(screen.getByText(label)).toBeDefined();
      }
    });

    it("shows every object as a card of its own when its chip is pressed, and folds them again", async () => {
      await renderShop();
      const chip = screen.getByRole("button", { name: "Show every object (3)" });

      fireEvent.click(chip);

      expect(chip.getAttribute("aria-pressed")).toBe("true");
      expect(drawnIds()).toEqual(expect.arrayContaining(["Service/shop/web", "Service/shop/admin", webConfig]));
      expect(props().graphData.links.map((link) => link.id)).toEqual(
        expect.arrayContaining([`Service/shop/web->${deployment}`, `${deployment}->${webConfig}`]),
      );
      expect(textsOf(deployment)).toEqual(["web", "Deployment", "1/2"]);
      expect(screen.getByText("8 resources · 3 pods · 6 links")).toBeDefined();

      fireEvent.click(chip);

      expect(drawnIds()).toHaveLength(5);
    });

    it("brings forward the chain of the hovered card, callers and dependencies, and fades the rest less", async () => {
      await renderShop();
      expect(strokeOf(toWeb)).toEqual(atRest);

      act(() => props().onNodeHover(nodeOf(deployment), null));

      expect([toWeb, toCredentials].map(strokeOf)).toEqual([highlighted, highlighted]);
      expect(strokeOf(adminToCredentials)).toEqual(faded);
    });

    it("paints the chain over the faded cards: its edges first, then its cards, whose text no edge crosses", async () => {
      await renderShop();

      act(() => props().onNodeHover(nodeOf(deployment), null));

      // force-graph paints the faded cards, at 45 %, and none of the chain.
      expect(textsOf(deployment)).toEqual([]);
      const { ctx, record } = recorder();
      props().nodeCanvasObject(nodeOf("Secret/shop/orphan"), ctx, 1);
      expect(record.find((each) => each.op === "text")?.alpha).toBe(0.45);
      // The map paints the chain over them: the edges, then the cards.
      const over = recorder();
      props().onRenderFramePost(over.ctx, 1);
      const edges = over.record.filter((each) => each.op === "stroke" && each.from).length;
      const firstText = over.record.findIndex((each) => each.op === "text");
      expect(edges).toBe(2);
      expect(over.record.slice(firstText).some((each) => each.op === "stroke" && each.from)).toBe(false);
      expect(over.record.filter((each) => each.op === "text").map((each) => each.text)).toEqual(
        expect.arrayContaining(["web", "Ingress", "credentials"]),
      );
    });

    it("keeps the chain of a clicked card forward until the background is clicked or Escape is pressed", async () => {
      await renderShop();

      act(() => props().onNodeClick(nodeOf(deployment), new MouseEvent("click")));
      act(() => props().onNodeHover(null, null));

      expect(strokeOf(adminToCredentials)).toEqual(faded);

      act(() => {
        fireEvent.keyDown(window, { key: "Escape" });
      });

      expect(strokeOf(adminToCredentials)).toEqual(atRest);

      act(() => props().onNodeClick(nodeOf(deployment), new MouseEvent("click")));
      act(() => props().onBackgroundClick(new MouseEvent("click")));

      expect(strokeOf(adminToCredentials)).toEqual(atRest);
    });

    it("lets go of the hovered card when the pointer leaves the graph, for an overlay or out of the map", async () => {
      const { container } = await renderShop();
      const tooltip = screen.getByTestId("resource-map-tooltip");
      act(() => props().onNodeHover(nodeOf("Pod/shop/admin-1"), null));
      expect(tooltip.style.display).toBe("block");

      fireEvent.mouseLeave(container.querySelector("canvas")?.parentElement as HTMLElement);

      expect(tooltip.style.display).toBe("none");
      // The chain of the card that was hovered does not outrank the release that a chip then focuses.
      fireEvent.click(screen.getByRole("button", { name: "Helm release storefront (1)" }));
      expect(strokeOf(toWeb)).toEqual(highlighted);
      expect(strokeOf(adminToCredentials)).toEqual(faded);
    });

    it("anchors the tooltip of the hovered card below it, and lists what the card holds", async () => {
      await renderShop();
      const canvas = FakeResizeObserver.last?.element as HTMLElement;
      const tooltip = screen.getByTestId("resource-map-tooltip");
      Object.defineProperties(canvas, { clientWidth: { value: 1600 }, clientHeight: { value: 1200 } });
      Object.defineProperties(tooltip, { offsetWidth: { value: 300 }, offsetHeight: { value: 120 } });

      act(() => props().onNodeHover(nodeOf(deployment), null));

      // At the zoom of 1, a card is 200 × 56 px, its top left corner where graph2ScreenCoords puts it.
      const { x, y } = nodeOf(deployment);
      expect(tooltip.style.left).toBe(`${x - 100 + 400}px`);
      expect(tooltip.style.top).toBe(`${y - 28 + 300 + 56 + 8}px`);
      const includes = screen.getByTestId("resource-map-tooltip-includes");
      expect(includes.textContent).toBe("IncludesServicewebConfig Mapweb-config");

      act(() => props().onNodeHover(nodeOf("Secret/shop/orphan"), null));

      expect(screen.queryByTestId("resource-map-tooltip-includes")).toBeNull();
    });

    it("finds cards by the names of their pods, their release and what they hold, centres the view on each in turn, and clears on Escape", async () => {
      await renderShop();
      const search = screen.getByRole("searchbox", { name: "Find a resource on the map" }) as HTMLInputElement;

      fireEvent.change(search, { target: { value: "Q8N2K" } });

      expect(screen.getByRole("status").textContent).toBe("1 match");
      fireEvent.keyDown(search, { key: "Enter" });
      expect(fit.centerAt).toHaveBeenLastCalledWith(nodeOf(deployment).x, nodeOf(deployment).y, 400);
      expect(screen.getByRole("status").textContent).toBe("1 of 1");

      fireEvent.change(search, { target: { value: "storefront" } });
      expect(screen.getByRole("status").textContent).toBe("1 match");
      fireEvent.change(search, { target: { value: "web-config" } });
      expect(screen.getByRole("status").textContent).toBe("1 match");
      fireEvent.change(search, { target: { value: "ledger" } });
      expect(screen.getByRole("status").textContent).toBe("No match");

      fireEvent.keyDown(search, { key: "Escape" });

      expect(search.value).toBe("");
      expect(screen.queryByRole("status")).toBeNull();
    });

    it("lays the map out again without a hidden kind, keeps its chip, and fits it again", async () => {
      await renderShop();
      act(() => FakeResizeObserver.last?.resize(800, 600));
      const fits = fit.centerAt.mock.calls.length;
      const secrets = screen.getByRole("button", { name: "Secret (2)" });

      fireEvent.click(secrets);

      expect(drawnIds()).not.toContain(credentials);
      expect(props().graphData.links.map((link) => link.id)).toEqual([toWeb]);
      expect(secrets.getAttribute("aria-pressed")).toBe("false");
      expect(screen.getByText("6 resources · 3 pods · 1 link · 2 hidden")).toBeDefined();
      expect(fit.centerAt.mock.calls.length).toBe(fits + 1);

      fireEvent.click(screen.getByRole("button", { name: "Show all" }));

      expect(drawnIds()).toHaveLength(5);
    });

    it("leaves a hidden kind out of what the cards hold", async () => {
      await renderShop();

      fireEvent.click(screen.getByRole("button", { name: "Config Map (1)" }));

      expect(textsOf(deployment)).toEqual(["web", "Deployment · +1", "1/2"]);
      expect(screen.getByText("7 resources · 3 pods · 3 links · 1 hidden")).toBeDefined();
      expect(screen.getByRole("button", { name: "Show every object (2)" })).toBeDefined();
    });

    it("hides and shows the cards without an edge", async () => {
      await renderShop();

      fireEvent.click(screen.getByRole("button", { name: "Unlinked (1)" }));

      expect(drawnIds()).not.toContain("Secret/shop/orphan");
      expect(screen.getByRole("button", { name: "Unlinked (1)" }).getAttribute("aria-pressed")).toBe("false");

      fireEvent.click(screen.getByRole("button", { name: "Unlinked (1)" }));

      expect(drawnIds()).toContain("Secret/shop/orphan");
    });

    it("focuses a release with its chip, with the chains of its cards, and opens it", async () => {
      await renderShop();
      const chip = screen.getByRole("button", { name: "Helm release storefront (1)" });

      fireEvent.click(chip);

      expect(chip.getAttribute("aria-pressed")).toBe("true");
      expect([toWeb, toCredentials].map(strokeOf)).toEqual([highlighted, highlighted]);
      expect(strokeOf(adminToCredentials)).toEqual(faded);

      fireEvent.click(screen.getByRole("button", { name: "Open release" }));

      expect(host.showHelmRelease).toHaveBeenCalledWith({ namespace: "shop", name: "storefront" });

      fireEvent.click(chip);

      expect(screen.queryByRole("button", { name: "Open release" })).toBeNull();
      expect(strokeOf(adminToCredentials)).toEqual(atRest);
    });

    it("says that every kind is hidden in place of an empty canvas, and shows them all again", async () => {
      const { container } = await renderShop();

      for (const name of ["Ingress (1)", "Service (2)", "Deployment (1)", "Pod (1)", "Config Map (1)", "Secret (2)"]) {
        fireEvent.click(screen.getByRole("button", { name }));
      }

      const status = screen.getByText("All kinds are hidden.").parentElement as HTMLElement;
      expect(container.querySelector("canvas")).toBeNull();

      fireEvent.click(within(status).getByRole("button", { name: "Show all" }));

      expect(container.querySelector("canvas")).not.toBeNull();
      expect(drawnIds()).toHaveLength(5);
    });

    it("lists its cards out of sight, once settled", async () => {
      await renderShop();

      act(() => FakeResizeObserver.last?.resize(800, 600));

      const listed = [...screen.getByTestId("resource-map-nodes").children].map((item) =>
        (item as HTMLElement).getAttribute("data-kind"),
      );
      expect(listed.sort()).toEqual(["Deployment", "Ingress", "Pod", "Secret", "Secret"]);
    });

    describe("with a hub", () => {
      // Five pods that read a shared secret, the hub, and four of them a team secret, which is not one.
      async function renderHub() {
        host.stores.pods.items.replace(
          Array.from({ length: 5 }, (_, index) =>
            pod(`pod-${index}`, "shop", {
              labels: { app: `pod-${index}` },
              containers: [
                {
                  name: "app",
                  env: [
                    { name: "SHARED", valueFrom: { secretKeyRef: { name: "shared" } } },
                    ...(index < 4 ? [{ name: "TEAM", valueFrom: { secretKeyRef: { name: "team" } } }] : []),
                  ],
                },
              ],
            }),
          ),
        );
        host.stores.secrets.items.replace([secret("shared", "shop"), secret("team", "shop")]);
        render(<KubeResourceMap dependencies={dependencies()} />);
        await waitFor(() => expect(drawnIds()).toHaveLength(7));
      }
      const toShared = "Pod/shop/pod-0->Secret/shop/shared";
      const toTeam = "Pod/shop/pod-0->Secret/shop/team";

      it("does not draw the edges into a hub at rest, and draws those into a card of four consumers", async () => {
        await renderHub();

        expect(strokeOf(toShared)).toBeUndefined();
        expect(strokeOf(toTeam)).toEqual(atRest);
        // The numbers count every link.
        expect(screen.getByText("7 resources · 5 pods · 9 links")).toBeDefined();
      });

      it("draws the edges of a hub in the chain of the hub or of one of its consumers", async () => {
        await renderHub();

        act(() => props().onNodeHover(nodeOf("Secret/shop/shared"), null));

        expect(strokeOf(toShared)).toEqual(highlighted);
        expect(strokeOf("Pod/shop/pod-4->Secret/shop/shared")).toEqual(highlighted);

        act(() => props().onNodeHover(nodeOf("Pod/shop/pod-4"), null));

        expect(strokeOf("Pod/shop/pod-4->Secret/shop/shared")).toEqual(highlighted);
        expect(strokeOf(toShared)).toBeUndefined();
      });
    });

    it("zooms in and out with its buttons, up to its largest zoom, and fits the map to its canvas", async () => {
      await renderShop();
      act(() => FakeResizeObserver.last?.resize(800, 600));
      fit.zoom(3.5);

      fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));

      expect(fit.zoom).toHaveBeenLastCalledWith(4, 200);

      fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));

      expect(fit.zoom.mock.lastCall?.[0]).toBeCloseTo(4 / 1.3);

      const fits = fit.centerAt.mock.calls.length;
      fireEvent.click(screen.getByRole("button", { name: "Fit the map to the view" }));

      expect(fit.centerAt.mock.calls.length).toBe(fits + 1);
    });
  });
});
