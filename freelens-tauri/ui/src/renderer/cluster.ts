/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The page of a cluster frame. It lists the namespaces once, through the core,
// which holds the credentials (specs/001-tauri-shell-spike/contracts/scheme-routes.md),
// lists Config Maps and Pods kept current by watches
// (specs/009-main-cluster-connection, research R15), and announces itself to
// the core (specs/004-cluster-frames, research R7).

import { requestFromChannelInjectionToken } from "@freelensapp/messaging";
import { createKubeFetch } from "./kube-fetch";
import { LiveList, markNow } from "./kube-list";
import { setClusterFrameIdChannel, startMessaging, viewOfPage } from "./messaging";

const query = new URLSearchParams(location.search);
// Only a check run loads the check and its dependencies.
const messagingCheck = query.has("messaging-check");
const framesCheck = query.has("frames-check");
// With `--scenario=lists`, the page runs the scenario of specs/baseline.md.
const scenario = query.get("scenario");

interface NamespaceList {
  items: { metadata: { name: string } }[];
}

function alert(text: string): void {
  const element = document.createElement("p");
  element.setAttribute("role", "alert");
  element.textContent = text;
  document.body.append(element);
}

async function showNamespaces(): Promise<void> {
  // The Loading state of the data model, until the core answers.
  const loading = document.createElement("p");
  loading.setAttribute("role", "status");
  loading.textContent = "Loading namespaces…";
  document.body.append(loading);
  const response = await fetch("/api-kube/api/v1/namespaces").finally(() => loading.remove());

  if (response.status === 502) {
    alert("The cluster cannot be reached.");
    return;
  }
  if (response.status === 403) {
    alert("You do not have permission to list namespaces.");
    return;
  }
  if (!response.ok) {
    alert(`Cannot list namespaces: HTTP ${response.status}.`);
    return;
  }

  const namespaces = (await response.json()) as NamespaceList;
  const list = document.createElement("ul");
  list.setAttribute("aria-label", "Namespaces");
  for (const namespace of namespaces.items) {
    const item = document.createElement("li");
    item.textContent = namespace.metadata.name;
    list.append(item);
  }
  document.body.append(list);

  await fetch("/api/mark?name=namespaces-shown");
}

showNamespaces().catch((error: unknown) => alert(`Cannot list namespaces: ${String(error)}`));

// One messaging container per page: a second one would poll with a session of
// its own and restart this view's queue (spec 002, research R3).
const messaging = startMessaging("cluster-frame");

// The frame announces its own cluster, as init-cluster-frame does in the
// Electron build (FR-014, FR-016).
void messaging
  .then((di) => di.inject(requestFromChannelInjectionToken)(setClusterFrameIdChannel, viewOfPage()))
  .catch((error: unknown) => console.error("[CLUSTER-FRAME]: cannot announce the frame:", error));

// The lists, each kept current by watches through the core.
const kubeFetch = messaging.then(createKubeFetch);
const listsNav = document.createElement("nav");
listsNav.setAttribute("aria-label", "Resources");
const listArea = document.createElement("section");
listArea.setAttribute("aria-label", "List");
document.body.append(listsNav, listArea);

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

let shown: LiveList | undefined;

/** Shows the list of `kind` for all namespaces; resolves with its first row. */
async function showList(kind: Kind): Promise<void> {
  markNow(`${kind.mark}-clicked`);
  shown?.stop();
  const fetchWithWatches = await kubeFetch;
  return new Promise<void>((firstRow) => {
    const list = new LiveList({
      apiBase: kind.apiBase,
      resource: kind.resource,
      namespaces: undefined,
      globalWatch: true,
      allNamespaces: [],
      fetch: fetchWithWatches,
      onFirstRow: () => {
        markNow(`${kind.mark}-first-row`);
        firstRow();
      },
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
  });
}

for (const kind of kinds) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = kind.title;
  button.addEventListener("click", () => void showList(kind));
  listsNav.append(button);
}

if (scenario === "lists") {
  // Config Maps of all namespaces, then Pods, as specs/baseline.md opens them.
  void (async () => {
    await showList(kinds[0]);
    await showList(kinds[1]);
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
