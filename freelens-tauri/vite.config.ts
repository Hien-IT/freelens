/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

import type { Plugin } from "vite";

const ui = (path: string) => fileURLToPath(new URL(`./ui/${path}`, import.meta.url));

const tarStub = "\0tar-stub";

// shortcut: the messaging check reaches the @freelensapp/utilities barrel through
// @freelensapp/application, and the barrel loads tar, whose classes extend
// Node's EventEmitter as soon as the module is evaluated. No view extracts an
// archive, so tar becomes a module that fails only when called. Drop this once
// spec 003 makes the renderer's dependencies load without Node.
const noTarInViews: Plugin = {
  name: "no-tar-in-views",
  enforce: "pre",
  resolveId: (id) => (id === "tar" ? tarStub : undefined),
  load: (id) =>
    id === tarStub
      ? 'export const list = () => { throw new Error("tar is not available in a view of the Tauri build"); };'
      : undefined,
};

export default defineConfig({
  root: ui(""),
  base: "/",
  plugins: [noTarInViews],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // WKWebView supports module preloading, so the polyfill is dead weight.
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: {
        index: ui("index.html"),
        cluster: ui("cluster.html"),
      },
    },
  },
});
