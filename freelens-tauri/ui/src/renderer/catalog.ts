/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The catalog page of the main window. Its data comes from the core on
// `/api/clusters` (specs/001-tauri-shell-spike/contracts/scheme-routes.md); it
// keeps one frame per open cluster and names the visible one to the core
// (specs/004-cluster-frames, research R7).

import { sendMessageToChannelInjectionToken } from "@freelensapp/messaging";
import { currentVisibleClusterChannel, startMessaging } from "./messaging";

const query = new URLSearchParams(location.search);
// Only a check run loads the check and its dependencies.
const messagingCheck = query.has("messaging-check");
const framesCheck = query.has("frames-check");

interface CatalogResponse {
  source: string | null;
  message: string | null;
  clusters: Cluster[];
  openOnLoad: string | null;
}

export interface Cluster {
  id: string;
  name: string;
}

/** What `openCluster` adds to the query of a new frame, in a --frames-check run. */
export interface FrameQuery {
  siblings: string[];
  reopened: boolean;
}

// One messaging container per page: a second one would poll with a session of
// its own and restart this view's queue (spec 002, research R3).
const messaging = startMessaging("catalog");

messaging.catch((error: unknown) => console.error("[CATALOG]: messaging did not start:", error));

/** Names the visible cluster to the core, or none (FR-014, FR-017). */
function sendVisibleCluster(id: string | undefined): void {
  void messaging.then((di) => di.inject(sendMessageToChannelInjectionToken)(currentVisibleClusterChannel, id));
}

// One section per open cluster, each with its frame on the cluster's own host.
const frames = document.createElement("div");

/** Shows the frame of `cluster`, creating it only if it is not open yet. */
function openCluster(cluster: Cluster, frameQuery?: FrameQuery): HTMLIFrameElement {
  let open: HTMLElement | undefined;
  for (const section of frames.querySelectorAll<HTMLElement>(":scope > section")) {
    section.hidden = section.dataset.clusterId !== cluster.id;
    if (!section.hidden) {
      open = section;
    }
  }
  sendVisibleCluster(cluster.id);
  if (open) {
    return open.querySelector("iframe") as HTMLIFrameElement;
  }

  const section = document.createElement("section");
  section.dataset.clusterId = cluster.id;
  section.setAttribute("aria-label", cluster.name);

  const heading = document.createElement("h2");
  heading.textContent = cluster.name;

  // Closing removes the frame, so the next open loads the list again.
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  close.setAttribute("aria-label", `Close ${cluster.name}`);
  close.addEventListener("click", () => closeCluster(cluster.id));

  const frame = document.createElement("iframe");
  frame.title = cluster.name;
  // No top navigation, window, dialog or permission for the frame; it stays
  // on its own origin (FR-024, FR-026, research R12). No `allow` attribute.
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");
  frame.src = `freelens-app://${cluster.id}.renderer.freelens.app/${frameSearch(frameQuery)}`;
  frame.width = "100%";
  frame.height = "480";

  section.append(heading, close, frame);
  // Marks when the frame is created, for the cluster-open figures (FR-011).
  void fetch("/api/mark?name=cluster-opened");
  frames.append(section);

  return frame;
}

/** Removes the frame of the cluster; no cluster is visible if it was shown. */
function closeCluster(id: string): void {
  const section = frames.querySelector<HTMLElement>(`:scope > section[data-cluster-id="${id}"]`);
  if (!section) {
    return;
  }
  const shown = !section.hidden;
  section.remove();
  if (shown) {
    sendVisibleCluster(undefined);
  }
}

// The frame runs the check the main window runs; cluster ids are hexadecimal.
function frameSearch(frameQuery: FrameQuery | undefined): string {
  const flags: string[] = [];
  if (messagingCheck) {
    flags.push("messaging-check");
  }
  if (framesCheck && frameQuery) {
    flags.push("frames-check", `siblings=${frameQuery.siblings.join(",")}`);
    if (frameQuery.reopened) {
      flags.push("reopened");
    }
  }
  return flags.length > 0 ? `?${flags.join("&")}` : "";
}

function paragraph(text: string, role?: string): HTMLParagraphElement {
  const element = document.createElement("p");
  element.textContent = text;
  if (role) {
    element.setAttribute("role", role);
  }
  return element;
}

async function showCatalog(): Promise<void> {
  const response = await fetch("/api/clusters");
  const catalog = (await response.json()) as CatalogResponse;

  if (catalog.message) {
    document.body.append(paragraph(catalog.message, "alert"));
  }

  if (catalog.clusters.length === 0) {
    document.body.append(paragraph("The catalog is empty."));
  } else {
    const list = document.createElement("ul");
    list.setAttribute("aria-label", "Clusters");
    for (const cluster of catalog.clusters) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = cluster.name;
      button.dataset.clusterId = cluster.id;
      button.addEventListener("click", () => openCluster(cluster));
      const item = document.createElement("li");
      item.append(button);
      list.append(item);
    }
    document.body.append(list, frames);
  }

  await fetch("/api/mark?name=catalog-shown");

  const openOnLoad = catalog.clusters.find((cluster) => cluster.id === catalog.openOnLoad);
  if (openOnLoad) {
    openCluster(openOnLoad);
  }

  if (messagingCheck) {
    void Promise.all([messaging, import("./messaging-check")]).then(
      ([di, { runMessagingCheck }]) => runMessagingCheck(di),
      () => fetch("/api/mark?name=messaging-check-failed"),
    );
  }

  if (framesCheck) {
    void Promise.all([messaging, import("./frames-check")]).then(
      ([di, { runFramesCheckOfCatalog }]) =>
        runFramesCheckOfCatalog(di, catalog.clusters, { open: openCluster, close: closeCluster }),
      () => fetch("/api/mark?name=frames-check-failed"),
    );
  }
}

showCatalog().catch((error: unknown) => {
  document.body.append(paragraph(`Cannot load the catalog: ${String(error)}`, "alert"));
});
