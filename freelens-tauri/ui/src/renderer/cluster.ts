/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The page of a cluster frame. It lists the namespaces once, through the core,
// which holds the credentials (specs/001-tauri-shell-spike/contracts/scheme-routes.md).

// Only a --messaging-check run loads the check and its dependencies.
const messagingCheck = new URLSearchParams(location.search).has("messaging-check");

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

if (messagingCheck) {
  void import("./messaging-check").then(
    ({ runMessagingCheck }) => runMessagingCheck(),
    () => fetch("/api/mark?name=messaging-check-failed"),
  );
}

// A module, so that its top-level names stay local to the page.
export {};
