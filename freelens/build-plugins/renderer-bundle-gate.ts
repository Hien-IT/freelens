/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The walk of the renderer bundle gate (specs/003-renderer-without-node/contracts/bundle-gate.md).
//
// The renderer build records every import of a Node builtin or of `electron`
// with its importer. For each one, the gate walks up the importers until it
// reaches a workspace module, the first module outside `node_modules`: that is
// the file that brings the Node use into the renderer, itself or through a
// package it imports. The renderer runs without Node, so each of them fails
// the build.

import { isAbsolute, relative, sep } from "node:path";

export interface NodeImport {
  /** The builtin or `electron` specifier, as written in the importer. */
  readonly specifier: string;
  /** The module id of the importer. */
  readonly importer: string;
}

export interface ModuleInfoLike {
  readonly importers: readonly string[];
  readonly dynamicImporters: readonly string[];
  readonly isEntry: boolean;
}

export type GetModuleInfo = (id: string) => ModuleInfoLike | null | undefined;

export interface NodeBringer {
  /** The workspace module, relative to the repository root, with `/` separators. */
  readonly module: string;
  /** The builtins and `electron` specifiers it brings in. */
  readonly specifiers: readonly string[];
  /** The specifier whose importer chain is shown. */
  readonly via: string;
  /** One importer chain, from the importer of `via` up to an entry, as repository-relative ids. */
  readonly chain: readonly string[];
}

const stripQuery = (id: string) => id.replace(/[?#].*$/, "");

export const toRepositoryPath = (id: string, root: string) => {
  const file = stripQuery(id);

  return isAbsolute(file) ? relative(root, file).split(sep).join("/") : file;
};

export const isWorkspaceModule = (id: string, root: string) => {
  const file = stripQuery(id);

  return (
    !id.startsWith("\0") &&
    isAbsolute(file) &&
    !file.split(sep).includes("node_modules") &&
    !relative(root, file).startsWith("..")
  );
};

const importersOf = (info: ModuleInfoLike | null | undefined) =>
  info ? [...info.importers, ...info.dynamicImporters] : [];

/** One chain from `id` up to an entry, following the first importer not yet seen. */
const chainToEntry = (id: string, getModuleInfo: GetModuleInfo) => {
  const chain: string[] = [];
  const seen = new Set<string>();
  let current: string | undefined = id;

  while (current && !seen.has(current)) {
    seen.add(current);
    chain.push(current);

    const info = getModuleInfo(current);

    if (!info || info.isEntry) {
      break;
    }

    current = importersOf(info).find((importer) => !seen.has(importer));
  }

  return chain;
};

/**
 * The workspace modules that bring a Node builtin or `electron` into the
 * renderer graph, each with one chain for the error message.
 */
export function findNodeBringers(
  imports: readonly NodeImport[],
  getModuleInfo: GetModuleInfo,
  root: string,
): NodeBringer[] {
  const bringers = new Map<string, { specifiers: Set<string>; via: string; chain: string[] }>();

  for (const { specifier, importer } of imports) {
    // Breadth first through node_modules, stopping at each workspace module.
    const parentOf = new Map<string, string | undefined>([[importer, undefined]]);
    const queue = [importer];
    let found = false;

    while (queue.length > 0) {
      const id = queue.shift() as string;

      if (isWorkspaceModule(id, root)) {
        // From the importer of the specifier up to this module, then on up to an entry.
        const pathUp: string[] = [];

        for (let step: string | undefined = id; step !== undefined; step = parentOf.get(step)) {
          pathUp.unshift(step);
        }

        const module = toRepositoryPath(id, root);
        const entry = bringers.get(module) ?? {
          specifiers: new Set<string>(),
          via: specifier,
          chain: [...pathUp, ...chainToEntry(id, getModuleInfo).slice(1)].map((step) => toRepositoryPath(step, root)),
        };

        entry.specifiers.add(specifier);
        bringers.set(module, entry);
        found = true;
        continue;
      }

      for (const next of importersOf(getModuleInfo(id))) {
        if (!parentOf.has(next)) {
          parentOf.set(next, id);
          queue.push(next);
        }
      }
    }

    // No workspace module above it, which the graph should not allow: the
    // importer itself answers for it, so that the import is not lost.
    if (!found) {
      const module = toRepositoryPath(importer, root);
      const entry = bringers.get(module) ?? {
        specifiers: new Set<string>(),
        via: specifier,
        chain: chainToEntry(importer, getModuleInfo).map((step) => toRepositoryPath(step, root)),
      };

      entry.specifiers.add(specifier);
      bringers.set(module, entry);
    }
  }

  return [...bringers.entries()]
    .map(([module, { specifiers, via, chain }]) => ({ module, specifiers: [...specifiers].sort(), via, chain }))
    .sort((left, right) => left.module.localeCompare(right.module));
}

/** The build error, one block per module that brings Node in; empty when there is none. */
export function formatGateResult(bringers: readonly NodeBringer[]): string {
  const lines: string[] = [];

  for (const { module, specifiers, via, chain } of bringers) {
    lines.push(`renderer bundle imports Node: ${specifiers.join(", ")}`);
    lines.push(`  ${via}`);

    for (const step of chain) {
      lines.push(`  <- ${step}${step === module ? "  (brings it in)" : ""}`);
    }
  }

  return lines.join("\n");
}
