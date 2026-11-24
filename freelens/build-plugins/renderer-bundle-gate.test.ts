/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { describe, expect, it } from "vitest";
import { findNodeBringers, formatGateResult } from "./renderer-bundle-gate";

import type { ModuleInfoLike } from "./renderer-bundle-gate";

const root = "/repo";
const entry = "/repo/freelens/src/renderer/index.html";
const graph: Record<string, Partial<ModuleInfoLike>> = {
  [entry]: { isEntry: true },
  "/repo/freelens/src/renderer/index.ts": { importers: [entry] },
  // a workspace module importing a builtin itself
  "/repo/packages/core/src/common/path/join-paths.injectable.ts": {
    importers: ["/repo/freelens/src/renderer/index.ts"],
  },
  // a workspace module bringing a builtin in through two npm modules
  "/repo/packages/core/src/common/fs/fs.injectable.ts": { importers: ["/repo/freelens/src/renderer/index.ts"] },
  "/repo/node_modules/fs-extra/lib/index.js": { importers: ["/repo/packages/core/src/common/fs/fs.injectable.ts"] },
  "/repo/node_modules/graceful-fs/graceful-fs.js": { importers: ["/repo/node_modules/fs-extra/lib/index.js"] },
  // a dynamic importer
  "/repo/packages/core/src/renderer/lazy.tsx": { dynamicImporters: ["/repo/freelens/src/renderer/index.ts"] },
};
const getModuleInfo = (id: string) => {
  const info = graph[id];

  return (
    info && {
      importers: info.importers ?? [],
      dynamicImporters: info.dynamicImporters ?? [],
      isEntry: info.isEntry ?? false,
    }
  );
};

describe("renderer bundle gate", () => {
  const bringers = findNodeBringers(
    [
      { specifier: "node:path", importer: "/repo/packages/core/src/common/path/join-paths.injectable.ts" },
      { specifier: "fs", importer: "/repo/node_modules/graceful-fs/graceful-fs.js" },
      { specifier: "constants", importer: "/repo/node_modules/graceful-fs/graceful-fs.js" },
      { specifier: "electron", importer: "/repo/packages/core/src/renderer/lazy.tsx?used" },
    ],
    getModuleInfo,
    root,
  );

  it("names the workspace module that imports a builtin directly", () => {
    expect(bringers.find(({ module }) => module === "packages/core/src/common/path/join-paths.injectable.ts")).toEqual({
      module: "packages/core/src/common/path/join-paths.injectable.ts",
      specifiers: ["node:path"],
      via: "node:path",
      chain: [
        "packages/core/src/common/path/join-paths.injectable.ts",
        "freelens/src/renderer/index.ts",
        "freelens/src/renderer/index.html",
      ],
    });
  });

  it("names the first workspace module above node_modules, with every specifier it brings in", () => {
    expect(bringers.find(({ module }) => module === "packages/core/src/common/fs/fs.injectable.ts")).toEqual({
      module: "packages/core/src/common/fs/fs.injectable.ts",
      specifiers: ["constants", "fs"],
      via: "fs",
      chain: [
        "node_modules/graceful-fs/graceful-fs.js",
        "node_modules/fs-extra/lib/index.js",
        "packages/core/src/common/fs/fs.injectable.ts",
        "freelens/src/renderer/index.ts",
        "freelens/src/renderer/index.html",
      ],
    });
  });

  it("follows dynamic importers and ignores query strings", () => {
    expect(bringers.map(({ module }) => module)).toContain("packages/core/src/renderer/lazy.tsx");
  });

  it("fails on each module that brings Node in, with its chain", () => {
    const fsBringer = bringers.filter(({ module }) => module === "packages/core/src/common/fs/fs.injectable.ts");

    expect(formatGateResult(fsBringer)).toBe(
      [
        "renderer bundle imports Node: constants, fs",
        "  fs",
        "  <- node_modules/graceful-fs/graceful-fs.js",
        "  <- node_modules/fs-extra/lib/index.js",
        "  <- packages/core/src/common/fs/fs.injectable.ts  (brings it in)",
        "  <- freelens/src/renderer/index.ts",
        "  <- freelens/src/renderer/index.html",
      ].join("\n"),
    );
    expect(formatGateResult(bringers).match(/^renderer bundle imports Node/gm)).toHaveLength(3);
  });

  it("fails on an import with no workspace module above it, naming its importer", () => {
    const [orphan] = findNodeBringers(
      [{ specifier: "fs", importer: "__vite-browser-external:fs" }],
      getModuleInfo,
      root,
    );

    expect(orphan).toEqual({
      module: "__vite-browser-external:fs",
      specifiers: ["fs"],
      via: "fs",
      chain: ["__vite-browser-external:fs"],
    });
  });

  it("passes when nothing brings Node in", () => {
    expect(formatGateResult(findNodeBringers([], getModuleInfo, root))).toBe("");
  });
});
