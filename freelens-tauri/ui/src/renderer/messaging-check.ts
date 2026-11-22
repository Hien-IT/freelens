/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The --messaging-check run of specs/002-messaging-for-tauri (research R9):
// rounds over existing channels of the Electron build, through
// messaging-for-tauri, reported to the core, which prints them
// (contracts/check-log.md).

import { registerFeature } from "@freelensapp/feature-core";
import {
  enlistMessageChannelListenerInjectionToken,
  getMessageChannel,
  getRequestChannel,
  listeningOfChannelsInjectionToken,
  requestFromChannelInjectionToken,
  sendMessageToChannelInjectionToken,
} from "@freelensapp/messaging";
import { messagingFeatureForTauri } from "@freelensapp/messaging-for-tauri";
import { createContainer } from "@ogre-tools/injectable";
import { registerMobX } from "@ogre-tools/injectable-extension-for-mobx";
import { runInAction } from "mobx";

type Step = "request" | "message to view";

type Report =
  | { kind: "version"; version: string }
  | { kind: "round"; round: number; failed: { step: Step; message: string } | null }
  | { kind: "echo"; bytes: number; ms: number }
  | { kind: "done" }
  | { kind: "isolation"; blocked: boolean }
  | { kind: "intrusion" };

// Existing channels of the Electron build, declared by id: the spike does not
// depend on packages/core, where they are defined.
const buildVersionChannel = getRequestChannel<void, string>("build-version");
const frameCommunicationAdminChannel = getMessageChannel<undefined>("frame-communication-admin-channel");
const broadcastToViewsChannel = getRequestChannel<{ channel: string; message: string }, void>("broadcast-to-views");
const appNavigationChannel = getMessageChannel<string>("renderer:navigate");

// Check-only channels, registered by the core only with --messaging-check.
const reportChannel = getMessageChannel<Report>("messaging-check:report");
const echoChannel = getRequestChannel<{ text: string }, string>("messaging-check:echo");

const rounds = 20;
const lateRound = rounds + 1;
const lateRoundDelay = 130_000;
const deliveryTimeout = 5_000;
const echoSizes = [1_000, 1_000_000, 10_000_000];

const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

// A cluster frame posting to the main window's host, as content in the frame
// could (FR-006). It must not reach the core as the main window.
async function postToMainWindowHost(): Promise<boolean> {
  const body = JSON.stringify({ messages: [{ channel: reportChannel.id, payload: { kind: "intrusion" } }] });

  try {
    await fetch("freelens-app://renderer.freelens.app/ipc/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    return false;
  } catch {
    return true;
  }
}

export async function runMessagingCheck(): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.error("[MESSAGING-CHECK]:", error);
    // Reported on a path that does not use messaging.
    await fetch("/api/mark?name=messaging-check-failed");
  }
}

async function run(): Promise<void> {
  const di = createContainer("messaging-check");

  di.permitSideEffects();
  runInAction(() => {
    registerMobX(di);
    registerFeature(di, messagingFeatureForTauri);
  });

  // What the application's start does for messaging: listen, then announce.
  // The start itself runs @freelensapp/run-many, which needs Node's
  // EventEmitter until spec 003 makes the renderer run without Node.
  await di.inject(listeningOfChannelsInjectionToken).start();

  const request = di.inject(requestFromChannelInjectionToken);
  const send = di.inject(sendMessageToChannelInjectionToken);

  send(frameCommunicationAdminChannel, undefined);
  const report = (value: Report) => send(reportChannel, value);
  const tag = location.hostname === "renderer.freelens.app" ? "main" : location.hostname.split(".")[0];

  const received = new Map<string, number>();
  const waiting = new Map<string, () => void>();

  di.inject(enlistMessageChannelListenerInjectionToken)({
    id: "messaging-check",
    channel: appNavigationChannel,
    handler: (url) => {
      received.set(url, (received.get(url) ?? 0) + 1);
      waiting.get(url)?.();
    },
  });

  const runRound = async (round: number): Promise<void> => {
    let failed: { step: Step; message: string } | null = null;

    try {
      const version = await request(buildVersionChannel);

      if (typeof version !== "string" || version === "") {
        throw new Error(`unexpected answer ${JSON.stringify(version)}`);
      }

      if (round === 1) {
        report({ kind: "version", version });
      }
    } catch (error) {
      failed = { step: "request", message: String(error) };
    }

    // Judged by the core, from its count of this view's announcements.
    send(frameCommunicationAdminChannel, undefined);

    if (!failed) {
      const url = `/messaging-check/${tag}/${round}`;

      try {
        const arrived = new Promise<void>((resolve, reject) => {
          waiting.set(url, resolve);
          setTimeout(() => reject(new Error("not received within 5 s")), deliveryTimeout);
        });

        await request(broadcastToViewsChannel, { channel: appNavigationChannel.id, message: url });
        await arrived;

        if (received.get(url) !== 1) {
          throw new Error(`received ${received.get(url)} times`);
        }
      } catch (error) {
        failed = { step: "message to view", message: String(error) };
      } finally {
        waiting.delete(url);
      }
    }

    report({ kind: "round", round, failed });
  };

  for (let round = 1; round <= rounds; round++) {
    await runRound(round);
  }

  for (const bytes of echoSizes) {
    const text = "x".repeat(bytes);
    const started = performance.now();
    const answer = await request(echoChannel, { text });

    if (answer.length !== bytes) {
      throw new Error(`echo of ${bytes} bytes came back with ${answer.length}`);
    }

    report({ kind: "echo", bytes, ms: performance.now() - started });
  }

  report({ kind: "done" });

  if (tag !== "main") {
    report({ kind: "isolation", blocked: await postToMainWindowHost() });
  }

  // A late round, with the application in the background meanwhile (research R14).
  await delay(lateRoundDelay);
  await runRound(lateRound);
}
