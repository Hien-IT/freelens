/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { createContainer } from "@ogre-tools/injectable";
import { beforeEach, describe, expect, it } from "vitest";
import clusterShellTokenListenerInjectable from "./cluster-shell-token-listener.injectable";
import { standaloneShellScope } from "./shell-request-authenticator";
import shellRequestAuthenticatorInjectable from "./shell-request-authenticator.injectable";
import standaloneShellTokenListenerInjectable from "./standalone-shell-token-listener.injectable";

import type { ShellRequestAuthenticator } from "./shell-request-authenticator";

type Handler = (request: any) => any;

const handlers = new Map<string, Handler>();

describe("shell request authenticator", () => {
  let authenticator: ShellRequestAuthenticator;

  const mint = async (channel: string, ...args: unknown[]) => {
    const handler = handlers.get(channel);

    if (!handler) {
      throw new Error(`no handler was registered for ${channel}`);
    }

    // A request channel carries the list of the legacy arguments when there are several.
    const token = (await handler(args.length > 1 ? args : args[0])) as Uint8Array;

    return Buffer.from(token).toString("base64");
  };

  beforeEach(() => {
    handlers.clear();

    const di = createContainer("shell-request-authenticator");

    di.register(
      shellRequestAuthenticatorInjectable,
      clusterShellTokenListenerInjectable,
      standaloneShellTokenListenerInjectable,
    );
    authenticator = di.inject(shellRequestAuthenticatorInjectable);

    for (const listener of [
      di.inject(clusterShellTokenListenerInjectable),
      di.inject(standaloneShellTokenListenerInjectable),
    ]) {
      handlers.set(listener.channel.id, listener.handler as Handler);
    }
  });

  it("authenticates a token minted for a cluster", async () => {
    const token = await mint("cluster:shell-api", "some-cluster-id", "some-tab-id");

    expect(authenticator.authenticate("some-cluster-id", "some-tab-id", token)).toBe(true);
  });

  it("authenticates a token minted for a shell that belongs to no cluster", async () => {
    const token = await mint("app:standalone-shell-api", "some-tab-id");

    expect(authenticator.authenticate(standaloneShellScope, "some-tab-id", token)).toBe(true);
  });

  it("does not authenticate the standalone scope with a token minted for a cluster", async () => {
    const token = await mint("cluster:shell-api", "some-cluster-id", "some-tab-id");

    expect(authenticator.authenticate(standaloneShellScope, "some-tab-id", token)).toBe(false);
  });

  it("does not authenticate a cluster with a token minted for the standalone scope", async () => {
    const token = await mint("app:standalone-shell-api", "some-tab-id");

    expect(authenticator.authenticate("some-cluster-id", "some-tab-id", token)).toBe(false);
  });

  it("does not authenticate another tab of the same scope", async () => {
    const token = await mint("app:standalone-shell-api", "some-tab-id");

    expect(authenticator.authenticate(standaloneShellScope, "some-other-tab-id", token)).toBe(false);
  });

  it("only authenticates a standalone token once", async () => {
    const token = await mint("app:standalone-shell-api", "some-tab-id");

    expect(authenticator.authenticate(standaloneShellScope, "some-tab-id", token)).toBe(true);
    expect(authenticator.authenticate(standaloneShellScope, "some-tab-id", token)).toBe(false);
  });
});
