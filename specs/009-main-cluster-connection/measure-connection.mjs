/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Measures the cluster connection of both builds with the same steps, on the
// kind cluster of specs/baseline.md (specs/009-main-cluster-connection/research.md, R17).
//
// usage (from the repo root): node specs/009-main-cluster-connection/measure-connection.mjs <mode> <kind kubeconfig> [runs]
//   lists    the scenario of specs/baseline.md, three runs per build: the times
//            to the sidebar (from the click or the end of the shell sync,
//            whichever is later, and from the click alone), to the first
//            Config Map row of All Namespaces and
//            to the first Pod row, and the CPU of the main process over 60 s
//            (SC-002, SC-003, SC-004, SC-006)
//   watch    a pod created and deleted with kubectl, five times per build: the
//            time from kubectl returning to its row appearing and leaving (SC-005)
//   messages the connection updates and states each build sends for the kind
//            context and made-up ones (a refused port, a refused token, a
//            failing plugin, a plugin only on a test shell's PATH), compared,
//            and searched for the credentials (SC-001, SC-009, SC-013)
//   ports    the Tauri build's listening sockets, child processes and the API
//            server's WATCH requests during the scenario and after its
//            disconnect (SC-010, SC-011)
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
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(path.resolve("freelens/package.json"));
const { chromium } = require("playwright");

const [mode, kubeconfig, runsArg] = process.argv.slice(2);
if (!["lists", "watch", "messages", "ports"].includes(mode) || !kubeconfig) {
  console.error("usage: measure-connection.mjs <lists|watch|messages|ports> <kind kubeconfig> [runs]");
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
  execFileSync("kubectl", ["--kubeconfig", kubeconfig, ...args], {
    env: { ...process.env, KUBECONFIG: "" },
    maxBuffer: 64 * 1024 * 1024,
  })
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

/**
 * Starts the Tauri build on the kind kubeconfig, running the scenario itself
 * (the page clicks the kind context); `marks` maps a mark's name to its wall
 * clock.
 */
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
    [`--data-dir=${data}`, `--kubeconfig=${kubeconfig}`, "--scenario=lists"],
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
      // The end of the shell sync, synced or failed, as the wall clock it was read.
      if (line.startsWith("[SHELL-SYNC]: ") && !marks.has("shell-synced")) marks.set("shell-synced", Date.now());
    }
  });
  return { child, marks, stop: async () => (child.kill(), sleep(1500)) };
}

async function tauriLists(bundle, run) {
  const dir = path.join(workdir, `tauri-lists-${run}`);
  mkdirSync(dir);
  const build = startTauri(bundle, dir);
  try {
    // The page clicks the cluster first; the CPU counts from it.
    await until(async () => build.marks.has("cluster-clicked"), 60_000, "cluster-clicked");
    const cpu0 = cpuOf(build.child.pid);
    const started = build.marks.get("cluster-clicked");
    await until(async () => build.marks.has("pods-first-row"), 60_000, "pods-first-row");
    const rest = SECONDS * 1000 - (Date.now() - started);
    if (rest > 0) await sleep(rest);
    const cpu = cpuOf(build.child.pid) - cpu0;
    const m = (name) => build.marks.get(name);
    return {
      // SC-002: from the click or the end of the shell sync, whichever is
      // later, as the Electron build's window opens only after its shell sync.
      sidebar: m("sidebar-shown") - Math.max(m("cluster-clicked"), m("shell-synced") ?? 0),
      sidebarFromClick: m("sidebar-shown") - m("cluster-clicked"),
      // From the choice of All Namespaces, as the Electron run times it.
      configMaps: m("configmaps-first-row") - m("all-namespaces-chosen"),
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
  // The CPU counts from the click, as in the Tauri run.
  const cpu0 = cpuOf(build.child.pid);
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
  return { frame, clicked, sidebar, cpu0 };
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
    const { frame, clicked, sidebar, cpu0 } = await electronOpen(build);
    const started = clicked;
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
      sidebarFromClick: sidebar - clicked,
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
// The messages of SC-001, SC-009 and SC-013

const PLACEHOLDER_TOKEN = "freelens-measure-placeholder-token-5f1c2a";

/**
 * A kubeconfig of the kind cluster with the contexts of research R17, the
 * test shell that puts a plugin on its PATH, and the credentials to look for.
 */
function messagesSetup(dir) {
  const kind = JSON.parse(
    execFileSync(
      "kubectl",
      [
        "--kubeconfig",
        kubeconfig,
        "config",
        "view",
        "--raw",
        "--minify",
        "--flatten",
        "-o",
        "json",
        "--context",
        CONTEXT,
      ],
      { env: { ...process.env, KUBECONFIG: "" } },
    ).toString(),
  );
  const cluster = kind.clusters[0].cluster;
  const user = kind.users[0].user;
  const bin = path.join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  const credential = {
    apiVersion: "client.authentication.k8s.io/v1",
    kind: "ExecCredential",
    status: {
      clientCertificateData: Buffer.from(user["client-certificate-data"], "base64").toString(),
      clientKeyData: Buffer.from(user["client-key-data"], "base64").toString(),
    },
  };
  const plugin = path.join(bin, "freelens-measure-plugin");
  writeFileSync(plugin, `#!/bin/sh\ncat <<'EOF'\n${JSON.stringify(credential)}\nEOF\n`, { mode: 0o755 });
  const shell = path.join(dir, "measure-shell");
  writeFileSync(shell, `#!/bin/sh\nPATH="${bin}:$PATH"\nexport PATH\nexec /bin/zsh "$@"\n`, { mode: 0o755 });
  const exec = (command, args = []) => ({
    exec: { apiVersion: "client.authentication.k8s.io/v1", command, args, interactiveMode: "Never" },
  });
  const contexts = {
    [CONTEXT]: ["kind", "kind-cert"],
    "refused-port": ["refused", "placeholder-token"],
    "refused-token": ["kind", "placeholder-token"],
    "failing-plugin": ["kind", "failing-plugin"],
    "path-plugin": ["kind", "path-plugin"],
  };
  const file = path.join(dir, "messages-kubeconfig.yaml");
  writeFileSync(
    file,
    JSON.stringify({
      apiVersion: "v1",
      kind: "Config",
      clusters: [
        { name: "kind", cluster },
        { name: "refused", cluster: { server: "https://127.0.0.1:1", "insecure-skip-tls-verify": true } },
      ],
      users: [
        { name: "kind-cert", user },
        { name: "placeholder-token", user: { token: PLACEHOLDER_TOKEN } },
        { name: "failing-plugin", user: exec("/bin/sh", ["-c", "echo 'credential plugin exploded' >&2; exit 1"]) },
        { name: "path-plugin", user: exec("freelens-measure-plugin") },
      ],
      contexts: Object.entries(contexts).map(([name, [clusterName, userName]]) => ({
        name,
        context: { cluster: clusterName, user: userName },
      })),
    }),
  );
  const key = user["client-key-data"];
  const pem = Buffer.from(key, "base64").toString().split("\n")[1];
  return { file, shell, contexts: Object.keys(contexts), secrets: [PLACEHOLDER_TOKEN, key.slice(0, 40), pem] };
}

/** The updates and states of a dump's lines, without the cluster ids. */
function messagesOf(lines) {
  const updates = [];
  const states = [];
  for (const { channel, payload } of lines) {
    if (/^cluster:.+:connection-update$/.test(channel)) updates.push(`${payload.level}: ${payload.message}`);
    if (channel === "cluster-state-sync") {
      const { online, ready, disconnected, accessible } = payload.state;
      const last = states.at(-1);
      const state = JSON.stringify({ online, ready, disconnected, accessible });
      if (last !== state) states.push(state);
    }
  }
  return { updates, states };
}

const readJsonLines = (file) =>
  existsSync(file)
    ? readFileSync(file, "utf-8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];

/** The Tauri build, started with `open -n`, connecting `context` by `--open-cluster`. */
async function tauriMessages(bundle, setup, context, dir) {
  const data = path.join(dir, "data");
  mkdirSync(data, { recursive: true });
  writeFileSync(
    path.join(data, "lens-user-store.json"),
    JSON.stringify({ preferences: { syncKubeconfigEntries: [], shell: setup.shell } }),
  );
  const dump = path.join(dir, "messages.jsonl");
  execFileSync("open", [
    "-n",
    "-a",
    bundle,
    "--args",
    `--data-dir=${data}`,
    `--kubeconfig=${setup.file}`,
    `--open-cluster=${context}`,
    `--messages-dump=${dump}`,
  ]);
  await sleep(20_000);
  execSync(`pkill -f -- "--data-dir=${data}" || true`);
  await sleep(1500);
  return readJsonLines(dump).filter((line) => line.view === null || line.view === "main");
}

/** The Electron build, started with `open -n`, its sends hooked in main, the context clicked in the catalog. */
async function electronMessages(setup, context, dir) {
  const data = path.join(dir, "data");
  mkdirSync(path.join(data, "Freelens"), { recursive: true });
  writeFileSync(
    path.join(data, "Freelens/lens-user-store.json"),
    JSON.stringify({ preferences: { syncKubeconfigEntries: [{ filePath: setup.file }], shell: setup.shell } }),
  );
  const out = path.join(dir, "messages.jsonl");
  const inspect = 9300 + Math.floor(Math.random() * 300);
  const debug = inspect + 300;
  execFileSync("open", [
    "-n",
    "--env",
    `FREELENS_INTEGRATION_TESTING_DIR=${data}`,
    "-a",
    path.resolve(electronApp),
    "--args",
    `--user-data-dir=${data}/userdata`,
    `--inspect-brk=${inspect}`,
    `--remote-debugging-port=${debug}`,
  ]);
  const targets = await until(
    () => fetch(`http://127.0.0.1:${inspect}/json/list`).then((response) => response.json()),
    30_000,
    "electron inspector",
  );
  const socket = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    pending.get(message.id)?.(message);
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      pending.set(++id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });
  // Each message main sends once, to the main window: the first web contents
  // to get a payload; the frames get the same ones.
  const hook = `(() => {
    const { app, webContents } = require("electron");
    const fs = require("fs");
    if (globalThis.__messagesHook) return true;
    globalThis.__messagesHook = true;
    const patch = (contents) => {
      const send = contents.send.bind(contents);
      contents.send = (channel, ...args) => {
        if (contents.getURL().startsWith("https://renderer.freelens.app")) {
          fs.appendFileSync(${JSON.stringify(out)}, JSON.stringify({ view: "main", channel, payload: args[0] }) + "\\n");
        }
        return send(channel, ...args);
      };
    };
    webContents.getAllWebContents().forEach(patch);
    app.on("web-contents-created", (_, contents) => patch(contents));
    return true;
  })()`;
  await send("Runtime.enable");
  await send("Runtime.runIfWaitingForDebugger");
  await until(
    async () => {
      const answer = await send("Runtime.evaluate", { expression: hook, includeCommandLineAPI: true });
      return !answer.result?.exceptionDetails && answer.result?.result?.value === true;
    },
    10_000,
    "electron hook",
  );
  socket.close();
  const browser = await until(() => chromium.connectOverCDP(`http://127.0.0.1:${debug}`), 30_000, "electron CDP");
  try {
    const page = await until(
      async () =>
        browser
          .contexts()
          .flatMap((browserContext) => browserContext.pages())
          .find((candidate) => candidate.url().startsWith("https://renderer.freelens.app")),
      30_000,
      "electron page",
    );
    await page.waitForSelector("[data-testid=welcome-menu-container] li a", { timeout: 60_000 });
    await page.click("[data-testid=welcome-menu-container] li a");
    await page.click(`div.TableCell >> text='${context}'`, { timeout: 30_000 });
    await sleep(20_000);
  } finally {
    await browser.close().catch(() => {});
    execSync(`pkill -f -- "${data}/" || true`);
    await sleep(3000);
  }
  return readJsonLines(out);
}

async function messages(bundle) {
  const setup = messagesSetup(workdir);
  const result = {};
  for (const context of setup.contexts) {
    const recorded = {};
    for (const build of builds) {
      const dir = path.join(workdir, `messages-${build}-${context}`);
      mkdirSync(dir);
      const lines =
        build === "tauri"
          ? await tauriMessages(bundle, setup, context, dir)
          : await electronMessages(setup, context, dir);
      recorded[build] = messagesOf(lines);
      console.log(`${build} ${context}: ${JSON.stringify(recorded[build])}`);
    }
    result[context] = recorded;
    if (recorded.electron && recorded.tauri) {
      const same = JSON.stringify(recorded.electron) === JSON.stringify(recorded.tauri);
      console.log(`${context}: ${same ? "same" : "DIFFERENT"}`);
    }
  }
  const found = new Set();
  for (const file of readdirSync(workdir, { recursive: true }).filter((name) => String(name).endsWith(".jsonl"))) {
    const text = readFileSync(path.join(workdir, String(file)), "utf-8");
    for (const secret of setup.secrets) {
      if (text.includes(secret) || text.includes(Buffer.from(secret).toString("base64")))
        found.add(secret.slice(0, 12));
    }
  }
  console.log(found.size === 0 ? "credentials: none found" : `credentials: FOUND ${[...found].join(", ")}`);
  return result;
}

// ---------------------------------------------------------------------------
// The ports, processes and watches of SC-010 and SC-011

/** The sum of the API server's `apiserver_longrunning_requests` for WATCH. */
function watchRequests() {
  return kubectl("get", "--raw", "/metrics")
    .split("\n")
    .filter((line) => line.startsWith("apiserver_longrunning_requests{") && line.includes('verb="WATCH"'))
    .reduce((total, line) => total + Number(line.split(" ").at(-1)), 0);
}

function portsOf(pid) {
  const listening = execSync(`lsof -nP -a -p ${pid} -iTCP -sTCP:LISTEN || true`).toString().trim();
  const children = execSync(`pgrep -P ${pid} || true`).toString().trim();
  return { listening: listening ? listening.split("\n").slice(1) : [], children: children ? children.split("\n") : [] };
}

async function ports(bundle) {
  const dir = path.join(workdir, "tauri-ports");
  mkdirSync(dir);
  const before = watchRequests();
  const build = startTauri(bundle, dir);
  try {
    await until(async () => build.marks.has("pods-first-row"), 60_000, "pods-first-row");
    await sleep(2000);
    const during = { watches: watchRequests() - before, ...portsOf(build.child.pid) };
    await until(async () => build.marks.has("disconnected"), 90_000, "disconnected");
    await sleep(3000);
    const after = { watches: watchRequests() - before, ...portsOf(build.child.pid) };
    return { during, after };
  } finally {
    await build.stop();
  }
}

// ---------------------------------------------------------------------------

const results = {};
const bundle = builds.includes("tauri") ? tauriBundle() : undefined;
if (mode === "messages") {
  Object.assign(results, await messages(bundle));
} else if (mode === "ports") {
  Object.assign(results, await ports(bundle));
}
for (const build of ["lists", "watch"].includes(mode) ? builds : []) {
  if (mode === "lists") {
    const times = [];
    for (let run = 1; run <= runs; run++) {
      const result = build === "tauri" ? await tauriLists(bundle, run) : await electronLists(run);
      console.log(`${build} run ${run}: ${JSON.stringify(result)}`);
      times.push(result);
    }
    results[build] = Object.fromEntries(
      ["sidebar", "sidebarFromClick", "configMaps", "pods", "cpu"].map((key) => [
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
