/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The --frames-check run of specs/004-cluster-frames (research R9): each view
// reports its origin and its marks, each cluster frame tries to cross into the
// main window and the other frames, and the core prints what each view
// reports (contracts/frames-log.md).

import {
  enlistMessageChannelListenerInjectionToken,
  getMessageChannel,
  getRequestChannel,
  requestFromChannelInjectionToken,
  sendMessageToChannelInjectionToken,
} from "@freelensapp/messaging";
import { currentVisibleClusterChannel, setClusterFrameIdChannel, viewOfPage } from "./messaging";

import type { MessageChannel } from "@freelensapp/messaging";

import type { DiContainer } from "@ogre-tools/injectable";

import type { Cluster, FrameQuery } from "./catalog";

type Report =
  | { kind: "not-run"; clusters: number }
  | { kind: "origin"; origin: string }
  | { kind: "blocked" | "failed" | "sent"; attempt: string }
  | { kind: "marks"; state: string; storage: string | null }
  | { kind: "ping"; token: string }
  | { kind: "done" };

interface StepDone {
  cluster: string;
  step: "attempts" | "marks";
}

/** What the catalog page lets the check do with its frames. */
export interface CatalogActions {
  open: (cluster: Cluster, frameQuery: FrameQuery) => HTMLIFrameElement;
  close: (id: string) => void;
}

// Check-only channels, registered by the core only with --frames-check, and
// the relay of spec 002, declared by id.
const reportChannel = getMessageChannel<Report>("frames-check:report");
const sendToChannel = getRequestChannel<{ cluster: string; token: string }, boolean>("frames-check:send-to");
const sendToVisibleChannel = getRequestChannel<{ token: string }, boolean>("frames-check:send-to-visible");
const pingChannel = getMessageChannel<string>("frames-check:ping");
const reportMarksChannel = getMessageChannel<undefined>("frames-check:report-marks");
const stepDoneChannel = getMessageChannel<StepDone>("frames-check:step-done");
const broadcastToViewsChannel = getRequestChannel<{ channel: string; message?: unknown }, void>("broadcast-to-views");

// The sandbox of research R12, which the catalog page gives every frame.
const sandbox = "allow-scripts allow-same-origin allow-forms";
const stepTimeout = 30_000;
// Longer than the 60 seconds after which the core closes a queue with no poll.
const hiddenWait = 65_000;
const moveWait = 1_000;
const violationWait = 3_000;
const mainPage = "freelens-app://renderer.freelens.app/";
const clusterPage = (id: string) => `freelens-app://${id}.renderer.freelens.app/`;
// Reserved: it never resolves, and the policy blocks it before any lookup.
const outsideAddress = "https://frames-check.invalid/";

const query = new URLSearchParams(location.search);
const view = viewOfPage();
const markKey = `frames-check-${view}`;
const markUrl = (name: string) => `${outsideAddress}${name}`;
// The page-state mark: held in memory, new with every page.
const pageMark = globalThis.crypto.randomUUID();
const newToken = () => globalThis.crypto.randomUUID().slice(0, 8);

const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function waitUntil(condition: () => boolean, milliseconds: number): Promise<boolean> {
  const end = Date.now() + milliseconds;
  while (!condition()) {
    if (Date.now() > end) {
      return false;
    }
    await delay(100);
  }
  return true;
}

function connect(di: DiContainer) {
  const request = di.inject(requestFromChannelInjectionToken);
  const send = di.inject(sendMessageToChannelInjectionToken);
  const enlist = di.inject(enlistMessageChannelListenerInjectionToken);

  const report = (value: Report) => send(reportChannel, value);

  return {
    request,
    send,
    report,
    listen: <T>(channel: MessageChannel<T>, handler: (message: T) => void) =>
      enlist({ id: `frames-check:${channel.id}`, channel, handler }),
    broadcast: <T>(channel: MessageChannel<T>, message: T) =>
      request(broadcastToViewsChannel, { channel: channel.id, message }),

    /**
     * Reports `failed` when `crossed` answers true, `blocked` when it answers
     * false or throws; with `blockedBy`, only an error of that name counts as
     * blocked, and any other is a failure of the check.
     */
    async crossing(attempt: string, crossed: () => boolean | Promise<boolean>, blockedBy?: string): Promise<void> {
      let result: boolean;
      try {
        result = await crossed();
      } catch (error) {
        if (blockedBy !== undefined && (error as Error | undefined)?.name !== blockedBy) {
          console.error(`[FRAMES-CHECK]: ${attempt}:`, error);
          await fetch("/api/mark?name=frames-check-failed");
          return;
        }
        result = false;
      }
      report({ kind: result ? "failed" : "blocked", attempt });
    },

    /** Searches its own storage for another view's mark; an error is a failure of the check. */
    async searching(attempt: string, found: () => boolean | Promise<boolean>): Promise<void> {
      try {
        report({ kind: (await found()) ? "failed" : "blocked", attempt });
      } catch (error) {
        console.error(`[FRAMES-CHECK]: ${attempt}:`, error);
        await fetch("/api/mark?name=frames-check-failed");
      }
    },
  };
}

type Check = ReturnType<typeof connect>;

// Browser storage, in each kind of the spec's definition, and the cookie.

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openMarks(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open("frames-check", 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore("marks");
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
}

function storageKeys(storage: Storage): string[] {
  return Array.from({ length: storage.length }, (_, index) => storage.key(index) ?? "");
}

function cookieMarks(): string[] {
  return document.cookie
    .split(";")
    .map((pair) => pair.trim())
    .filter((pair) => pair.startsWith("frames-check="))
    .map((pair) => pair.slice("frames-check=".length));
}

/** Sets a mark of this view in each kind of storage and its cookie, each only where it finds none of its own. */
async function setMarks(): Promise<void> {
  const kinds: [string, () => unknown][] = [
    [
      "local storage",
      () => localStorage.getItem(markKey) ?? localStorage.setItem(markKey, globalThis.crypto.randomUUID()),
    ],
    ["session storage", () => sessionStorage.getItem(markKey) ?? sessionStorage.setItem(markKey, view)],
    [
      "indexeddb",
      async () => {
        const db = await openMarks();
        await done(db.transaction("marks", "readwrite").objectStore("marks").put(view, view));
        db.close();
      },
    ],
    [
      "cache storage",
      async () => {
        const cache = await caches.open("frames-check");
        if (!(await cache.match(markUrl(view)))) {
          await cache.put(markUrl(view), new Response(view));
        }
      },
    ],
    [
      "cookie",
      () => {
        if (!cookieMarks().includes(view)) {
          document.cookie = `frames-check=${view}; path=/`;
        }
      },
    ],
  ];
  for (const [kind, set] of kinds) {
    try {
      await set();
    } catch (error) {
      console.error(`[FRAMES-CHECK]: cannot set the mark in ${kind}:`, error);
      await fetch("/api/mark?name=frames-check-failed");
    }
  }
}

/** Looks for another view's mark in this view's own storage and cookie. */
async function searchStorage(check: Check): Promise<void> {
  const foreign = (name: string) => name !== view;

  await check.searching("local storage", () =>
    storageKeys(localStorage).some((key) => key.startsWith("frames-check-") && key !== markKey),
  );
  await check.searching("session storage", () =>
    storageKeys(sessionStorage).some((key) => key.startsWith("frames-check-") && key !== markKey),
  );
  await check.searching("indexeddb", async () => {
    const db = await openMarks();
    const keys = await done(db.transaction("marks").objectStore("marks").getAllKeys());
    db.close();
    return keys.some((key) => foreign(String(key)));
  });
  await check.searching("cache storage", async () => {
    const cache = await caches.open("frames-check");
    const requests = await cache.keys();
    return requests.some((request) => request.url !== markUrl(view));
  });
  await check.searching("cookie", () => cookieMarks().some(foreign));
}

function reportMarks(check: Check): void {
  check.report({ kind: "marks", state: pageMark, storage: localStorage.getItem(markKey) });
}

/** Whether the page receives a policy violation for `address` within a few seconds of `act`. */
async function violated(address: string, act: () => void): Promise<boolean> {
  let seen = false;
  const listener = (event: SecurityPolicyViolationEvent) => {
    seen ||= event.blockedURI.startsWith(address.replace(/\/$/, ""));
  };
  document.addEventListener("securitypolicyviolation", listener);
  try {
    act();
    return await waitUntil(() => seen, violationWait);
  } finally {
    document.removeEventListener("securitypolicyviolation", listener);
  }
}

/** Whether `url` shows in a frame of this page: it does not when the policy blocks it. */
async function framed(url: string): Promise<boolean> {
  const frame = document.createElement("iframe");
  frame.hidden = true;
  try {
    return !(await violated(url, () => {
      frame.src = url;
      document.body.append(frame);
    }));
  } finally {
    frame.remove();
  }
}

/** Tries to move another view to `url`; a move that works shows up in the log, not here. */
async function move(target: () => Window, url: string): Promise<boolean> {
  target().location.href = url;
  await delay(moveWait);
  return false;
}

/** The cluster id of each frame of the main window, in their order: the siblings, in the catalog's order, around this one. */
function frameIdsInOrder(siblings: string[]): string[] {
  const frames = window.parent.frames;
  const own = Array.from({ length: frames.length }, (_, index) => frames[index]).indexOf(window);
  // A wrong mapping would aim the sibling attempts at nothing, and report them blocked.
  if (own < 0 || frames.length !== siblings.length + 1) {
    throw new Error(`cannot place this frame among the ${frames.length} frames of the main window`);
  }
  const ids = [...siblings];
  ids.splice(own, 0, view);
  return ids;
}

async function runFrameAttempts(check: Check, siblings: string[]): Promise<void> {
  const ids = frameIdsInOrder(siblings);
  const sibling = (id: string) => () => window.parent.frames[ids.indexOf(id)];
  const cross = "SecurityError";

  await check.crossing("parent document read", () => window.parent.document.title !== undefined, cross);
  await check.crossing(
    "parent document change",
    () => {
      window.parent.document.body.dataset.framesCheck = view;
      return true;
    },
    cross,
  );
  for (const id of siblings) {
    await check.crossing(`sibling document read ${id}`, () => sibling(id)().document.title !== undefined, cross);
    await check.crossing(
      `sibling document change ${id}`,
      () => {
        sibling(id)().document.body.dataset.framesCheck = view;
        return true;
      },
      cross,
    );
  }

  await searchStorage(check);

  await check.crossing("main catalog", async () => (await fetch(`${mainPage}api/clusters`)).ok);
  for (const id of siblings) {
    await check.crossing(
      `sibling kube ${id}`,
      async () => (await fetch(`${clusterPage(id)}api-kube/api/v1/namespaces`)).ok,
    );
  }

  await check.crossing("set-frame-id for sibling", async () => {
    await check.request(setClusterFrameIdChannel, siblings[0]);
    return true;
  });
  // Only the core sees whether this was dropped (contracts/frames-log.md).
  check.send(currentVisibleClusterChannel, view);
  check.report({ kind: "sent", attempt: "visible from frame" });

  await check.crossing("frame main page", () => framed(mainPage));
  await check.crossing("frame sibling page", () => framed(clusterPage(siblings[0])));

  await check.crossing("open window", () => {
    const opened = window.open(`${mainPage}?moved-by=${view}`, "_blank");
    opened?.close();
    return opened !== null;
  });
  await check.crossing("outside address", async () => {
    const blocked = await violated(outsideAddress, () => {
      fetch(outsideAddress).catch(() => undefined);
    });
    return !blocked;
  });

  // Last: a move that works ends the run (contracts/frames-log.md).
  await check.crossing("move sibling", () =>
    move(sibling(siblings[0]), `${clusterPage(siblings[0])}?frames-check&moved-by=${view}`),
  );
  await check.crossing("move main to scheme", () =>
    move(() => window.top as Window, `${mainPage}?frames-check&moved-by=${view}`),
  );
  await check.crossing("move main outside", () => move(() => window.top as Window, outsideAddress));
}

/** Reports what a page another view moved here was moved by, which must never happen. */
function reportMove(check: Check): boolean {
  const movedBy = query.get("moved-by");
  if (movedBy !== null) {
    check.report({ kind: "failed", attempt: `moved by ${movedBy}` });
  }
  return movedBy !== null;
}

/** The check in a cluster frame. */
export async function runFramesCheck(di: DiContainer): Promise<void> {
  const check = connect(di);
  try {
    if (reportMove(check)) {
      return;
    }
    check.listen(pingChannel, (token) => check.report({ kind: "ping", token }));
    check.listen(reportMarksChannel, () => {
      reportMarks(check);
      void check.broadcast(stepDoneChannel, { cluster: view, step: "marks" });
    });

    const siblings = (query.get("siblings") ?? "").split(",").filter(Boolean);
    const seen = new Set<string>();
    check.listen(stepDoneChannel, ({ cluster, step }) => {
      if (step === "marks" && siblings.includes(cluster) && !seen.has(cluster)) {
        seen.add(cluster);
        // A sibling that started after this frame broadcast its marks missed them.
        void check.broadcast(stepDoneChannel, { cluster: view, step: "marks" });
      }
    });

    check.report({ kind: "origin", origin: window.origin });
    await setMarks();
    reportMarks(check);
    await check.broadcast(stepDoneChannel, { cluster: view, step: "marks" });

    // A reopened frame only reports (contracts/frames-log.md).
    if (query.has("reopened")) {
      return;
    }

    // The attempts on storage mean something only once every view has set its marks.
    if (!(await waitUntil(() => siblings.every((id) => seen.has(id)), stepTimeout))) {
      check.report({ kind: "failed", attempt: "step not finished" });
    }
    await runFrameAttempts(check, siblings);
    await check.broadcast(stepDoneChannel, { cluster: view, step: "attempts" });
  } catch (error) {
    console.error("[FRAMES-CHECK]:", error);
    await fetch("/api/mark?name=frames-check-failed");
  }
}

/** The check in the main window: it opens the frames and drives the steps. */
export async function runFramesCheckOfCatalog(
  di: DiContainer,
  clusters: Cluster[],
  catalog: CatalogActions,
): Promise<void> {
  const check = connect(di);
  try {
    if (reportMove(check)) {
      return;
    }
    check.listen(pingChannel, (token) => check.report({ kind: "ping", token }));
    const attemptsDone = new Set<string>();
    // Emptied before each step that waits for marks, so that an earlier one does not count.
    const marksDone = new Set<string>();
    check.listen(stepDoneChannel, ({ cluster, step }) => {
      (step === "attempts" ? attemptsDone : marksDone).add(cluster);
    });
    const waitForMarks = async (ids: string[]) => {
      if (!(await waitUntil(() => ids.every((id) => marksDone.has(id)), stepTimeout))) {
        check.report({ kind: "failed", attempt: "step not finished" });
      }
    };
    // Each frame still open reports its marks again (contracts/frames-log.md).
    const reportMarksOf = async (ids: string[]) => {
      marksDone.clear();
      await check.broadcast(reportMarksChannel, undefined);
      await waitForMarks(ids);
    };
    const sendTo = (cluster: string) => check.request(sendToChannel, { cluster, token: newToken() });

    check.report({ kind: "origin", origin: window.origin });
    await setMarks();
    reportMarks(check);

    if (clusters.length < 3) {
      check.report({ kind: "not-run", clusters: clusters.length });
      return;
    }

    const three = clusters.slice(0, 3);
    const frames = three.map((cluster) => ({
      id: cluster.id,
      frame: catalog.open(cluster, {
        siblings: three.filter((other) => other.id !== cluster.id).map((other) => other.id),
        reopened: false,
      }),
    }));

    if (!(await waitUntil(() => three.every((cluster) => attemptsDone.has(cluster.id)), stepTimeout))) {
      check.report({ kind: "failed", attempt: "step not finished" });
    }

    for (const { id, frame } of frames) {
      const window = frame.contentWindow as Window;
      await check.crossing(`frame document read ${id}`, () => window.document.title !== undefined, "SecurityError");
      await check.crossing(
        `frame document change ${id}`,
        () => {
          window.document.body.dataset.framesCheck = view;
          return true;
        },
        "SecurityError",
      );
      // What FR-026 asks is that the page grants none (contracts/frames-log.md).
      await check.crossing(
        `frame permissions ${id}`,
        () => frame.getAttribute("sandbox") !== sandbox || frame.hasAttribute("allow"),
      );
    }
    await searchStorage(check);

    await check.request(sendToVisibleChannel, { token: newToken() });

    // The second half of research R9: closing, forgetting and reopening.
    const [first, second, third] = three;
    const others = [first.id, third.id];
    await sendTo(first.id);

    // The second cluster shown, then closed: no frame is shown.
    catalog.open(second, { siblings: [first.id, third.id], reopened: false });
    catalog.close(second.id);

    // Its queue is still open: the core takes the message and no view gets it.
    await sendTo(second.id);
    await sendTo(first.id);
    await sendTo(third.id);
    await reportMarksOf(others);

    // The first and third frames stay hidden while the core closes the
    // second one's queue (FR-028, research R11).
    await delay(hiddenWait);
    await sendTo(second.id);
    await sendTo(first.id);
    await sendTo(third.id);
    await reportMarksOf(others);

    // Reopened on its origin, with new page state and its local storage.
    marksDone.clear();
    catalog.open(second, { siblings: [first.id, third.id], reopened: true });
    await waitForMarks([second.id]);
    check.report({ kind: "done" });
  } catch (error) {
    console.error("[FRAMES-CHECK]:", error);
    await fetch("/api/mark?name=frames-check-failed");
  }
}
