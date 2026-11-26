/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// A list of one kind of resource of the frame's cluster, kept current by
// watches through the /api-kube proxy, as the renderer's object store keeps
// it (specs/009-main-cluster-connection/research.md, R15): a list request,
// then a watch from the list's resourceVersion, opened again a second after it
// ends, and the list loaded again after a 410.

interface KubeObject {
  metadata: { name: string; namespace?: string; resourceVersion?: string };
}

interface KubeList {
  metadata: { resourceVersion?: string };
  items: KubeObject[];
}

interface WatchEvent {
  type: "ADDED" | "MODIFIED" | "DELETED" | "BOOKMARK" | "ERROR";
  object: KubeObject & { code?: number };
}

export interface ListOptions {
  /** `/api/v1` or `/apis/<group>/<version>`. */
  apiBase: string;
  /** The plural name, such as `pods`. */
  resource: string;
  /** No namespace, for all of them; else the namespaces to list. */
  namespaces: string[] | undefined;
  /** One watch for all namespaces is allowed; else one per namespace. */
  globalWatch: boolean;
  /** Every namespace the user may see, watched one by one without `globalWatch`. */
  allNamespaces: string[];
  fetch: typeof fetch;
  /** Called once, when the first row is in the document. */
  onFirstRow?: () => void;
  /** Called when a row enters or leaves the document, with the object's name. */
  onRow?: (name: string, present: boolean) => void;
  onError?: (message: string) => void;
}

const key = (object: KubeObject) => `${object.metadata.namespace ?? ""}/${object.metadata.name}`;

/** Lists, renders and follows the resources; `stop` ends the watches. */
export class LiveList {
  readonly table = document.createElement("table");
  private readonly body = document.createElement("tbody");
  private readonly rows = new Map<string, HTMLTableRowElement>();
  private readonly aborts = new Set<AbortController>();
  private stopped = false;
  private firstRowSeen = false;

  constructor(private readonly options: ListOptions) {
    const head = document.createElement("thead");
    const row = head.insertRow();
    for (const title of ["Name", "Namespace"]) {
      const cell = document.createElement("th");
      cell.textContent = title;
      row.append(cell);
    }
    this.table.append(head, this.body);
    this.table.setAttribute("aria-label", options.resource);
  }

  start(): void {
    const { namespaces } = this.options;
    if (namespaces === undefined) {
      void this.load(undefined);
    } else {
      for (const namespace of namespaces) {
        void this.load(namespace);
      }
    }
  }

  stop(): void {
    this.stopped = true;
    for (const abort of this.aborts) {
      abort.abort();
    }
    this.aborts.clear();
  }

  private url(namespace: string | undefined): string {
    const { apiBase, resource } = this.options;
    const scope = namespace === undefined ? "" : `/namespaces/${encodeURIComponent(namespace)}`;
    return `/api-kube${apiBase}${scope}/${resource}`;
  }

  /**
   * Lists `namespace` (all of them when undefined), then watches it: all
   * namespaces with one watch when allowed, else each one apart.
   */
  private async load(namespace: string | undefined): Promise<void> {
    if (this.stopped) {
      return;
    }
    try {
      const response = await this.options.fetch(this.url(namespace));
      if (!response.ok) {
        this.options.onError?.(`Cannot list ${this.options.resource}: HTTP ${response.status}.`);
        return;
      }
      const list = (await response.json()) as KubeList;
      for (const object of list.items) {
        this.put(object);
      }
      const version = list.metadata.resourceVersion ?? "";
      if (namespace === undefined && !this.options.globalWatch) {
        for (const each of this.options.allNamespaces) {
          this.watch(each, version);
        }
      } else {
        this.watch(namespace, version);
      }
    } catch (error) {
      this.options.onError?.(`Cannot list ${this.options.resource}: ${String(error)}`);
    }
  }

  private watch(namespace: string | undefined, resourceVersion: string): void {
    if (this.stopped) {
      return;
    }
    const abort = new AbortController();
    this.aborts.add(abort);
    let version = resourceVersion;
    let gone = false;
    const query = `watch=1&resourceVersion=${encodeURIComponent(version)}&timeoutSeconds=600`;
    void (async () => {
      try {
        const response = await this.options.fetch(`${this.url(namespace)}?${query}`, { signal: abort.signal });
        if (!response.ok || !response.body) {
          return;
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffered = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          buffered += decoder.decode(value, { stream: true });
          const lines = buffered.split(/\r\n|[\r\n]/);
          buffered = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) {
              continue;
            }
            let event: WatchEvent;
            try {
              event = JSON.parse(line) as WatchEvent;
            } catch {
              continue;
            }
            if (event.type === "ERROR") {
              gone = event.object.code === 410;
              continue;
            }
            version = event.object.metadata.resourceVersion ?? version;
            if (event.type === "DELETED") {
              this.remove(event.object);
            } else if (event.type !== "BOOKMARK") {
              this.put(event.object);
            }
          }
        }
      } catch {
        // The watch failed or was aborted; it is opened again below unless stopped.
      } finally {
        this.aborts.delete(abort);
      }
      if (this.stopped) {
        return;
      }
      setTimeout(() => {
        if (gone) {
          void this.load(namespace);
        } else {
          this.watch(namespace, version);
        }
      }, 1000);
    })();
  }

  private put(object: KubeObject): void {
    const id = key(object);
    let row = this.rows.get(id);
    if (!row) {
      row = this.body.insertRow();
      row.insertCell().textContent = object.metadata.name;
      row.insertCell().textContent = object.metadata.namespace ?? "";
      row.dataset.key = id;
      this.rows.set(id, row);
      this.options.onRow?.(object.metadata.name, true);
      if (!this.firstRowSeen) {
        this.firstRowSeen = true;
        this.options.onFirstRow?.();
      }
    }
  }

  private remove(object: KubeObject): void {
    const id = key(object);
    const row = this.rows.get(id);
    if (row) {
      row.remove();
      this.rows.delete(id);
      this.options.onRow?.(object.metadata.name, false);
    }
  }
}

/** Posts `name-<wall clock ms>` to the core's marks (specs/009-main-cluster-connection/research.md, R17). */
export function markNow(name: string): void {
  const now = Math.round(performance.timeOrigin + performance.now());
  void fetch(`/api/mark?name=${name}-${now}`);
}
