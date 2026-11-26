/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The catalog page of the main window. Its data comes from the core on
// `/api/clusters` (specs/001-tauri-shell-spike/contracts/scheme-routes.md); it
// keeps one frame per open cluster and names the visible one to the core
// (specs/004-cluster-frames, research R7).

import {
  enlistMessageChannelListenerInjectionToken,
  getMessageChannel,
  requestFromChannelInjectionToken,
  sendMessageToChannelInjectionToken,
} from "@freelensapp/messaging";
import {
  activateClusterChannel,
  clearClusterAsDeletingChannel,
  clusterKubeconfigContextsChannel,
  connectionUpdateChannel,
  deactivateClusterChannel,
  deleteClusterChannel,
  removeClusterContextChannel,
  setClusterAsDeletingChannel,
  shellSyncFailedChannel,
} from "./cluster-channels";
import { markNow } from "./kube-list";
import { currentVisibleClusterChannel, startMessaging } from "./messaging";

import type { RequestChannel } from "@freelensapp/messaging";

import type { KubeconfigSummary } from "./cluster-channels";

const query = new URLSearchParams(location.search);
// Only a check run loads the check and its dependencies.
const messagingCheck = query.has("messaging-check");
const framesCheck = query.has("frames-check");
// With `--catalog-dump`, the page marks each catalog it receives, for the
// measurements of specs/008-main-catalog (research R12).
const catalogMarks = query.has("catalog-marks");
// With `--scenario=lists`, the frame runs the scenario of specs/baseline.md
// itself (specs/009-main-cluster-connection, research R15).
const scenario = query.get("scenario");

// The channels of main-catalog the page uses, declared by id
// (specs/008-main-catalog/contracts/catalog-channels.md).
const catalogInitChannel = getMessageChannel<undefined>("catalog:init");
const catalogItemsChannel = getMessageChannel<CatalogEntity[]>("catalog:items");
const clusterVisibilityChannel = getMessageChannel<string | null>("cluster-visibility");

interface CatalogEntity {
  kind: string;
  metadata: { uid: string; name: string };
  spec?: { kubeconfigPath?: string; kubeconfigContext?: string };
  status?: { phase?: string };
}

interface CatalogResponse {
  source: string | null;
  message: string | null;
  clusters: Cluster[];
  openOnLoad: string | null;
}

export interface Cluster {
  id: string;
  name: string;
  /** From `catalog:items`; the catalog route of spec 001 gives neither. */
  contextName?: string;
  kubeconfigPath?: string;
  phase?: string;
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

// The core sends the shell sync's failure once, when this page first loads
// (specs/009-main-cluster-connection/contracts/shell-sync.md).
void messaging.then((di) =>
  di.inject(enlistMessageChannelListenerInjectionToken)({
    id: "shell-sync-failed",
    channel: shellSyncFailedChannel,
    handler: (error) => {
      document.body.prepend(paragraph(`Failed to sync shell environment: ${error}`, "alert"));
    },
  }),
);

/** Asks the core on `channel`; rejects with the core's error. */
async function request<Req, Res>(channel: RequestChannel<Req, Res>, payload: Req): Promise<Res> {
  const di = await messaging;
  return di.inject(requestFromChannelInjectionToken)(channel, payload);
}

/** Names the visible cluster to the core, or none (FR-014, FR-017). */
function sendVisibleCluster(id: string | undefined): void {
  void messaging.then((di) => {
    const send = di.inject(sendMessageToChannelInjectionToken);
    send(currentVisibleClusterChannel, id);
    // The renderer names the visible cluster on both channels; the catalog
    // marks it active from this one.
    send(clusterVisibilityChannel, id ?? null);
  });
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

  section.append(heading, close, connectionStatus(cluster), frame);
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
  if (scenario === "lists") {
    flags.push("scenario=lists");
  }
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

const list = document.createElement("ul");
list.setAttribute("aria-label", "Clusters");
const empty = paragraph("The catalog is empty.");

/**
 * The connection updates of a cluster, and Reconnect once one of them is an
 * error, as the Electron build's cluster status shows them.
 */
function connectionStatus(cluster: Cluster): HTMLElement {
  const status = document.createElement("div");
  status.dataset.connectionOf = cluster.id;
  const updates = document.createElement("ol");
  updates.setAttribute("aria-label", "Connection");
  updates.setAttribute("aria-live", "polite");
  const reconnect = document.createElement("button");
  reconnect.type = "button";
  reconnect.textContent = "Reconnect";
  reconnect.hidden = true;
  reconnect.addEventListener("click", () => {
    updates.replaceChildren();
    reconnect.hidden = true;
    void request(activateClusterChannel, { clusterId: cluster.id, force: true });
  });
  status.append(updates, reconnect);
  return status;
}

const listening = new Set<string>();

/** Shows the connection updates of `id` in its section from now on. */
async function followUpdates(id: string): Promise<void> {
  if (listening.has(id)) {
    return;
  }
  listening.add(id);
  const di = await messaging;
  di.inject(enlistMessageChannelListenerInjectionToken)({
    id: `connection-update-${id}`,
    channel: connectionUpdateChannel(id),
    handler: ({ message, level }) => {
      const status = frames.querySelector<HTMLElement>(`[data-connection-of="${id}"]`);
      if (!status) {
        return;
      }
      const item = document.createElement("li");
      item.textContent = message;
      item.dataset.level = level;
      if (level === "error") {
        item.setAttribute("role", "alert");
        (status.querySelector("button") as HTMLButtonElement).hidden = false;
      }
      status.querySelector("ol")?.append(item);
    },
  });
}

/** Opens the cluster and connects it, as a click on it does. */
function connectCluster(cluster: Cluster): void {
  openCluster(cluster);
  void followUpdates(cluster.id).then(() => request(activateClusterChannel, { clusterId: cluster.id }));
}

/** Disconnects the cluster and closes its frame, which the core forgets. */
function disconnectCluster(cluster: Cluster): void {
  closeCluster(cluster.id);
  void request(deactivateClusterChannel, cluster.id);
}

const failedToDelete = "Cannot remove cluster, failed to process config file.";

/**
 * The delete dialog of the Electron build: the context leaves its file, a new
 * current context chosen when it was the current one, then the cluster goes,
 * all under the deleting mark (specs/009-main-cluster-connection, research R11).
 */
async function deleteCluster(cluster: Cluster): Promise<void> {
  let summary: KubeconfigSummary;
  try {
    summary = await request(clusterKubeconfigContextsChannel, cluster.id);
  } catch (error) {
    document.body.append(paragraph(`${failedToDelete} ${String(error)}`, "alert"));
    return;
  }
  const others = summary.contexts.filter((context) => context !== cluster.contextName);
  const showContextSwitch = summary.currentContext === cluster.contextName && others.length > 0;

  const dialog = document.createElement("dialog");
  dialog.setAttribute("aria-label", `Delete ${cluster.name}`);
  const message = paragraph(`Delete the ${cluster.name} context from ${cluster.kubeconfigPath ?? "its kubeconfig"}?`);
  const choice = document.createElement("select");
  choice.setAttribute("aria-label", "New current context");
  choice.append(new Option("Select new context...", ""), ...others.map((context) => new Option(context, context)));
  choice.hidden = !showContextSwitch;
  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.textContent = "Delete Context";
  confirm.disabled = showContextSwitch;
  choice.addEventListener("change", () => {
    confirm.disabled = showContextSwitch && choice.value === "";
  });
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => dialog.remove());
  confirm.addEventListener("click", async () => {
    confirm.disabled = true;
    await request(setClusterAsDeletingChannel, cluster.id);
    try {
      await request(removeClusterContextChannel, {
        clusterId: cluster.id,
        newCurrentContext: showContextSwitch && choice.value ? choice.value : undefined,
      });
      await request(deleteClusterChannel, cluster.id);
      closeCluster(cluster.id);
    } catch (error) {
      document.body.append(paragraph(`${failedToDelete} ${String(error)}`, "alert"));
    } finally {
      await request(clearClusterAsDeletingChannel, cluster.id);
      dialog.remove();
    }
  });
  dialog.append(message, choice, confirm, cancel);
  document.body.append(dialog);
  dialog.showModal();
}

/** Lists the clusters with their phase, keeping the frames that are open. */
function renderClusters(clusters: Cluster[]): void {
  list.replaceChildren(
    ...clusters.map((cluster) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = cluster.name;
      button.dataset.clusterId = cluster.id;
      button.addEventListener("click", () => connectCluster(cluster));
      const item = document.createElement("li");
      item.append(button);
      if (cluster.phase) {
        const phase = document.createElement("span");
        phase.textContent = ` ${cluster.phase} `;
        phase.dataset.phase = cluster.phase;
        item.append(phase);
      }
      for (const [label, action] of [
        ["Disconnect", () => disconnectCluster(cluster)],
        ["Delete", () => void deleteCluster(cluster)],
      ] as const) {
        const control = document.createElement("button");
        control.type = "button";
        control.textContent = label;
        control.setAttribute("aria-label", `${label} ${cluster.name}`);
        control.disabled = cluster.phase === "deleting";
        control.addEventListener("click", action);
        item.append(control);
      }
      return item;
    }),
  );
  empty.hidden = clusters.length > 0;
  list.hidden = clusters.length === 0;
}

let openOnLoadId: string | null = null;
let scenarioPending = scenario === "lists";

/** Follows the catalog the core sends, and opens `--open-cluster` once it is there. */
function followCatalog(): void {
  void messaging.then((di) => {
    di.inject(enlistMessageChannelListenerInjectionToken)({
      id: "catalog-items",
      channel: catalogItemsChannel,
      handler: (entities) => {
        const clusters = entities
          .filter((entity) => entity.kind === "KubernetesCluster")
          .map((entity) => ({
            id: entity.metadata.uid,
            name: entity.metadata.name,
            contextName: entity.spec?.kubeconfigContext,
            kubeconfigPath: entity.spec?.kubeconfigPath,
            phase: entity.status?.phase,
          }));
        renderClusters(clusters);
        if (catalogMarks) {
          void fetch(`/api/mark?name=catalog-${entities.length}`);
        }
        const opening = clusters.find((cluster) => cluster.id === openOnLoadId);
        if (opening) {
          openOnLoadId = null;
          connectCluster(opening);
        }
        // The scenario of specs/baseline.md clicks the cluster of the kind
        // context once the catalog has it (research R15).
        const kind = scenarioPending && clusters.find((cluster) => cluster.contextName?.startsWith("kind-"));
        if (kind) {
          scenarioPending = false;
          markNow("cluster-clicked");
          connectCluster(kind);
          // After the 60 s the measurements count, the scenario disconnects
          // the cluster, for the watches left after a disconnect (SC-011).
          setTimeout(() => {
            markNow("disconnected");
            disconnectCluster(kind);
          }, 70_000);
        }
      },
    });
    // The mark comes before the request, so that SC-007 times from it.
    const marked = catalogMarks ? fetch("/api/mark?name=catalog-init") : Promise.resolve(undefined);
    void marked.then(() => di.inject(sendMessageToChannelInjectionToken)(catalogInitChannel, undefined));
  });
}

async function showCatalog(): Promise<void> {
  const response = await fetch("/api/clusters");
  const catalog = (await response.json()) as CatalogResponse;

  if (catalog.message) {
    document.body.append(paragraph(catalog.message, "alert"));
  }

  renderClusters(catalog.clusters);
  document.body.append(empty, list, frames);

  await fetch("/api/mark?name=catalog-shown");

  const openOnLoad = catalog.clusters.find((cluster) => cluster.id === catalog.openOnLoad);
  if (openOnLoad) {
    connectCluster(openOnLoad);
  } else {
    openOnLoadId = catalog.openOnLoad;
  }
  followCatalog();

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
