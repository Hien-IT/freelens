/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The Electron figures of SC-007 (specs/002-messaging-for-tauri/quickstart.md):
// a hidden window invokes a handler in main with texts of about 1 KB, 1 MB and
// 10 MB, which answers each with the same text, as messaging-check:echo does in
// the Tauri build, and the round-trip times are printed, three runs each.
// Run it with the Electron binary the build uses.

const { app, BrowserWindow, ipcMain } = require("electron");

const sizes = [1_000, 1_000_000, 10_000_000];
const runs = 3;

const median = (values) => [...values].sort((left, right) => left - right)[Math.floor(values.length / 2)];

ipcMain.handle("messaging-check:echo", (_event, { text }) => text);

ipcMain.on("measured", (_event, results) => {
  for (const bytes of sizes) {
    const times = results[bytes].map((ms) => ms.toFixed(1)).join(", ");

    console.log(`Electron: answer of ${bytes} bytes in ${median(results[bytes]).toFixed(1)} ms (median of ${times})`);
  }

  app.quit();
});

const page = `<script>
  const { ipcRenderer } = require("electron");

  (async () => {
    const results = {};

    for (const bytes of ${JSON.stringify(sizes)}) {
      results[bytes] = [];

      for (let run = 0; run < ${runs}; run++) {
        const text = "x".repeat(bytes);
        const started = performance.now();
        const answer = await ipcRenderer.invoke("messaging-check:echo", { text });

        if (answer.length !== bytes) {
          throw new Error("the echo of " + bytes + " bytes came back with " + answer.length);
        }

        results[bytes].push(performance.now() - started);
      }
    }

    ipcRenderer.send("measured", results);
  })();
</script>`;

app.whenReady().then(() => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });

  window.loadURL(`data:text/html,${encodeURIComponent(page)}`);
});
