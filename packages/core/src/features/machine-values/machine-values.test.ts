/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { beforeEach, describe, expect, it } from "vitest";
import homeDirectoryPathInjectable from "../../common/os/home-directory-path.injectable";
import kubeDirectoryPathInjectable from "../../common/os/kube-directory-path.injectable";
import bundledBinaryPathInjectable from "../../common/utils/main/bundled-binary-path.injectable";
import isDebuggingInjectable from "../../common/vars/is-debugging.injectable";
import isFlatpakPackageInjectable from "../../common/vars/is-flatpak-package.injectable";
import isSnapPackageInjectable from "../../common/vars/is-snap-package.injectable";
import platformInjectable from "../../common/vars/platform.injectable";
import { getMainAndRenderer } from "../../test-utils/channels-between-main-and-renderer";
import machineValuesRequestListenerInjectable from "./main/request-listener.injectable";
import setupMachineValuesInjectable from "./renderer/setup.injectable";
import machineValuesStateInjectable from "./renderer/state.injectable";

import type { DiContainer } from "@ogre-tools/injectable";

import type { MachineValues } from "./common/channel";

const valuesOfMain: MachineValues = {
  platform: "win32",
  isDebugging: true,
  isSnap: false,
  isFlatpak: true,
  homeDirectory: "C:\\Users\\some-user",
  kubeDirectory: "C:\\Users\\some-user\\.kube",
  bundledHelmPath: "C:\\Program Files\\Freelens\\resources\\x64\\helm.exe",
};

describe("machine-values", () => {
  let mainDi: DiContainer;
  let rendererDi: DiContainer;

  beforeEach(() => {
    const both = getMainAndRenderer();

    mainDi = both.mainDi;
    rendererDi = both.rendererDi;
    both.listenInMain(machineValuesRequestListenerInjectable);

    mainDi.override(platformInjectable, () => valuesOfMain.platform);
    mainDi.override(isDebuggingInjectable, () => valuesOfMain.isDebugging);
    mainDi.override(isSnapPackageInjectable, () => valuesOfMain.isSnap);
    mainDi.override(isFlatpakPackageInjectable, () => valuesOfMain.isFlatpak);
    mainDi.override(homeDirectoryPathInjectable, () => valuesOfMain.homeDirectory);
    mainDi.override(kubeDirectoryPathInjectable, () => valuesOfMain.kubeDirectory);
    mainDi.override(bundledBinaryPathInjectable, () => valuesOfMain.bundledHelmPath);

    rendererDi.unoverride(machineValuesStateInjectable);
  });

  it("refuses a read of the renderer's state before main answered", () => {
    expect(() => rendererDi.inject(machineValuesStateInjectable).get()).toThrow(
      "Tried to read the machine values before main answered with them.",
    );
  });

  describe("when the renderer has started", () => {
    beforeEach(async () => {
      await rendererDi.inject(setupMachineValuesInjectable).run();
    });

    it("holds what main's injectables answer", () => {
      expect(rendererDi.inject(machineValuesStateInjectable).get()).toEqual(valuesOfMain);
    });

    it("reads the platform and the three flags from it", () => {
      // they are marked as having side effects, which they have in main
      expect(platformInjectable.instantiate(rendererDi)).toBe("win32");
      expect(isDebuggingInjectable.instantiate(rendererDi)).toBe(true);
      expect(isSnapPackageInjectable.instantiate(rendererDi)).toBe(false);
      expect(isFlatpakPackageInjectable.instantiate(rendererDi)).toBe(true);
    });

    it("reads the home and the kube directories from it", () => {
      expect(rendererDi.inject(homeDirectoryPathInjectable)).toBe("C:\\Users\\some-user");
      expect(rendererDi.inject(kubeDirectoryPathInjectable)).toBe("C:\\Users\\some-user\\.kube");
    });

    it("refuses to be filled twice", () => {
      expect(() => rendererDi.inject(machineValuesStateInjectable).set(valuesOfMain)).toThrow(
        "Tried to overwrite the machine values.",
      );
    });
  });
});
