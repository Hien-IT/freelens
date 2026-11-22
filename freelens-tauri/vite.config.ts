/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const ui = (path: string) => fileURLToPath(new URL(`./ui/${path}`, import.meta.url));

export default defineConfig({
  root: ui(""),
  base: "/",
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
