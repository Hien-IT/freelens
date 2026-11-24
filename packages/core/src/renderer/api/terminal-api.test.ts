/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalApi } from "./terminal-api";
import { WebSocketApi } from "./websocket-api";

import type { Logger } from "@freelensapp/logger";

import type { TerminalApiQuery } from "./terminal-api";

describe("TerminalApi, connecting", () => {
  const token = new Uint8Array([0, 1, 2, 62, 63, 250, 251, 252, 253, 254, 255, 128, 64, 32]);
  let connectedTo: () => URL;

  beforeEach(() => {
    const connect = vi.spyOn(WebSocketApi.prototype, "connect").mockImplementation(() => {});

    connectedTo = () => new URL(connect.mock.calls[0][0]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const connectWith = async (query: TerminalApiQuery) => {
    const api = new TerminalApi(
      {
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), silly: vi.fn() } as unknown as Logger,
        defaultParams: {} as never,
        requestShellToken: async () => token,
      },
      query,
    );

    await api.connect();
  };

  it("connects to /api of the page's host over ws", async () => {
    await connectWith({ id: "some-tab" });

    expect(connectedTo().protocol).toBe("ws:");
    expect(connectedTo().host).toBe(location.host);
    expect(connectedTo().pathname).toBe("/api");
    expect(connectedTo().searchParams.get("id")).toBe("some-tab");
  });

  it("does not send a node that is undefined", async () => {
    await connectWith({ id: "some-tab", node: undefined });

    expect(connectedTo().searchParams.has("node")).toBe(false);
    expect(connectedTo().searchParams.has("type")).toBe(false);
  });

  it("sends a node with its type", async () => {
    await connectWith({ id: "some-tab", node: "some-node" });

    expect(connectedTo().searchParams.get("node")).toBe("some-node");
    expect(connectedTo().searchParams.get("type")).toBe("node");
  });

  it("sends a token that main decodes to the same bytes", async () => {
    await connectWith({ id: "some-tab" });

    const shellToken = connectedTo().searchParams.get("shellToken") ?? "";

    expect(new Uint8Array(Buffer.from(shellToken, "base64"))).toEqual(token);
  });
});
