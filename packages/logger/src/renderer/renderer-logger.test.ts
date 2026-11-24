/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { registerFeature } from "@freelensapp/feature-core";
import { createContainer, getInjectable } from "@ogre-tools/injectable";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger, format } from "winston";
import TransportStream from "winston-transport";
import { loggerInjectionToken } from "../common/logger.injectable";
import { LEVEL, MESSAGE, SPLAT } from "./entry";
import { loggerFeatureForRenderer } from "./feature";
import { createRendererLogger } from "./renderer-logger.injectable";
import { LoggerTransport, loggerTransportInjectionToken } from "./transports";

import type { LogEntry } from "./entry";

type Call = [level: "error" | "warn" | "info" | "debug" | "silly", message: string, ...data: unknown[]];

/** What a transport sees of an entry, symbols included. */
const seen = (entry: Record<string | symbol, unknown>) => ({
  ...entry,
  level: entry[LEVEL],
  message: entry[MESSAGE],
  splat: entry[SPLAT],
});

/** The entries winston writes for the calls, with the format of the main process's logger. */
const writtenByWinston = async (calls: Call[]) => {
  const entries: unknown[] = [];
  const logger = createLogger({
    format: format.combine(format.splat(), format.simple(), format.timestamp({ format: "DD/MM/YYYY HH:mm:ss" })),
    transports: [
      new TransportStream({
        log: (entry: Record<string | symbol, unknown>, next: () => void) => {
          entries.push(seen(entry));
          next();
        },
      }),
    ],
  });

  for (const [level, message, ...data] of calls) {
    logger[level](message, ...data);
  }

  await new Promise((resolve) => setTimeout(resolve, 10));

  return entries;
};

class CollectingTransport extends LoggerTransport {
  readonly entries: unknown[] = [];

  log(entry: LogEntry, next: () => void) {
    this.entries.push(seen(entry));
    next();
  }
}

const writtenByRendererLogger = (calls: Call[]) => {
  const transport = new CollectingTransport();
  const logger = createRendererLogger([transport]);

  for (const [level, message, ...data] of calls) {
    logger[level](message, ...data);
  }

  return transport.entries;
};

describe("the renderer's logger, compared with winston", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 0, 2, 3, 4, 5));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const error = new Error("some-error");

  const cases: Record<string, Call[]> = {
    "each level": [
      ["error", "some-message"],
      ["warn", "some-message"],
      ["info", "some-message"],
      ["debug", "some-message"],
      ["silly", "some-message"],
    ],
    "a prefix": [["info", "[SOME-FEATURE]: some-message"]],
    "an empty message": [["info", ""]],
    "one string after the message": [["info", "some-message", "some-data"]],
    "one object after the message": [["warn", "some-message", { some: "data", nested: { b: 1, a: [1, 2] } }]],
    "two arguments after the message": [["info", "some-message", { some: "data" }, "more"]],
    "an error with a stack": [["error", "some-message", error]],
    "an object with a message and a stack": [["error", "failed:", { message: "why", stack: "the stack" }]],
    "tokens and their arguments": [["info", "%s has %d items, %j", "the list", 3, { a: 1 }]],
    "tokens with metadata after them": [["info", "%s done", "it", { extra: true }]],
    "an escaped percent": [["info", "100%% of %s", "it"]],
    "a token without an argument": [["info", "%s and %s", "one"]],
    "a circular object": [
      [
        "info",
        "some-message",
        (() => {
          const circular: Record<string, unknown> = { name: "circular" };

          circular.self = circular;

          return circular;
        })(),
      ],
    ],
  };

  it.each(Object.entries(cases))("writes %s as winston does", async (_name, calls) => {
    const expected = await writtenByWinston(calls);

    expect(writtenByRendererLogger(calls)).toEqual(expected);
  });

  it("writes the timestamp in local time as DD/MM/YYYY HH:mm:ss", () => {
    expect(writtenByRendererLogger([["info", "some-message"]])).toEqual([
      expect.objectContaining({ timestamp: "02/01/2026 03:04:05" }),
    ]);
  });
});

describe("the renderer's logger", () => {
  it("writes to a transport only the levels of the transport", () => {
    const transport = new (class extends CollectingTransport {})({ level: "error" });
    const logger = createRendererLogger([transport]);

    logger.warn("some-warning");
    logger.error("some-error");

    expect(transport.entries).toEqual([expect.objectContaining({ level: "error" })]);
  });

  it("closes a transport it removes, and writes nothing more to it", () => {
    const transport = new CollectingTransport();
    const close = vi.fn();

    transport.close = close;

    const logger = createRendererLogger([transport]);

    logger.remove(transport);
    logger.info("some-message");

    expect(close).toHaveBeenCalledTimes(1);
    expect(transport.entries).toEqual([]);
  });

  it("is what the logger of the renderer feature writes to", () => {
    const di = createContainer("irrelevant");
    const transport = new CollectingTransport();

    registerFeature(di, loggerFeatureForRenderer);
    di.register(
      getInjectable({
        id: "some-transport",
        instantiate: () => transport,
        injectionToken: loggerTransportInjectionToken,
      }),
    );

    di.inject(loggerInjectionToken).info("some-message", { some: "data" });

    expect(transport.entries).toEqual([
      expect.objectContaining({ level: "info", message: 'info: some-message {"some":"data"}' }),
    ]);
  });
});
