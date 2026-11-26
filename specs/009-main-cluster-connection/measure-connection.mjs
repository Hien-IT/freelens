/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Measures the cluster connection of both builds with the same steps, on the
// kind cluster of specs/baseline.md (specs/009-main-cluster-connection/research.md, R17).
//
// usage (from the repo root): node specs/009-main-cluster-connection/measure-connection.mjs <mode> <kind kubeconfig> [runs]
//   lists    the scenario of specs/baseline.md, three runs per build: the times
//            to the sidebar, to the first Config Map row of All Namespaces and
//            to the first Pod row, and the CPU of the main process over 60 s
//            (SC-002, SC-003, SC-004, SC-006)
//   watch    a pod created and deleted with kubectl, five times per build: the
//            time from kubectl returning to its row appearing and leaving (SC-005)
// env: ELECTRON_APP (default freelens/dist/mac-arm64/Freelens.app),
//      TAURI_APP (default the dmg of freelens-tauri/src-tauri/target/release/bundle/dmg),
//      BUILDS (default "electron,tauri")
//
// Every time is taken in the page, as the wall clock (performance.timeOrigin +
// performance.now()), at the click and when the element is in the document:
// the Tauri pages post them as marks under --scenario=lists; in the Electron
// build a script injected through CDP records the same points with a
// MutationObserver, and clicks in the page. Neither build is timed by polling.
// Each run uses a data directory of its own that syncs only the kind
// kubeconfig, so that no build reads the user's ~/.kube.

import { execFileSync, execSync, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(path.resolve("freelens/package.json"));
const { chromium } = require("playwright");

const [mode, kubeconfig, runsArg] = process.argv.slice(2);
if (!["lists", "watch"].includes(mode) || !kubeconfig) {
  console.error("usage: measure-connection.mjs <lists|watch> <kind kubeconfig> [runs]");
  process.exit(2);
}
const CONTEXT = "kind-freelens-profile";
const SECONDS = 60;
const runs = Number(runsArg ?? (mode === "lists" ? 3 : 5));
const builds = (process.env.BUILDS ?? "electron,tauri").split(",");
const electronApp = process.env.ELECTRON_APP ?? "freelens/dist/mac-arm64/Freelens.app";
const tauriSource =
  process.env.TAURI_APP ??
  path.join(
    "freelens-tauri/src-tauri/target/release/bundle/dmg",
    readdirSync("freelens-tauri/src-tauri/target/release/bundle/dmg").find((name) => name.endsWith(".dmg")) ?? "",
  );

const workdir = mkdtempSync(path.join(os.tmpdir(), "measure-connection-"));
console.log(`workdir=${workdir}`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
const kubectl = (...args) =>
  execFileSync("kubectl", ["--kubeconfig", kubeconfig, ...args], { env: { ...process.env, KUBECONFIG: "" } })
    .toString()
    .trim();

async function until(fn, timeoutMs, what) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await Promise.resolve()
      .then(fn)
      .catch(() => undefined);
    if (value) return value;
    await sleep(50);
  }
  throw new Error(`timeout: ${what}`);
}

/** CPU seconds of one process, from `ps -o time`. */
function cpuOf(pid) {
  const time = execSync(`ps -o time= -p ${pid}`).toString().trim();
  return time.split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

/** A copy of the Tauri app, from its dmg or its bundle. */
function tauriBundle() {
  if (!tauriSource.endsWith(".dmg")) return tauriSource;
  const mount = path.join(workdir, "mnt");
  mkdirSync(mount);
  execFileSync("hdiutil", ["attach", "-nobrowse", "-readonly", "-mountpoint", mount, tauriSource]);
  const app = readdirSync(mount).find((name) => name.endsWith(".app"));
  const bundle = path.join(workdir, app);
  execFileSync("ditto", [path.join(mount, app), bundle]);
  execFileSync("hdiutil", ["detach", mount]);
  return bundle;
}

// ---------------------------------------------------------------------------
// The Tauri build

/** Starts the Tauri build; `marks` maps a mark's name to its wall clock. */
function startTauri(bundle, dir) {
  const data = path.join(dir, "data");
  mkdirSync(data, { recursive: true });
  writeFileSync(
    path.join(data, "lens-user-store.json"),
    JSON.stringify({ preferences: { syncKubeconfigEntries: [] } }),
  );
  const marks = new Map();
  const child = spawn(
    path.join(bundle, "Contents/MacOS/freelens-spike"),
    [`--data-dir=${data}`, `--kubeconfig=${kubeconfig}`, `--open-cluster=${CONTEXT}`, "--scenario=lists"],
    { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, KUBECONFIG: "" } },
  );
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      appendFileSync(path.join(dir, "tauri-stdout.log"), `${Date.now()} ${line}\n`);
      const mark = /^Mark "(.+)-(\d{13})"$/.exec(line);
      if (mark && !marks.has(mark[1])) marks.set(mark[1], Number(mark[2]));
    }
  });
  return { child, marks, stop: async () => (child.kill(), sleep(1500)) };
}

async function tauriLists(bundle, run) {
  const dir = path.join(workdir, `tauri-lists-${run}`);
  mkdirSync(dir);
  const build = startTauri(bundle, dir);
  try {
    // The frame posts the click of Config Maps first; the CPU counts from it.
    await until(async () => build.marks.has("configmaps-clicked"), 60_000, "configmaps-clicked");
    const cpu0 = cpuOf(build.child.pid);
    const started = Date.now();
    await until(async () => build.marks.has("pods-first-row"), 60_000, "pods-first-row");
    const rest = SECONDS * 1000 - (Date.now() - started);
    if (rest > 0) await sleep(rest);
    const cpu = cpuOf(build.child.pid) - cpu0;
    const m = (name) => build.marks.get(name);
    return {
      sidebar: m("sidebar-shown") && m("cluster-clicked") ? m("sidebar-shown") - m("cluster-clicked") : undefined,
      configMaps: m("configmaps-first-row") - m("configmaps-clicked"),
      pods: m("pods-first-row") - m("pods-clicked"),
      cpu: +cpu.toFixed(2),
    };
  } finally {
    await build.stop();
  }
}

async function tauriWatch(bundle) {
  const dir = path.join(workdir, "tauri-watch");
  mkdirSync(dir);
  const build = startTauri(bundle, dir);
  try {
    await until(async () => build.marks.has("pods-first-row"), 60_000, "pods-first-row");
    return await watchTimes((name, present) => build.marks.get(`row-${present ? "in" : "out"}-${name}`));
  } finally {
    await build.stop();
  }
}

// ---------------------------------------------------------------------------
// The Electron build

/** Records in the frame the wall clock of the first element matching each selector. */
const observerScript = `(() => {
  const now = () => Math.round(performance.timeOrigin + performance.now());
  window.__marks = window.__marks || {};
  window.__expect = (name, test) => {
    if (window.__marks[name]) return;
    const check = () => {
      if (!window.__marks[name] && test()) { window.__marks[name] = now(); observer.disconnect(); }
    };
    const observer = new MutationObserver(check);
    observer.observe(document, { childList: true, subtree: true, characterData: true });
    check();
  };
  window.__click = (name, selector) => { window.__marks[name] = now(); document.querySelector(selector).click(); };
  window.__rows = (pattern) => [...document.querySelectorAll(".TableRow")].some((row) => new RegExp(pattern).test(row.textContent));
})()`;

async function startElectron(dir) {
  const data = path.join(dir, "data");
  mkdirSync(path.join(data, "Freelens"), { recursive: true });
  writeFileSync(
    path.join(data, "Freelens/lens-user-store.json"),
    JSON.stringify({ preferences: { syncKubeconfigEntries: [{ filePath: kubeconfig }] } }),
  );
  const port = 9300 + Math.floor(Math.random() * 500);
  const child = spawn(
    path.join(electronApp, "Contents/MacOS/Freelens"),
    [`--user-data-dir=${data}/userdata`, `--remote-debugging-port=${port}`],
    { env: { ...process.env, FREELENS_INTEGRATION_TESTING_DIR: data, KUBECONFIG: "" }, stdio: "ignore" },
  );
  const browser = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${port}`), 30_000, "electron CDP");
  const page = await until(
    async () =>
      browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((candidate) => candidate.url().startsWith("https://renderer.freelens.app")),
    30_000,
    "electron page",
  );
  await page.waitForSelector("[data-testid=welcome-menu-container] li a", { timeout: 60_000 });
  return {
    child,
    browser,
    page,
    stop: async () => {
      await browser.close().catch(() => {});
      child.kill();
      await sleep(3000);
      execSync(`pkill -9 -f -- "${data}/" || true`);
    },
  };
}

/** Opens the cluster in the Electron build; returns its frame with the observer installed. */
async function electronOpen(build) {
  const { page } = build;
  await page.click("[data-testid=welcome-menu-container] li a");
  await page.waitForSelector(`div.TableCell >> text='${CONTEXT}'`, { timeout: 30_000 });
  await page.evaluate(observerScript);
  const cell = await page.$(`div.TableCell >> text='${CONTEXT}'`);
  const clicked = await cell.evaluate((element) => {
    const time = Math.round(performance.timeOrigin + performance.now());
    element.click();
    return time;
  });
  const frameElement = await page.waitForSelector("iframe[id^=cluster-frame-]", { timeout: 60_000 });
  const frame = await frameElement.contentFrame();
  await frame.waitForLoadState("domcontentloaded");
  await frame.evaluate(observerScript);
  await frame.evaluate(() => window.__expect("sidebar", () => document.querySelector("[data-testid=cluster-sidebar]")));
  await frame.waitForFunction(() => window.__marks.sidebar, null, { timeout: 120_000 });
  const sidebar = await frame.evaluate(() => window.__marks.sidebar);
  return { frame, clicked, sidebar };
}

async function electronSidebarItem(frame, parent, item, mark) {
  const selector = `[data-testid="link-for-sidebar-item-${item}"]`;
  if (!(await frame.$(selector))) {
    await frame.dispatchEvent(`[data-testid="link-for-sidebar-item-${parent}"]`, "click");
    await frame.waitForSelector(selector);
  }
  await frame.evaluate(([name, sel]) => window.__click(name, sel), [mark, selector]);
}

async function electronLists(run) {
  const dir = path.join(workdir, `electron-lists-${run}`);
  mkdirSync(dir);
  const build = await startElectron(dir);
  try {
    const cpu0 = cpuOf(build.child.pid);
    const started = Date.now();
    const { frame, clicked, sidebar } = await electronOpen(build);
    await electronSidebarItem(frame, "config", "config-maps", "configmaps-clicked");
    await frame.click("[data-testid=namespace-select-filter]", { timeout: 30_000 });
    const allNamespaces = await frame.waitForSelector('.NamespaceSelectFilterMenu >> text="All Namespaces"');
    await frame.evaluate(() => window.__expect("configmaps-first-row", () => window.__rows("^\\s*cm-|cm-\\d")));
    const chosen = await allNamespaces.evaluate((element) => {
      const time = Math.round(performance.timeOrigin + performance.now());
      element.click();
      return time;
    });
    await frame.press("[data-testid=namespace-select-filter] input", "Escape").catch(() => {});
    await frame.waitForFunction(() => window.__marks["configmaps-first-row"], null, { timeout: 60_000 });
    await frame.evaluate(() =>
      window.__expect("pods-first-row", () => window.__rows("kube-apiserver|coredns|etcd|kindnet|kube-proxy")),
    );
    await electronSidebarItem(frame, "workloads", "pods", "pods-clicked");
    await frame.waitForFunction(() => window.__marks["pods-first-row"], null, { timeout: 60_000 });
    const marks = await frame.evaluate(() => window.__marks);
    const rest = SECONDS * 1000 - (Date.now() - started);
    if (rest > 0) await sleep(rest);
    const cpu = cpuOf(build.child.pid) - cpu0;
    return {
      sidebar: sidebar - clicked,
      configMaps: marks["configmaps-first-row"] - chosen,
      pods: marks["pods-first-row"] - marks["pods-clicked"],
      cpu: +cpu.toFixed(2),
    };
  } finally {
    await build.stop();
  }
}

async function electronWatch() {
  const dir = path.join(workdir, "electron-watch");
  mkdirSync(dir);
  const build = await startElectron(dir);
  try {
    const { frame } = await electronOpen(build);
    await electronSidebarItem(frame, "workloads", "pods", "pods-clicked");
    await frame.click("[data-testid=namespace-select-filter]", { timeout: 30_000 });
    await frame.click('.NamespaceSelectFilterMenu >> text="All Namespaces"', { timeout: 30_000 });
    await frame.press("[data-testid=namespace-select-filter] input", "Escape").catch(() => {});
    await frame.waitForSelector(".TableRow >> text=/kube-apiserver/", { timeout: 60_000 });
    return await watchTimes(async (name, present) => {
      const key = `row-${present ? "in" : "out"}-${name}`;
      await frame.evaluate(
        ([mark, pod, want]) => window.__expect(mark, () => document.body.textContent.includes(pod) === want),
        [key, name, present],
      );
      return frame.evaluate((mark) => window.__marks[mark], key);
    }, true);
  } finally {
    await build.stop();
  }
}

// ---------------------------------------------------------------------------
// The pods of SC-005

/**
 * Creates and deletes a pod five times; `seen(name, present)` gives the wall
 * clock its row appeared or left. With `arm`, `seen` is first called before
 * kubectl runs, to install the page's observer.
 */
async function watchTimes(seen, arm = false) {
  const added = [];
  const removed = [];
  for (let n = 1; n <= runs; n++) {
    const name = `measure-${Date.now() % 100000}`;
    if (arm) await seen(name, true);
    kubectl("run", name, "--image=registry.k8s.io/pause:3.10", "--restart=Never", "-n", "default");
    const created = Date.now();
    added.push((await until(() => seen(name, true), 30_000, `row of ${name}`)) - created);
    if (arm) await seen(name, false);
    kubectl("delete", "pod", name, "-n", "default", "--grace-period=0", "--force", "--wait=false");
    const deleted = Date.now();
    removed.push((await until(() => seen(name, false), 30_000, `row of ${name} gone`)) - deleted);
    await sleep(500);
  }
  return { added, removed };
}

// ---------------------------------------------------------------------------

const results = {};
const bundle = builds.includes("tauri") ? tauriBundle() : undefined;
for (const build of builds) {
  if (mode === "lists") {
    const times = [];
    for (let run = 1; run <= runs; run++) {
      const result = build === "tauri" ? await tauriLists(bundle, run) : await electronLists(run);
      console.log(`${build} run ${run}: ${JSON.stringify(result)}`);
      times.push(result);
    }
    results[build] = Object.fromEntries(
      ["sidebar", "configMaps", "pods", "cpu"].map((key) => [
        key,
        {
          median: median(times.map((time) => time[key]).filter((value) => value !== undefined)),
          runs: times.map((time) => time[key]),
        },
      ]),
    );
  } else {
    const { added, removed } = build === "tauri" ? await tauriWatch(bundle) : await electronWatch();
    results[build] = {
      added: { median: median(added), runs: added },
      removed: { median: median(removed), runs: removed },
    };
    console.log(`${build}: ${JSON.stringify(results[build])}`);
  }
}
writeFileSync(path.join(workdir, `${mode}.json`), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
