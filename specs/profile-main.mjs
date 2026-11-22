/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Profile the Freelens main process while a kind cluster is opened and its lists are viewed.
// usage (from the repo root): node specs/profile-main.mjs <workdir> <kubeconfig> <Freelens.app> [seconds]
// Writes main.cpuprofile, marks.json and stdout.log into <workdir>. NO_PROFILE=1 runs without the profiler.
// The kubeconfig must have the context kind-freelens-profile (specs/tauri-port-runbook.md, 0.4).
import { execSync, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(path.resolve("freelens/package.json"));
const { chromium } = require("playwright");

const [W, KUBECONFIG, BUNDLE, secondsArg] = process.argv.slice(2);
const SECONDS = Number(secondsArg ?? 60);
const D = path.join(W, "run");
const APP = path.join(BUNDLE, "Contents/MacOS/Freelens");
const CONTEXT = "kind-freelens-profile";

// A fresh data dir per run: sidebar and namespace state persist in it.
rmSync(D, { recursive: true, force: true });
mkdirSync(path.join(D, "Freelens"), { recursive: true });
writeFileSync(
  path.join(D, "Freelens/lens-user-store.json"),
  JSON.stringify({ preferences: { syncKubeconfigEntries: [{ filePath: KUBECONFIG }] } }),
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const marks = {};
let profileStart = 0;
const mark = (name) => {
  marks[name] = Math.round(performance.now() - profileStart);
  console.log(`[${marks[name]} ms] ${name}`);
};

let stdout = "";
const child = spawn(APP, [`--user-data-dir=${D}/userdata`, "--inspect=5858", "--remote-debugging-port=9223"], {
  env: { ...process.env, FREELENS_INTEGRATION_TESTING_DIR: D, KUBECONFIG },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (c) => (stdout += c));
child.stderr.on("data", (c) => (stdout += c));

async function until(fn, timeoutMs, what) {
  const t = Date.now();
  while (Date.now() - t < timeoutMs) {
    const v = await fn().catch(() => undefined);
    if (v) return v;
    await sleep(100);
  }
  throw new Error(`timeout: ${what}`);
}

async function openSidebarItem(frame, parent, item) {
  const sel = `[data-testid="link-for-sidebar-item-${item}"]`;
  if (!(await frame.locator(sel).count()))
    await frame.dispatchEvent(`[data-testid="link-for-sidebar-item-${parent}"]`, "click");
  await frame.dispatchEvent(sel, "click");
}

// CPU seconds of the main process and its children (helpers, freelens-k8s-proxy), keyed by "<pid> <name>".
const cpuSnapshot = () => {
  const rows = execSync("ps -A -o pid=,ppid=,time=,comm=").toString().trim().split("\n");
  const out = {};
  for (const r of rows) {
    const [, pid, ppid, time, comm] = r.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/) ?? [];
    if (Number(pid) !== child.pid && Number(ppid) !== child.pid) continue;
    const sec = time.split(":").reduce((a, v) => a * 60 + Number(v), 0);
    out[`${pid} ${path.basename(comm)}`] = sec;
  }
  return out;
};

const rssOf = () => {
  const pids = execSync(`pgrep -f -- "${D}/" || true`).toString().trim().split("\n").filter(Boolean);
  const rows = execSync(`ps -o pid=,rss= -p ${pids.join(",")}`)
    .toString()
    .trim()
    .split("\n");
  const kb = Object.fromEntries(rows.map((r) => r.trim().split(/\s+/).map(Number)));
  return {
    mainMb: Math.round((kb[child.pid] ?? 0) / 1024),
    totalMb: Math.round(Object.values(kb).reduce((a, b) => a + b, 0) / 1024),
    procs: pids.length,
  };
};

let page, frame;
try {
  await until(async () => stdout.includes('"first-application-window" loaded'), 60_000, "window loaded");

  // Main process inspector.
  const targets = await until(async () => (await fetch("http://127.0.0.1:5858/json/list")).json(), 10_000, "inspector");
  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) pending.get(m.id)(m), pending.delete(m.id);
  };
  const send = (method, params = {}) =>
    new Promise((r) => {
      pending.set(++id, r);
      ws.send(JSON.stringify({ id, method, params }));
    });

  // Renderer, to drive the UI.
  const browser = await until(() => chromium.connectOverCDP("http://127.0.0.1:9223"), 15_000, "renderer CDP");
  page = await until(
    async () =>
      browser
        .contexts()
        .flatMap((c) => c.pages())
        .find((p) => p.url().startsWith("https://renderer.freelens.app")),
    15_000,
    "renderer page",
  );

  const PROFILE = !process.env.NO_PROFILE;
  if (PROFILE) await send("Profiler.enable"), await send("Profiler.start");
  const cpu0 = cpuSnapshot();
  profileStart = performance.now();
  mark("profile start");

  await page.click("[data-testid=welcome-menu-container] li a");
  await page.click(`div.TableCell >> text='${CONTEXT}'`, { timeout: 30_000 });
  mark("cluster clicked");
  const frameEl = await page.waitForSelector("iframe[id^=cluster-frame-]", { timeout: 60_000 });
  frame = await frameEl.contentFrame();
  await frame.waitForSelector("[data-testid=cluster-sidebar]", { timeout: 120_000 });
  mark("cluster connected (sidebar shown)");

  await openSidebarItem(frame, "config", "config-maps");
  mark("config maps clicked");
  await frame.click("[data-testid=namespace-select-filter]", { timeout: 30_000 });
  await frame.click('.NamespaceSelectFilterMenu >> text="All Namespaces"', { timeout: 30_000 });
  await frame.press("[data-testid=namespace-select-filter] input", "Escape").catch(() => {});
  await frame.waitForSelector('[data-testid=namespace-select-filter] >> text="All namespaces"', { timeout: 30_000 });
  mark("all namespaces selected");
  await frame.waitForSelector(".TableRow >> text=/^cm-/", { timeout: 30_000 });
  mark("config maps rows shown");
  const cmHeader = await frame
    .locator("body")
    .innerText()
    .then((t) => (t.match(/\d+ items?/) ?? [""])[0]);
  console.log(`config maps header: ${cmHeader}`);

  await openSidebarItem(frame, "workloads", "pods");
  mark("pods clicked");
  await frame.waitForSelector(".TableRow >> text=/kube-apiserver|coredns|etcd/", { timeout: 60_000 });
  mark("pods rows shown");

  const rest = SECONDS * 1000 - (performance.now() - profileStart);
  if (rest > 0) await sleep(rest);
  const rss = rssOf();
  const cpu1 = cpuSnapshot();
  const cpu = Object.fromEntries(Object.entries(cpu1).map(([k, v]) => [k, +(v - (cpu0[k] ?? 0)).toFixed(2)]));
  console.log(`cpu s during profile: ${JSON.stringify(cpu)}`);
  const result = PROFILE ? (await send("Profiler.stop")).result : undefined;
  mark("profile stop");
  if (PROFILE) writeFileSync(path.join(W, "main.cpuprofile"), JSON.stringify(result.profile));
  writeFileSync(path.join(W, "marks.json"), JSON.stringify({ marks, rss, cpu, cmHeader }, null, 2));
  console.log(`rss: ${JSON.stringify(rss)}`);
  ws.close();
  await browser.close().catch(() => {});
} catch (error) {
  if (page) await page.screenshot({ path: path.join(W, "failure.png") }).catch(() => {});
  if (frame)
    writeFileSync(
      path.join(W, "failure-frame.txt"),
      await frame
        .locator("body")
        .innerText()
        .catch((e) => String(e)),
    );
  if (frame) writeFileSync(path.join(W, "failure-frame.html"), await frame.content().catch((e) => String(e)));
  throw error;
} finally {
  writeFileSync(path.join(W, "stdout.log"), stdout);
  child.kill("SIGTERM");
  await sleep(3000);
  const left = execSync(`pgrep -f -- "${D}/" || true`).toString().trim();
  if (left)
    console.log(`warning: still running: ${left.replace(/\n/g, ",")}`), execSync(`pkill -9 -f -- "${D}/" || true`);
}
