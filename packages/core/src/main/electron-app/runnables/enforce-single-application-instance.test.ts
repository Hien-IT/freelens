/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { createContainer } from "@ogre-tools/injectable";
import { beforeEach, describe, expect, it, vi } from "vitest";
import forceAppExitInjectable from "../features/force-app-exit.injectable";
import isTauriBuildRunningInjectable, { isLiveTarget } from "../features/is-tauri-build-running.injectable";
import requestSingleInstanceLockInjectable from "../features/request-single-instance-lock.injectable";
import showErrorPopupInjectable from "../features/show-error-popup.injectable";
import enforceSingleApplicationInstanceInjectable from "./enforce-single-application-instance.injectable";

import type { Mock } from "vitest";

import type { IsTauriBuildRunning, TauriBuildLock } from "../features/is-tauri-build-running.injectable";

describe("enforce-single-application-instance", () => {
  let gotLock: boolean;
  let tauriLock: TauriBuildLock | undefined;
  let isTauriBuildRunning: Mock<IsTauriBuildRunning>;
  let forceAppExit: Mock<() => void>;
  let showErrorPopup: Mock<(heading: string, message: string) => void>;
  let run: () => void;

  beforeEach(() => {
    gotLock = true;
    tauriLock = undefined;
    isTauriBuildRunning = vi.fn<IsTauriBuildRunning>(() => tauriLock);
    forceAppExit = vi.fn<() => void>();
    showErrorPopup = vi.fn<(heading: string, message: string) => void>();

    const di = createContainer("enforce-single-application-instance");

    di.register(
      enforceSingleApplicationInstanceInjectable,
      requestSingleInstanceLockInjectable,
      forceAppExitInjectable,
      showErrorPopupInjectable,
      isTauriBuildRunningInjectable,
    );
    di.override(requestSingleInstanceLockInjectable, () => () => gotLock);
    di.override(forceAppExitInjectable, () => forceAppExit);
    di.override(showErrorPopupInjectable, () => showErrorPopup);
    di.override(isTauriBuildRunningInjectable, () => isTauriBuildRunning);
    run = () => di.inject(enforceSingleApplicationInstanceInjectable).run();
  });

  it("exits silently without the lock, and does not look for the Tauri build", () => {
    gotLock = false;
    run();

    expect(forceAppExit).toHaveBeenCalledOnce();
    expect(isTauriBuildRunning).not.toHaveBeenCalled();
    expect(showErrorPopup).not.toHaveBeenCalled();
  });

  it("starts with the lock when no Tauri build runs", () => {
    run();

    expect(isTauriBuildRunning).toHaveBeenCalledOnce();
    expect(forceAppExit).not.toHaveBeenCalled();
    expect(showErrorPopup).not.toHaveBeenCalled();
  });

  it("says that the Tauri build runs, then exits", () => {
    tauriLock = {
      dataDirectory: "/data/Freelens",
      linkPath: "/data/Freelens/FreelensTauriLock",
    };
    run();

    expect(showErrorPopup).toHaveBeenCalledWith(
      "Freelens is already running",
      "The Tauri build of Freelens is using /data/Freelens. Quit it, then start this one again. If it is not running, delete /data/Freelens/FreelensTauriLock.",
    );
    expect(forceAppExit).toHaveBeenCalledOnce();
    expect(showErrorPopup.mock.invocationCallOrder[0]).toBeLessThan(forceAppExit.mock.invocationCallOrder[0]);
  });
});

describe("isLiveTarget", () => {
  const alive = new Set([42]);
  const isAlive = (pid: number) => alive.has(pid);

  it("is live for a process of this host that is alive", () => {
    expect(isLiveTarget("this-host.local-42", "this-host.local", isAlive)).toBe(true);
  });

  it("is not live for a process of this host that is gone", () => {
    expect(isLiveTarget("this-host.local-43", "this-host.local", isAlive)).toBe(false);
  });

  it("is live for a process of another host, as Chromium assumes", () => {
    expect(isLiveTarget("other-host-43", "this-host.local", isAlive)).toBe(true);
  });

  it("is not live for a target that does not parse", () => {
    for (const target of ["", "nohyphen", "-42", "host-", "host-4x2", "host-0"]) {
      expect(
        isLiveTarget(target, "this-host.local", () => true),
        target,
      ).toBe(false);
    }
  });
});
