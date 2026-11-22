/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The catalog page of the main window. Its data comes from the core on
// `/api/clusters` (specs/001-tauri-shell-spike/contracts/scheme-routes.md).

interface CatalogResponse {
  source: string | null;
  message: string | null;
  clusters: Cluster[];
  openOnLoad: string | null;
}

interface Cluster {
  id: string;
  name: string;
}

// One section per open cluster, each with its frame on the cluster's own host.
const frames = document.createElement("div");

/** Shows the frame of `cluster`, creating it only if it is not open yet. */
function openCluster(cluster: Cluster): void {
  let open: HTMLElement | undefined;
  for (const section of frames.querySelectorAll<HTMLElement>(":scope > section")) {
    section.hidden = section.dataset.clusterId !== cluster.id;
    if (!section.hidden) {
      open = section;
    }
  }
  if (open) {
    return;
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
  close.addEventListener("click", () => section.remove());

  const frame = document.createElement("iframe");
  frame.title = cluster.name;
  frame.src = `freelens-app://${cluster.id}.renderer.freelens.app/`;
  frame.width = "100%";
  frame.height = "480";

  section.append(heading, close, frame);
  frames.append(section);
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
}

showCatalog().catch((error: unknown) => {
  document.body.append(paragraph(`Cannot load the catalog: ${String(error)}`, "alert"));
});

// A module, so that its top-level names stay local to the page.
export {};
