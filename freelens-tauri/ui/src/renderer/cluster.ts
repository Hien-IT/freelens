/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The page of a cluster frame. It lists the namespaces once, through the core,
// which holds the credentials (specs/001-tauri-shell-spike/contracts/scheme-routes.md),
// and announces itself to the core (specs/004-cluster-frames, research R7).

import { requestFromChannelInjectionToken } from "@freelensapp/messaging";
import { setClusterFrameIdChannel, startMessaging, viewOfPage } from "./messaging";

const query = new URLSearchParams(location.search);
// Only a check run loads the check and its dependencies.
const messagingCheck = query.has("messaging-check");
const framesCheck = query.has("frames-check");

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
