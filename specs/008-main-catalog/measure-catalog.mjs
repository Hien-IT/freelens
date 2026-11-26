/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */
// Measures the catalog of both builds with the same steps, on a temporary
// directory and temporary kubeconfig files with made-up servers and
// placeholder credentials (specs/008-main-catalog/research.md, R12).
//
// usage (from the repo root): node specs/008-main-catalog/measure-catalog.mjs <mode> [seed dir]
//   dump        the catalog each build sends for the same files, and for the
//               empty setting (SC-001)
//   changes     a change of a synced file to the catalog, five times each (SC-002, SC-003)
//   weblinks    the phases of a served link and of a closed port
//   large-seed  writes the seed of measure.sh for SC-006 into <seed dir>
//   large       a view's catalog:init to the whole large catalog, three times each (SC-007)
// env: ELECTRON_APP (default freelens/dist/mac-arm64/Freelens.app),
//      TAURI_APP (default the dmg of freelens-tauri/src-tauri/target/release/bundle/dmg)
//
// The Electron build is started with --inspect-brk, and a hook installed
// before its main code runs appends each catalog:items payload it sends to a
// file, with the time. The Tauri build is started with --catalog-dump, which
// appends each catalog it sends, and its page posts the mark catalog-<n>
// when it receives one, timed here as its standard output arrives, as is the
// core's log line of each send. A page WebKit stops while its window is not in
// front marks late, so the Tauri build is also timed at the core's send, the
// point the Electron build is timed at (research R12).
// Each mode searches what the builds sent for the placeholder credentials.

import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

const [mode, seedArgument] = process.argv.slice(2);
const repo = process.cwd();
const electronApp = process.env.ELECTRON_APP ?? path.join(repo, "freelens/dist/mac-arm64/Freelens.app");
const tauriSource =
  process.env.TAURI_APP ??
  path.join(repo, "freelens-tauri/src-tauri/target/release/bundle/dmg/Freelens Spike_0.1.0_aarch64.dmg");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

// Credentials and servers of the generated files, which no message may carry (SC-008).
const SECRETS = [];

function kubeconfig(contexts, tag) {
  const token = `placeholder-token-${tag}`;
  const server = `https://cluster-${tag}.example.invalid:6443`;
  // Placeholder certificates and keys, searched for both as written and decoded.
  const [authority, certificate, key] = ["authority", "client-certificate", "client-key"].map(
    (kind) => `placeholder-${kind}-${tag}`,
  );
  const data = (text) => Buffer.from(text).toString("base64");
  SECRETS.push(token, server, authority, certificate, key, data(authority), data(certificate), data(key));
  const lines = [
    "apiVersion: v1",
    "kind: Config",
    "clusters:",
    `- name: cluster-${tag}`,
    "  cluster:",
    `    server: ${server}`,
    `    certificate-authority-data: ${data(authority)}`,
    "users:",
    `- name: user-${tag}`,
    "  user:",
    `    token: ${token}`,
    `    client-certificate-data: ${data(certificate)}`,
    `    client-key-data: ${data(key)}`,
    "contexts:",
  ];
  for (const context of contexts) {
    lines.push(`- name: ${context}`, "  context:", `    cluster: cluster-${tag}`, `    user: user-${tag}`);
  }
  return `${lines.join("\n")}\n`;
}

const md5 = (text) => createHash("md5").update(text).digest("hex");

function workdir() {
  const dir = mkdtempSync(path.join(tmpdir(), "freelens-catalog-measure."));
  console.log(`workdir=${dir}`);
  return dir;
}

function userStore(syncs) {
  return JSON.stringify({ preferences: { syncKubeconfigEntries: syncs.map((filePath) => ({ filePath })) } });
}

function weblinkStore(links) {
  return JSON.stringify({ weblinks: links });
}

/** A copy of the Tauri app, from its dmg or its bundle. */
function tauriBundle(dir) {
  if (tauriSource.endsWith(".dmg")) {
    const mount = path.join(dir, "mnt");
    mkdirSync(mount);
    execFileSync("hdiutil", ["attach", "-nobrowse", "-readonly", "-mountpoint", mount, tauriSource]);
    const app = readdirSync(mount).find((name) => name.endsWith(".app"));
    const bundle = path.join(dir, app);
    execFileSync("ditto", [path.join(mount, app), bundle]);
    execFileSync("hdiutil", ["detach", mount]);
    return bundle;
  }
  return tauriSource;
}

/**
 * A running build: `catalogs()` gives `{ time, entities }` of each catalog
 * received, in order; `inits()` the times of the views' `catalog:init`;
 * `sends()` gives `{ time, count }` of each catalog main sent to every view.
 */
class Build {
  constructor(name, child, readCatalogs, readInits, readSent, readSends) {
    this.name = name;
    this.child = child;
    this.readCatalogs = readCatalogs;
    this.readInits = readInits;
    this.readSent = readSent;
    this.readSends = readSends;
    this.started = Date.now();
  }

  sends() {
    return this.readSends
      ? this.readSends()
      : this.catalogs().map((catalog) => ({ time: catalog.time, count: catalog.entities.length }));
  }

  /** Waits until main sends a catalog of `count` entities after `after`; its time, or undefined. */
  async waitForSend(count, after, timeout = 30_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const found = this.sends().find((send) => send.time >= after && send.count === count);
      if (found) {
        return found.time;
      }
      await sleep(10);
    }
    return undefined;
  }

  /** The entities of each catalog sent, in order. */
  sent() {
    return this.readSent ? this.readSent() : this.catalogs().map((catalog) => catalog.entities);
  }

  inits() {
    return this.readInits();
  }

  catalogs() {
    return this.readCatalogs();
  }

  /** Waits until a catalog after `after` satisfies `test`; its time, or undefined. */
  async waitFor(test, after = 0, timeout = 30_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const found = this.catalogs().find((catalog) => catalog.time >= after && test(catalog.entities));
      if (found) {
        return found.time;
      }
      await sleep(10);
    }
    return undefined;
  }

  /** Waits until no catalog was received for `ms`, and gives the last one sent. */
  async quiet(ms = 2000, timeout = 60_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const all = this.catalogs();
      const last = all.at(-1);
      if (last && Date.now() - last.time >= ms) {
        return this.sent().at(-1) ?? last.entities;
      }
      await sleep(100);
    }
    throw new Error(`${this.name}: the catalog was never quiet`);
  }

  async stop() {
    this.child.kill();
    await sleep(1500);
  }
}

function readLines(file, parse) {
  if (!existsSync(file)) {
    return [];
  }
  return readFileSync(file, "utf-8").split("\n").filter(Boolean).map(parse);
}

/** The Electron build, with FREELENS_INTEGRATION_TESTING_DIR at `dir`; its stores go in `dir/Freelens`. */
async function startElectron(dir) {
  const out = path.join(dir, "electron-catalogs.jsonl");
  const inits = path.join(dir, "electron-inits.log");
  const port = 9300 + Math.floor(Math.random() * 500);
  const child = spawn(
    path.join(electronApp, "Contents/MacOS/Freelens"),
    [`--user-data-dir=${dir}/userdata`, `--inspect-brk=${port}`],
    {
      env: { ...process.env, FREELENS_INTEGRATION_TESTING_DIR: dir },
      stdio: ["ignore", "ignore", "ignore"],
    },
  );
  let targets;
  for (let tries = 0; tries < 100 && !targets; tries++) {
    targets = await fetch(`http://127.0.0.1:${port}/json/list`)
      .then((response) => response.json())
      .catch(() => undefined);
    await sleep(100);
  }
  if (!targets) {
    throw new Error("electron: no inspector");
  }
  const socket = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let id = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      pending.set(++id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });
  // Each send of catalog:items, once per web contents; the first of a payload
  // is the time it left main. The hook goes in as soon as `require` works
  // after the pause of --inspect-brk, before the first window exists, and also
  // covers any web contents made before it.
  const hook = `(() => {
    const { app, ipcMain, webContents } = require("electron");
    const fs = require("fs");
    if (globalThis.__catalogHook) return true;
    globalThis.__catalogHook = true;
    ipcMain.on("catalog:init", () => fs.appendFileSync(${JSON.stringify(inits)}, Date.now() + "\\n"));
    const patch = (contents) => {
      const send = contents.send.bind(contents);
      contents.send = (channel, ...args) => {
        if (channel === "catalog:items") {
          fs.appendFileSync(${JSON.stringify(out)}, JSON.stringify({ time: Date.now(), entities: args[0] }) + "\\n");
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
  let installed = false;
  for (let tries = 0; tries < 500 && !installed; tries++) {
    const answer = await send("Runtime.evaluate", { expression: hook, includeCommandLineAPI: true });
    installed = !answer.result?.exceptionDetails && answer.result?.result?.value === true;
    if (!installed) {
      await sleep(10);
    }
  }
  if (!installed) {
    throw new Error("electron: the hook could not be installed");
  }
  socket.close();
  // Several web contents get each payload; the first of each is kept.
  const readInits = () => readLines(inits, Number);
  return new Build(
    "electron",
    child,
    () => {
      const seen = [];
      for (const catalog of readLines(out, JSON.parse)) {
        const last = seen.at(-1);
        if (
          !last ||
          JSON.stringify(last.entities) !== JSON.stringify(catalog.entities) ||
          catalog.time - last.time > 50
        ) {
          seen.push(catalog);
        }
      }
      return seen;
    },
    readInits,
  );
}

/** The Tauri build on the data directory `data`. */
function startTauri(bundle, dir, data, launch = []) {
  const dump = path.join(dir, "tauri-catalogs.jsonl");
  const marks = [];
  const inits = [];
  const sends = [];
  const child = spawn(
    path.join(bundle, "Contents/MacOS/freelens-spike"),
    [`--data-dir=${data}`, `--catalog-dump=${dump}`, ...launch],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    const now = Date.now();
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      appendFileSync(path.join(dir, "tauri-stdout.log"), `${now} ${line}\n`);
      const mark = /^Mark "catalog-(\d+)"$/.exec(line);
      if (mark) {
        marks.push({ time: now, count: Number(mark[1]) });
      }
      if (line === 'Mark "catalog-init"') {
        inits.push(now);
      }
      const sent = /^Catalog: sent (\d+) entities$/.exec(line);
      if (sent) {
        sends.push({ time: now, count: Number(sent[1]) });
      }
    }
  });
  // The times are the page's marks, which include the channel; a view that
  // asks with `catalog:init` gets the catalog twice, so a mark is not paired
  // with a line of the dump. What was sent is the dump's lines, in order.
  return new Build(
    "tauri",
    child,
    () => marks.map((mark) => ({ time: mark.time, entities: { length: mark.count } })),
    () => inits,
    () => readLines(dump, JSON.parse),
    () => sends,
  );
}

function credentialsIn(dir) {
  const files = readdirSync(dir, { recursive: true }).filter((file) => String(file).endsWith(".jsonl"));
  const found = new Set();
  for (const file of files) {
    const text = readFileSync(path.join(dir, String(file)), "utf-8");
    for (const secret of SECRETS) {
      if (text.includes(secret)) {
        found.add(secret);
      }
    }
  }
  console.log(found.size === 0 ? "credentials: none found" : `credentials: FOUND ${[...found].join(", ")}`);
}

const clusterNames = (entities) =>
  entities.filter((entity) => entity.kind === "KubernetesCluster").map((entity) => entity.metadata.name);

/** Sorted, so that two builds that list a folder's files in another order compare equal. */
const normalized = (entities) => JSON.stringify([...entities].map((entity) => JSON.stringify(entity)).sort());

/** The files and stores of `dump`, written for one build under `data`. */
function writeDumpCase(root, data, weblinkPort) {
  const work = path.join(root, "work");
  const folder = path.join(work, "folder");
  mkdirSync(path.join(folder, "sub"), { recursive: true });
  writeFileSync(
    path.join(work, "dev.yaml"),
    kubeconfig(["context-a", "context-b"], "dev") +
      "- name: no-cluster\n  context:\n    cluster: nowhere\n    user: user-dev\n",
  );
  writeFileSync(path.join(folder, "a"), kubeconfig(["folder-a"], "a"));
  writeFileSync(path.join(folder, "b.bak"), kubeconfig(["ignored"], "bak"));
  writeFileSync(path.join(folder, "sub", "inner"), kubeconfig(["inner"], "inner"));
  const utf16 = kubeconfig(["utf16"], "utf16").replaceAll("\n", "\r\n");
  writeFileSync(path.join(folder, "utf16"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(utf16, "utf16le")]));
  const big = Buffer.from(kubeconfig(["too-big"], "big"));
  writeFileSync(path.join(folder, "big"), Buffer.concat([big, Buffer.alloc(2 * 1024 * 1024 - big.length, "\n")]));
  writeFileSync(path.join(work, "outside.yaml"), kubeconfig(["linked"], "linked"));
  if (!existsSync(path.join(folder, "link"))) {
    symlinkSync(path.join(work, "outside.yaml"), path.join(folder, "link"));
  }
  // The empty value of each kind of sync (Constitution V).
  writeFileSync(path.join(work, "empty.yaml"), "");
  mkdirSync(path.join(work, "empty-folder"), { recursive: true });
  const devFile = path.join(work, "dev.yaml");
  mkdirSync(data, { recursive: true });
  writeFileSync(
    path.join(data, "lens-user-store.json"),
    userStore([devFile, folder, path.join(work, "empty.yaml"), path.join(work, "empty-folder")]),
  );
  writeFileSync(
    path.join(data, "lens-cluster-store.json"),
    JSON.stringify({
      clusters: [
        {
          id: md5(`${devFile}:context-a`),
          contextName: "context-a",
          kubeConfigPath: devFile,
          preferences: { clusterName: "Renamed A", icon: "#336699", iconShortName: "RA" },
          metadata: { distribution: "kind", version: "v1.34.0" },
          accessibleNamespaces: [],
          labels: { team: "platform" },
        },
      ],
    }),
  );
  writeFileSync(
    path.join(data, "lens-weblink-store.json"),
    weblinkStore([
      { id: "served", name: "Served", url: `http://127.0.0.1:${weblinkPort}/` },
      { id: "closed", name: "Closed", url: "http://127.0.0.1:9/" },
    ]),
  );
}

function serve() {
  const server = createServer((_, response) => response.end("ok"));
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/** The catalog each build sends once quiet, with the files and stores `write` puts under a data directory. */
async function compareCatalogs(dir, bundle, name, write) {
  const run = path.join(dir, name);
  write(path.join(run, "electron", "Freelens"));
  const electron = await startElectron(path.join(run, "electron"));
  // The web links are checked at once; their phases settle well within this.
  await sleep(5000);
  const electronCatalog = await electron.quiet();
  await electron.stop();

  write(path.join(run, "tauri-data"));
  const tauri = startTauri(bundle, run, path.join(run, "tauri-data"));
  await sleep(5000);
  const tauriCatalog = await tauri.quiet();
  await tauri.stop();

  writeFileSync(path.join(run, "electron.json"), `${JSON.stringify(electronCatalog, null, 2)}\n`);
  writeFileSync(path.join(run, "tauri.json"), `${JSON.stringify(tauriCatalog, null, 2)}\n`);
  console.log(`${name}: electron clusters: ${clusterNames(electronCatalog).join(", ")}`);
  console.log(`${name}: tauri clusters: ${clusterNames(tauriCatalog).join(", ")}`);
  console.log(`${name}: ${normalized(electronCatalog) === normalized(tauriCatalog) ? "equal" : "DIFFERENT"}`);
}

async function dump() {
  const dir = workdir();
  const server = await serve();
  const port = server.address().port;
  const root = path.join(dir, "case");
  const bundle = tauriBundle(dir);

  await compareCatalogs(dir, bundle, "files", (data) => writeDumpCase(root, data, port));
  // The empty setting: no sync but the application's directory, which is empty.
  await compareCatalogs(dir, bundle, "empty-setting", (data) => {
    mkdirSync(data, { recursive: true });
    writeFileSync(path.join(data, "lens-user-store.json"), userStore([]));
  });
  server.close();
  credentialsIn(dir);
}

/** The timings of SC-002 and the rewrites of SC-003 for one build. */
async function changesOf(build, root) {
  const dev = path.join(root, "work", "dev.yaml");
  const folder = path.join(root, "work", "folder");
  const base = (await build.quiet()).length;
  const timings = { "add-context": [], "remove-context": [], "add-file": [], "remove-file": [] };
  const sends = { "add-context": [], "remove-context": [], "add-file": [], "remove-file": [] };
  const timed = async (kind, change, count) => {
    const t0 = Date.now();
    change();
    const sent = await build.waitForSend(count, t0);
    const time = await build.waitFor((entities) => entities.length === count, t0);
    sends[kind].push(sent === undefined ? Number.NaN : sent - t0);
    timings[kind].push(time === undefined ? Number.NaN : time - t0);
    await build.quiet(1500);
  };
  for (let trial = 0; trial < 5; trial++) {
    await timed(
      "add-context",
      () => writeFileSync(dev, kubeconfig(["context-a", "context-b", "context-c"], "dev")),
      base + 1,
    );
    await timed("remove-context", () => writeFileSync(dev, kubeconfig(["context-a", "context-b"], "dev")), base);
    const added = path.join(folder, `new-${trial}`);
    await timed("add-file", () => writeFileSync(added, kubeconfig([`new-${trial}`], `new${trial}`)), base + 1);
    await timed("remove-file", () => unlinkSync(added), base);
  }
  // SC-003: rewrites in place, in two halves, and by replacing the file.
  const sentBefore = build.sent().length;
  const text = kubeconfig(["context-a", "context-b"], "dev");
  for (let rewrite = 0; rewrite < 100; rewrite++) {
    const content = `${text}# rewrite ${rewrite}\n`;
    if (rewrite % 2 === 0) {
      writeFileSync(dev, content.slice(0, content.length / 2));
      await sleep(100);
      writeFileSync(dev, content);
    } else {
      const temporary = `${dev}.tmp-${rewrite}`;
      writeFileSync(temporary, content);
      renameSync(temporary, dev);
    }
    await sleep(600);
  }
  await build.quiet(2000);
  const missing = build
    .sent()
    .slice(sentBefore)
    .filter((entities) => {
      const names = clusterNames(entities);
      return !names.includes("context-a") || !names.includes("context-b");
    }).length;
  return { timings, sends, missing };
}

function writeChangesCase(root, data) {
  const work = path.join(root, "work");
  const folder = path.join(work, "folder");
  rmSync(root, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(work, "dev.yaml"), kubeconfig(["context-a", "context-b"], "dev"));
  writeFileSync(path.join(folder, "a"), kubeconfig(["folder-a"], "a"));
  mkdirSync(data, { recursive: true });
  writeFileSync(path.join(data, "lens-user-store.json"), userStore([path.join(work, "dev.yaml"), folder]));
}

async function changes() {
  const dir = workdir();
  const bundle = tauriBundle(dir);
  const root = path.join(dir, "case");
  const results = {};

  writeChangesCase(root, path.join(dir, "electron", "Freelens"));
  const electron = await startElectron(path.join(dir, "electron"));
  results.electron = await changesOf(electron, root);
  await electron.stop();

  writeChangesCase(root, path.join(dir, "tauri-data"));
  const tauri = startTauri(bundle, dir, path.join(dir, "tauri-data"));
  results.tauri = await changesOf(tauri, root);
  await tauri.stop();

  for (const kind of Object.keys(results.electron.timings)) {
    const e = results.electron.timings[kind];
    const t = results.tauri.timings[kind];
    const c = results.tauri.sends[kind];
    console.log(
      `${kind}: electron median ${median(e)} ms (${e.join(" / ")}), tauri median ${median(t)} ms (${t.join(" / ")}), tauri core send median ${median(c)} ms (${c.join(" / ")})`,
    );
  }
  for (const build of ["electron", "tauri"]) {
    console.log(`${build}: catalogs during the rewrites missing a cluster: ${results[build].missing}`);
  }
  credentialsIn(dir);
}

async function weblinks() {
  const dir = workdir();
  const server = await serve();
  const port = server.address().port;
  const bundle = tauriBundle(dir);
  const links = [
    { id: "served", name: "Served", url: `http://127.0.0.1:${port}/` },
    { id: "closed", name: "Closed", url: "http://127.0.0.1:9/" },
  ];
  const phases = (entities) =>
    Object.fromEntries(
      entities
        .filter((entity) => entity.kind === "WebLink")
        .map((entity) => [entity.metadata.uid, entity.status.phase]),
    );

  const electronData = path.join(dir, "electron", "Freelens");
  mkdirSync(electronData, { recursive: true });
  writeFileSync(path.join(electronData, "lens-user-store.json"), userStore([]));
  writeFileSync(path.join(electronData, "lens-weblink-store.json"), weblinkStore(links));
  const electron = await startElectron(path.join(dir, "electron"));
  await sleep(5000);
  const electronPhases = phases(await electron.quiet());
  await electron.stop();

  const tauriData = path.join(dir, "tauri-data");
  mkdirSync(tauriData, { recursive: true });
  writeFileSync(path.join(tauriData, "lens-user-store.json"), userStore([]));
  writeFileSync(path.join(tauriData, "lens-weblink-store.json"), weblinkStore(links));
  const tauri = startTauri(bundle, dir, tauriData);
  await sleep(5000);
  const tauriPhases = phases(await tauri.quiet());
  await tauri.stop();
  server.close();

  console.log(`electron: ${JSON.stringify(electronPhases)}`);
  console.log(`tauri: ${JSON.stringify(tauriPhases)}`);
  console.log(JSON.stringify(electronPhases) === JSON.stringify(tauriPhases) ? "equal" : "DIFFERENT");
  credentialsIn(dir);
}

/** The large catalog of data-model.md: one file of 250 contexts, a folder of 25 files of 10. */
function writeLargeCatalog(kube) {
  mkdirSync(path.join(kube, "folder"), { recursive: true });
  const contexts = (prefix, count) => Array.from({ length: count }, (_, index) => `${prefix}-${index}`);
  writeFileSync(path.join(kube, "large.yaml"), kubeconfig(contexts("large", 250), "large"));
  for (let file = 0; file < 25; file++) {
    writeFileSync(path.join(kube, "folder", `file-${file}`), kubeconfig(contexts(`folder-${file}`, 10), `f${file}`));
  }
  return [path.join(kube, "large.yaml"), path.join(kube, "folder")];
}

function largeSeed() {
  if (!seedArgument) {
    throw new Error("large-seed needs the seed directory");
  }
  rmSync(seedArgument, { recursive: true, force: true });
  mkdirSync(seedArgument, { recursive: true });
  writeLargeCatalog(path.join(seedArgument, "kube"));
  // The five stores: measure.sh copies the seed to <run>/data and replaces
  // __RUN_DIR__ with <run>. The web links name a closed local port, so that the
  // checks reach no other host; the cluster store starts empty, so that the
  // core writes an entry for each of the 500 contexts at startup.
  writeFileSync(
    path.join(seedArgument, "lens-user-store.json"),
    userStore(["__RUN_DIR__/data/kube/large.yaml", "__RUN_DIR__/data/kube/folder"]),
  );
  writeFileSync(path.join(seedArgument, "lens-cluster-store.json"), JSON.stringify({ clusters: [] }));
  writeFileSync(path.join(seedArgument, "lens-hotbar-store.json"), JSON.stringify({}));
  writeFileSync(path.join(seedArgument, "freelens-favorites-store.json"), JSON.stringify({ items: [] }));
  writeFileSync(
    path.join(seedArgument, "lens-weblink-store.json"),
    weblinkStore([{ id: "closed", name: "Closed", url: "http://127.0.0.1:9/" }]),
  );
  console.log(`seed=${seedArgument}`);
}

/** The time from a view's first `catalog:init` to the first catalog of `count` entities after it. */
async function fromInit(build, count) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline && build.inits().length === 0) {
    await sleep(10);
  }
  const init = build.inits()[0];
  if (init === undefined) {
    return Number.NaN;
  }
  const time = await build.waitFor((entities) => entities.length === count, init, 120_000);
  return time === undefined ? Number.NaN : time - init;
}

async function large() {
  const dir = workdir();
  const bundle = tauriBundle(dir);
  const syncs = writeLargeCatalog(path.join(dir, "kube"));
  const full = 4 + 500;
  const times = { electron: [], tauri: [] };
  for (let run = 0; run < 3; run++) {
    const electronDir = path.join(dir, `electron-${run}`);
    mkdirSync(path.join(electronDir, "Freelens"), { recursive: true });
    writeFileSync(path.join(electronDir, "Freelens", "lens-user-store.json"), userStore(syncs));
    const electron = await startElectron(electronDir);
    times.electron.push(await fromInit(electron, full));
    await electron.stop();

    const tauriData = path.join(dir, `tauri-${run}`);
    mkdirSync(tauriData, { recursive: true });
    writeFileSync(path.join(tauriData, "lens-user-store.json"), userStore(syncs));
    rmSync(path.join(dir, "tauri-catalogs.jsonl"), { force: true });
    const tauri = startTauri(bundle, dir, tauriData);
    times.tauri.push(await fromInit(tauri, full));
    await tauri.stop();
  }
  console.log(
    `large catalog from a view's catalog:init: electron median ${median(times.electron)} ms (${times.electron.join(" / ")}), tauri median ${median(times.tauri)} ms (${times.tauri.join(" / ")})`,
  );
  credentialsIn(dir);
}

const modes = { dump, changes, weblinks, "large-seed": largeSeed, large };

if (!modes[mode]) {
  console.error(`unknown mode: ${mode}; one of ${Object.keys(modes).join(", ")}`);
  process.exit(2);
}

await modes[mode]();
process.exit(0);
