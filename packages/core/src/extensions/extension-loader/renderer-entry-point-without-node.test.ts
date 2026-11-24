/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { pathToFileURL } from "node:url";
import { observable } from "mobx";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExtensionLoader } from "./extension-loader";

import type { Logger } from "@freelensapp/logger";

import type { InstalledExtension, LensExtensionId, LensExtensionInstance } from "../installed-extension";

interface LoaderInternals {
  servedUrlOf(extension: InstalledExtension, fileSegments: string[]): string;
}

const extensionClass = (activate: string) => `
export default class {
  constructor(extension) {
    this.id = extension.id;
    this.name = extension.manifest.name;
    this.sanitizedExtensionId = extension.id;
  }

  async activate() { ${activate} }
  async enable() {}
  async disable() {}
}
`;

// The renderer has no Node, so an ES module's `require` is not defined there,
// as it is not in the ES modules of Node these entry points are imported as.
const entryPoints: Record<string, string> = {
  "requires-at-import": `require("node:fs");\n${extensionClass("")}`,
  "requires-on-activation": extensionClass(`require("node:fs");`),
  "next-extension": extensionClass(""),
};

describe("a renderer entry point which uses require", () => {
  let logger: Record<"debug" | "error" | "info" | "silly" | "warn", ReturnType<typeof vi.fn>>;
  let extensionLoader: ExtensionLoader;

  beforeEach(async () => {
    logger = { debug: vi.fn(), error: vi.fn(), info: vi.fn(), silly: vi.fn(), warn: vi.fn() };

    extensionLoader = new ExtensionLoader({
      extensionInstances: observable.map<LensExtensionId, LensExtensionInstance>(),
      logger: logger as unknown as Logger,
      extensionEntryPointName: "renderer",
      fileUrlOfPath: pathToFileURL,
      updateExtensionsState: vi.fn(),
      getExtension: () => ({ register: vi.fn(), deregister: vi.fn() }) as never,
      getRandomId: () => "a-token",
      joinPaths: (...paths) => paths.join("/"),
      getBasenameOfPath: (path) => path.split("/").at(-1) ?? "",
      fetch: vi.fn(async () => ({ status: 404 })) as never,
    });

    // the entry points are imported as data, rather than over the scheme main serves them on
    vi.spyOn(extensionLoader as unknown as LoaderInternals, "servedUrlOf").mockImplementation(
      (extension) => `data:text/javascript,${encodeURIComponent(entryPoints[extension.id])}`,
    );

    for (const name of Object.keys(entryPoints)) {
      extensionLoader.addExtension({
        id: name,
        absolutePath: `/some-extensions/${name}`,
        manifestPath: `/some-extensions/${name}/package.json`,
        manifest: { name, version: "0.1.0", engines: { freelens: "^2.0.0" }, renderer: "renderer.js" },
        isCompatible: true,
        isManaged: false,
        isVerified: false,
        isEnabled: true,
      });
    }

    const loading = await extensionLoader.autoInitExtensions();

    await Promise.all(loading.map(({ loaded }) => loaded));
  });

  it("logs the extension which requires at import by its name", () => {
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringMatching(/can't load renderer for "requires-at-import": ReferenceError: require is not defined/),
      expect.anything(),
    );
    expect(extensionLoader.getLoadFailures("requires-at-import")).toEqual([
      { process: "renderer", stage: "import", message: expect.stringMatching(/^require is not defined/) },
    ]);
  });

  it("logs the extension which requires on activation by its name", () => {
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("activation extension error"),
      expect.objectContaining({
        ext: expect.objectContaining({ manifest: expect.objectContaining({ name: "requires-on-activation" }) }),
        error: expect.objectContaining({
          name: "ReferenceError",
          message: expect.stringMatching(/^require is not defined/),
        }),
      }),
    );
    expect(extensionLoader.getLoadFailures("requires-on-activation")).toEqual([
      { process: "renderer", stage: "activate", message: expect.stringMatching(/^require is not defined/) },
    ]);
  });

  it("loads the next extension", () => {
    expect(extensionLoader.getInstanceByName("next-extension")).toBeDefined();
    expect(extensionLoader.getLoadFailures("next-extension")).toEqual([]);
  });
});
