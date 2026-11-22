/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// Summarize a V8 .cpuprofile: busy time per phase and the top functions by self and total time.
// usage: node specs/analyze-profile.mjs <main.cpuprofile> <marks.json> [top]
import { readFileSync } from "node:fs";

const [profilePath, marksPath, topArg] = process.argv.slice(2);
const TOP = Number(topArg ?? 15);
const p = JSON.parse(readFileSync(profilePath, "utf8"));
const { marks } = JSON.parse(readFileSync(marksPath, "utf8"));

const byId = new Map(p.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);

const IDLE = new Set(["(idle)", "(program)", "(root)"]);
const pkgOf = (url) => {
  if (!url) return "(native/V8)";
  const m = url.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
  if (m) return m[1];
  if (url.startsWith("node:")) return "node:internal";
  if (url.includes("static/build/main.js")) return "main.js (bundle)";
  return url.split("/").slice(-1)[0];
};
const keyOf = (n) =>
  `${n.callFrame.functionName || "(anonymous)"} ${pkgOf(n.callFrame.url)}:${n.callFrame.lineNumber + 1}`;

// Sample i lasts timeDeltas[i + 1] µs (the gap to the next sample).
const self = new Map();
const total = new Map();
const pkg = new Map();
const phases = Object.entries(marks).sort((a, b) => a[1] - b[1]);
const phaseBusy = new Map(phases.map(([k]) => [k, 0]));
let t = 0;
let busy = 0;
let gc = 0;
const add = (m, k, v) => m.set(k, (m.get(k) ?? 0) + v);

for (let i = 0; i < p.samples.length; i++) {
  t += p.timeDeltas[i];
  const dt = p.timeDeltas[i + 1] ?? 0;
  const node = byId.get(p.samples[i]);
  const name = node.callFrame.functionName;
  if (IDLE.has(name)) continue;
  busy += dt;
  if (name === "(garbage collector)") gc += dt;
  add(self, keyOf(node), dt);
  add(pkg, pkgOf(node.callFrame.url), dt);
  const ms = t / 1000;
  const phase = phases.filter(([, at]) => at <= ms).at(-1)?.[0] ?? phases[0][0];
  add(phaseBusy, phase, dt);
  const seen = new Set();
  for (let id = node.id; id !== undefined; id = parent.get(id)) {
    const k = keyOf(byId.get(id));
    if (!seen.has(k)) seen.add(k), add(total, k, dt);
  }
}

const ms = (us) => (us / 1000).toFixed(1);
const wall = (p.endTime - p.startTime) / 1000;
console.log(
  `wall ${wall.toFixed(0)} ms, busy ${ms(busy)} ms (${((busy / 1000 / wall) * 100).toFixed(1)}%), GC ${ms(gc)} ms, samples ${p.samples.length}`,
);
console.log("\nbusy ms per phase (phase = from this mark to the next):");
for (const [k, at] of phases) console.log(`  ${String(at).padStart(6)} ms  ${ms(phaseBusy.get(k)).padStart(8)}  ${k}`);
const top = (m, label) => {
  console.log(`\n${label}:`);
  for (const [k, v] of [...m].sort((a, b) => b[1] - a[1]).slice(0, TOP)) console.log(`  ${ms(v).padStart(8)}  ${k}`);
};
top(pkg, "self ms by package");
top(self, "self ms by function");
top(total, "total ms by function");
