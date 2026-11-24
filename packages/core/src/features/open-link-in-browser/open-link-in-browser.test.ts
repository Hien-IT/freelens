/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import openLinkInBrowserInjectable from "../../common/utils/open-link-in-browser.injectable";
import { getMainAndRenderer } from "../../test-utils/channels-between-main-and-renderer";
import openExternalInjectable from "./main/open-external.injectable";
import openLinkInBrowserRequestListenerInjectable from "./main/request-listener.injectable";

import type { DiContainer } from "@ogre-tools/injectable";
import type { Mock } from "vitest";

describe("open-link-in-browser", () => {
  let mainDi: DiContainer;
  let rendererDi: DiContainer;
  let openExternal: Mock<(url: string) => Promise<void>>;

  beforeEach(() => {
    const both = getMainAndRenderer();

    mainDi = both.mainDi;
    rendererDi = both.rendererDi;

    // the real implementations on both sides, with the shell of Electron faked
    openExternal = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
    mainDi.override(openExternalInjectable, () => openExternal);
    mainDi.unoverride(openLinkInBrowserInjectable);
    rendererDi.unoverride(openLinkInBrowserInjectable);
    both.listenInMain(openLinkInBrowserRequestListenerInjectable);
  });

  it.each(["https://freelens.app/", "http://localhost:8080/some-path"])(
    "opens %s in main when the renderer asks",
    async (url) => {
      await rendererDi.inject(openLinkInBrowserInjectable)(url);

      expect(openExternal).toHaveBeenCalledWith(url);
    },
  );

  it.each(["file:///etc/passwd", "javascript:alert(1)", "smb://server/share"])(
    "refuses %s in main, whatever the renderer sends",
    async (url) => {
      await expect(rendererDi.inject(openLinkInBrowserInjectable)(url)).rejects.toThrow("not an http(s) URL");

      expect(openExternal).not.toHaveBeenCalled();
    },
  );

  it("refuses a URL that is not http(s) in main itself", async () => {
    await expect(mainDi.inject(openLinkInBrowserInjectable)("file:///etc/passwd")).rejects.toThrow(
      "not an http(s) URL",
    );
  });
});
