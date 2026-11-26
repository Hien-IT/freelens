/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The page of a cluster frame (specs/009-main-cluster-connection, research
// R15). It follows the cluster's state from the core, shows a sidebar once the
// cluster is ready, and lists Config Maps and Pods kept current by watches
// through the core, which holds the credentials; it announces itself to the
// core (specs/004-cluster-frames, research R7).

import { enlistMessageChannelListenerInjectionToken, requestFromChannelInjectionToken } from "@freelensapp/messaging";
import { clusterStateSyncChannel, initialClusterStatesChannel } from "./cluster-channels";
import { createKubeFetch } from "./kube-fetch";
import { LiveList, markNow } from "./kube-list";
import { setClusterFrameIdChannel, startMessaging, viewOfPage } from "./messaging";

import type { ClusterState } from "./cluster-channels";

const query = new URLSearchParams(location.search);
// Only a check run loads the check and its dependencies.
const messagingCheck = query.has("messaging-check");
const framesCheck = query.has("frames-check");
// With `--scenario=lists`, the page runs the scenario of specs/baseline.md.
const scenario = query.get("scenario");
const clusterId = viewOfPage();

function alert(text: string): void {
  const element = document.createElement("p");
  element.setAttribute("role", "alert");
  element.textContent = text;
  document.body.append(element);
}

// One messaging container per page: a second one would poll with a session of
// its own and restart this view's queue (spec 002, research R3).
const messaging = startMessaging("cluster-frame");

// The frame announces its own cluster, as init-cluster-frame does in the
// Electron build (FR-014, FR-016).
void messaging
  .then((di) => di.inject(requestFromChannelInjectionToken)(setClusterFrameIdChannel, clusterId))
  .catch((error: unknown) => console.error("[CLUSTER-FRAME]: cannot announce the frame:", error));

const kubeFetch = messaging.then(createKubeFetch);

// Until the cluster is ready: its status.
const status = document.createElement("p");
status.setAttribute("role", "status");
status.textContent = "Connecting…";

// The sidebar: the namespace choice and the lists the cluster lets the user see.
const sidebar = document.createElement("nav");
sidebar.setAttribute("aria-label", "Sidebar");
sidebar.hidden = true;
const namespaceChoice = document.createElement("select");
namespaceChoice.setAttribute("aria-label", "Namespace");
const listArea = document.createElement("section");
listArea.setAttribute("aria-label", "List");
document.body.append(status, sidebar, listArea);

interface Kind {
  title: string;
  apiBase: string;
  resource: string;
  /** The prefix of the marks of this list. */
  mark: string;
}

const kinds: Kind[] = [
  { title: "Config Maps", apiBase: "/api/v1", resource: "configmaps", mark: "configmaps" },
  { title: "Pods", apiBase: "/api/v1", resource: "pods", mark: "pods" },
];

let state: ClusterState | undefined;
let shownKind: Kind | undefined;
let shown: LiveList | undefined;
let sidebarMarked = false;
let namespacesMarked = false;
/** Called with the first row of the next list, for the scenario. */
let nextFirstRow: (() => void) | undefined;
/** Called once the sidebar is in the document, for the scenario. */
let onSidebar: (() => void) | undefined;

/** The namespaces of the choice: none for All Namespaces. */
const chosenNamespaces = (): string[] | undefined => (namespaceChoice.value ? [namespaceChoice.value] : undefined);

/** Shows the list of `kind` for the chosen namespaces, stopping the one shown. */
async function showList(kind: Kind): Promise<void> {
  shownKind = kind;
  shown?.stop();
  shown = undefined;
  if (!state) {
    return;
  }
  const fetchWithWatches = await kubeFetch;
  const firstRow = nextFirstRow;
  nextFirstRow = undefined;
  const list = new LiveList({
    apiBase: kind.apiBase,
    resource: kind.resource,
    namespaces: chosenNamespaces(),
    globalWatch: state.isGlobalWatchEnabled,
    allNamespaces: state.allowedNamespaces,
    fetch: fetchWithWatches,
    onFirstRow: () => firstRow?.(),
    onError: alert,
    // The rows of the pods `measure-connection.mjs` creates and deletes (SC-005).
    onRow: (name, present) => {
      if (/^measure-\d{1,6}$/.test(name)) {
        markNow(`row-${present ? "in" : "out"}-${name}`);
      }
    },
  });
  shown = list;
  const heading = document.createElement("h2");
  heading.textContent = kind.title;
  listArea.replaceChildren(heading, list.table);
  list.start();
}

/** The choice of the allowed namespaces or All Namespaces, kept for both lists. */
function renderNamespaces(allowed: string[]): void {
  const current = namespaceChoice.value;
  const options = [new Option("All Namespaces", ""), ...allowed.map((name) => new Option(name, name))];
  namespaceChoice.replaceChildren(...options);
  // At first the default namespace when it is allowed, as the renderer starts.
  const keep = current !== "" || namespacesMarked ? current : allowed.includes("default") ? "default" : "";
  namespaceChoice.value = allowed.includes(keep) ? keep : "";
  if (!namespacesMarked && allowed.length > 0) {
    namespacesMarked = true;
    // The mark of spec 001's namespace list, which measure.sh waits for.
    void fetch("/api/mark?name=namespaces-shown");
  }
}

/** Shows what the state allows: the sidebar once ready, else the status. */
function applyState(next: ClusterState): void {
  const before = state;
  state = next;
  if (!next.ready) {
    status.textContent = next.disconnected ? "Disconnected." : "Connecting…";
    status.hidden = false;
    sidebar.hidden = true;
    shown?.stop();
    shown = undefined;
    listArea.replaceChildren();
    return;
  }
  status.hidden = true;
  renderNamespaces(next.allowedNamespaces);
  const buttons = kinds
    .filter((kind) => next.resourcesToShow.includes(kind.resource))
    .map((kind) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = kind.title;
      button.addEventListener("click", () => {
        markNow(`${kind.mark}-clicked`);
        void showList(kind);
      });
      return button;
    });
  sidebar.replaceChildren(namespaceChoice, ...buttons);
  sidebar.hidden = false;
  if (!sidebarMarked) {
    sidebarMarked = true;
    markNow("sidebar-shown");
    onSidebar?.();
  }
  const changed =
    !before?.ready ||
    before.isGlobalWatchEnabled !== next.isGlobalWatchEnabled ||
    before.allowedNamespaces.join() !== next.allowedNamespaces.join();
  if (shownKind && changed) {
    void showList(shownKind);
  }
}

namespaceChoice.addEventListener("change", () => {
  if (shownKind) {
    void showList(shownKind);
  }
});

// The state of this cluster: every change the core sends, and the one it has
// now (contracts/connection.md, "State and phase").
void messaging.then(async (di) => {
  di.inject(enlistMessageChannelListenerInjectionToken)({
    id: "cluster-state-sync",
    channel: clusterStateSyncChannel,
    handler: (sync) => {
      if (sync.clusterId === clusterId) {
        applyState(sync.state);
      }
    },
  });
  const states = await di.inject(requestFromChannelInjectionToken)(initialClusterStatesChannel);
  const own = states.find((sync) => sync.clusterId === clusterId);
  if (own && !state) {
    applyState(own.state);
  }
});

/** Resolves with the first row of the list shown next. */
const firstRowOfNext = () => new Promise<void>((resolve) => (nextFirstRow = resolve));

if (scenario === "lists") {
  // specs/baseline.md: the sidebar, Config Maps, All Namespaces, then Pods,
  // each step marked with the wall clock (research R15, R17).
  onSidebar = () =>
    void (async () => {
      const [configMaps, pods] = kinds;
      let row = firstRowOfNext();
      markNow(`${configMaps.mark}-clicked`);
      await showList(configMaps);
      await row;
      row = firstRowOfNext();
      markNow("all-namespaces-chosen");
      namespaceChoice.value = "";
      await showList(configMaps);
      await row;
      markNow(`${configMaps.mark}-first-row`);
      row = firstRowOfNext();
      markNow(`${pods.mark}-clicked`);
      await showList(pods);
      await row;
      markNow(`${pods.mark}-first-row`);
    })();
}

if (messagingCheck) {
  void Promise.all([messaging, import("./messaging-check")]).then(
    ([di, { runMessagingCheck }]) => runMessagingCheck(di),
    () => fetch("/api/mark?name=messaging-check-failed"),
  );
}

if (framesCheck) {
  void Promise.all([messaging, import("./frames-check")]).then(
    ([di, { runFramesCheck }]) => runFramesCheck(di),
    () => fetch("/api/mark?name=frames-check-failed"),
  );
}
