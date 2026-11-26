/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { testUtils } from "@freelensapp/messaging";
import Conf from "conf";
import { computed, observable, toJS } from "mobx";
import { afterEach, describe, expect, it, vi } from "vitest";
import directoryForUserDataInjectable from "../../common/app-paths/directory-for-user-data/directory-for-user-data.injectable";
import createReadFileStreamInjectable from "../../common/fs/main/create-read-file-stream.injectable";
import ensureDirInjectable from "../../common/fs/main/ensure-dir.injectable";
import readFileBufferSyncInjectable from "../../common/fs/main/read-file-buffer-sync.injectable";
import statInjectable from "../../common/fs/main/stat.injectable";
import writeBufferSyncInjectable from "../../common/fs/main/write-buffer-sync.injectable";
import writeFileInjectable from "../../common/fs/main/write-file.injectable";
import getConfigurationFileModelInjectable from "../../common/get-configuration-file-model/get-configuration-file-model.injectable";
import addKubeconfigTextListenerInjectable from "../../features/add-cluster/main/add-listener.injectable";
import { checkKubeconfigText } from "../../features/add-cluster/main/check";
import getAllClustersInjectable from "../../features/cluster/enumeration/main/get-all-clusters.injectable";
import getClusterInfoByIdInjectable from "../../features/cluster/enumeration/main/get-cluster-by-id.injectable";
import clustersPersistentStorageInjectable from "../../features/cluster/storage/common/storage.injectable";
import discoverKubeconfigSyncKindListenerInjectable from "../../features/kubeconfig-sync-kind/main/request-listener.injectable";
import kubeconfigSyncsInjectable from "../../features/user-preferences/common/kubeconfig-syncs.injectable";
import weblinksPersistentStorageInjectable from "../../features/weblinks/common/storage.injectable";
import weblinkVerificationStartableStoppableInjectable from "../../features/weblinks/main/weblink-verification.injectable";
import weblinkVerificationsInjectable from "../../features/weblinks/main/weblink-verifications.injectable";
import catalogEntityRegistryInjectable from "../catalog/entity-registry.injectable";
import clusterManagerInjectable from "../cluster/manager.injectable";
import clusterVisibilityHandlerInjectable from "../cluster/visibility-handler.injectable";
import { getDiForUnitTesting } from "../getDiForUnitTesting";
import addKubeconfigSyncAsEntitySourceInjectable from "../start-main-application/runnables/kube-config-sync/add-source.injectable";
import diffChangedKubeconfigInjectable from "./kubeconfig-sync/diff-changed-kubeconfig.injectable";
import kubeconfigSyncManagerInjectable from "./kubeconfig-sync/manager.injectable";
import watchKubeconfigFileChangesInjectable, {
  matchIgnoredKubeconfigFileName,
} from "./kubeconfig-sync/watch-file-changes.injectable";
import syncGeneralCatalogEntitiesInjectable from "./sync-general-catalog-entities.injectable";

import type { ObservableMap } from "mobx";

import type { CatalogEntity } from "../../common/catalog";
import type { Cluster } from "../../common/cluster/cluster";
import type { KubeconfigSyncValue } from "../../features/user-preferences/common/preferences-helpers";

// `compute-diff.injectable.ts` writes the home directory of the `file` label
// with `os.homedir()`, which reads the process's environment, not the
// `process.env` of a Vitest worker; each case names its own.
const home = vi.hoisted(() => ({ current: undefined as string | undefined }));

vi.mock("node:os", async (importOriginal) => {
  const os = await importOriginal<typeof import("node:os")>();
  const homedir = () => home.current ?? os.homedir();

  return { ...os, default: { ...os, homedir }, homedir };
});

// `import.meta.url` is not a file URL under jsdom; Vitest provides `__dirname`.
const fixtures = path.resolve(__dirname, "../../../../../freelens-tauri/src-tauri/tests/fixtures/catalog");
const update = process.env.UPDATE_TAURI_PARITY === "1";
const folderLimit = 2 * 1024 * 1024;
const fileLimit = 16 * folderLimit;

interface CaseSync {
  path: string;
  kind: "file" | "folder";
}

interface CaseGenerate {
  path: string;
  from: string;
  size: number;
}

/** The answers of the channels other than `catalog:items`, for one case. */
interface CaseChannels {
  /** Symbolic links to make, by path, each to a target relative to its folder. */
  links?: Record<string, string>;
  /** The paths asked on `discover-kubeconfig-sync-kind`. */
  discover: string[];
  /** The ids asked on `get-cluster-by-id`. */
  byId: string[];
  /** The ids sent on `cluster-visibility`, one after the other. */
  visible: (string | null)[];
}

interface CaseDefinition {
  syncs: CaseSync[];
  generate?: CaseGenerate[];
  channels?: CaseChannels;
}

const cases = existsSync(fixtures)
  ? readdirSync(fixtures).filter((name) => !name.startsWith("core-only-") && !name.startsWith("."))
  : [];

const md5 = (text: string) => createHash("md5").update(text).digest("hex");

// The ids of the inputs name a file relative to the case's root, as
// `<id:work/dev.yaml:context-a>`, because the root is a new directory each run.
const withInputPlaceholders = (text: string, root: string) =>
  text
    .replace(/<id:([^:>]+):([^>]+)>/g, (_, file: string, context: string) => md5(`${root}/${file}:${context}`))
    .replaceAll("<root>", root);

// Every id that is the MD5 of a kubeconfig path and a context is written
// `<id>`, then the root `<root>`, so that the expected files hold no path of
// the machine.
const withOutputPlaceholders = (value: unknown, root: string): unknown => {
  const replaceIds = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      return node.map(replaceIds);
    }

    if (node && typeof node === "object") {
      const record = node as Record<string, unknown>;
      const copy: Record<string, unknown> = {};

      for (const [key, inner] of Object.entries(record)) {
        copy[key] = replaceIds(inner);
      }

      const metadata = record.metadata as Record<string, unknown> | undefined;
      const spec = record.spec as Record<string, unknown> | undefined;

      if (record.kind === "KubernetesCluster" && metadata && spec) {
        if (metadata.uid === md5(`${spec.kubeconfigPath}:${spec.kubeconfigContext}`)) {
          (copy.metadata as Record<string, unknown>).uid = "<id>";
        }
      }

      if (typeof record.id === "string" && record.id === md5(`${record.kubeConfigPath}:${record.contextName}`)) {
        copy.id = "<id>";
      }

      return copy;
    }

    return node;
  };

  return JSON.parse(JSON.stringify(replaceIds(value)).replaceAll(root, "<root>"));
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Waits until no read of a file is open and the registry has not changed for
// 300 ms, at most 20 s, so that a case ends the same on a busy machine.
async function settled(items: () => unknown, reading: () => number) {
  let last = JSON.stringify(items());
  let stableSince = Date.now();
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline && (reading() > 0 || Date.now() - stableSince < 300)) {
    await sleep(50);
    const now = JSON.stringify(items());

    if (now !== last) {
      last = now;
      stableSince = Date.now();
    }
  }
}

describe("the catalog fixtures shared with the Tauri build", () => {
  let directory: string | undefined;

  afterEach(() => {
    home.current = undefined;

    if (directory) {
      rmSync(directory, { recursive: true, force: true });
      directory = undefined;
    }
  });

  it("has cases", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases)("%s", async (name) => {
    const caseDirectory = path.join(fixtures, name);
    const definition: CaseDefinition = JSON.parse(readFileSync(path.join(caseDirectory, "case.json"), "utf-8"));
    const expected = path.join(caseDirectory, "expected");
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "tauri-catalog-parity-")));

    directory = root;
    home.current = root;

    copyInto(path.join(caseDirectory, "input"), root);

    for (const [link, target] of Object.entries(definition.channels?.links ?? {})) {
      symlinkSync(target, path.join(root, link));
    }

    for (const generated of definition.generate ?? []) {
      const source = readFileSync(path.join(caseDirectory, generated.from));
      const padding = Buffer.alloc(generated.size - source.length, "\n");
      const target = path.join(root, generated.path);

      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, Buffer.concat([source, padding]));
    }

    const dataDirectory = path.join(root, "data");

    mkdirSync(path.join(dataDirectory, "kubeconfigs"), { recursive: true });

    const di = getDiForUnitTesting();

    di.override(directoryForUserDataInjectable, () => dataDirectory);
    di.override(getConfigurationFileModelInjectable, () => (options) => new Conf(options));
    di.override(readFileBufferSyncInjectable, () => (file) => readFileSync(file));
    di.override(writeBufferSyncInjectable, () => (file, contents) => writeFileSync(file, contents));
    // The channels read and write the case's directory, not the fake file system.
    di.override(statInjectable, () => (file) => stat(file));
    di.override(ensureDirInjectable, () => async (dir, options) => {
      await mkdir(dir, { recursive: true, ...options });
    });
    di.override(writeFileInjectable, () => (file, content, options) => writeFile(file, content, options));
    // The reads of the files, kept, so that the case waits for them to end;
    // `diffChangedKubeconfig` removes every listener of a stream it gives up on,
    // so their state is read rather than listened to.
    const streams: ReturnType<typeof createReadStream>[] = [];

    di.override(createReadFileStreamInjectable, () => (file, options) => {
      const stream = createReadStream(file, options);

      streams.push(stream);

      return stream;
    });
    di.override(testUtils.enlistMessageChannelListenerStubInjectable, () => () => () => {});

    // The syncs of the case, as the setting names them.
    const syncs = observable.map<string, KubeconfigSyncValue>();

    for (const sync of definition.syncs) {
      syncs.set(path.join(root, sync.path), {});
    }

    di.override(kubeconfigSyncsInjectable, () => syncs);

    // The watcher, without chokidar: the files it would report at its first
    // scan, read by the Electron build's own `diffChangedKubeconfig`. Its own
    // rules (ignore names, depth, links, timing) are tested on each side.
    const diffChangedKubeconfig = di.inject(diffChangedKubeconfigInjectable);

    di.override(watchKubeconfigFileChangesInjectable, () => (filePath: string) => {
      const rootSource = observable.map<string, ObservableMap<string, [Cluster, CatalogEntity]>>();
      const isFolder = existsSync(filePath) && statSync(filePath).isDirectory();
      const files = !existsSync(filePath)
        ? []
        : isFolder
          ? readdirSync(filePath)
              .sort()
              .map((entry) => path.join(filePath, entry))
              .filter((file) => existsSync(file) && !statSync(file).isDirectory())
              .filter((file) => !matchIgnoredKubeconfigFileName(path.basename(file)))
          : [filePath];

      for (const file of files) {
        const source = observable.map<string, [Cluster, CatalogEntity]>();

        rootSource.set(file, source);
        diffChangedKubeconfig({
          filePath: file,
          source,
          stats: statSync(file),
          maxAllowedFileReadSize: isFolder ? folderLimit : fileLimit,
        });
      }

      return [
        computed(() => [...rootSource.values()].flatMap((source) => [...source.values()].map(([, entity]) => entity))),
        () => {},
      ];
    });

    di.inject(clustersPersistentStorageInjectable).loadAndStartSyncing();
    di.inject(weblinksPersistentStorageInjectable).loadAndStartSyncing();

    const registry = di.inject(catalogEntityRegistryInjectable);

    // What `setup-syncing-of-weblinks.injectable.ts` does, which the unit
    // tests' container replaces with nothing.
    di.inject(weblinkVerificationStartableStoppableInjectable).start();

    const verifications = di.inject(weblinkVerificationsInjectable);

    registry.addComputedSource(
      "weblinks",
      computed(() => [...verifications.values()].map(([weblink]) => weblink)),
    );
    di.inject(syncGeneralCatalogEntitiesInjectable)();
    di.inject(clusterManagerInjectable).init();
    await di.inject(addKubeconfigSyncAsEntitySourceInjectable).run();
    di.inject(kubeconfigSyncManagerInjectable).startSync();

    await settled(
      () => toJS(registry.items),
      () => streams.filter((stream) => !stream.closed && !stream.destroyed).length,
    );

    const entities = withOutputPlaceholders(JSON.parse(JSON.stringify(toJS(registry.items))), root);
    const clusterStorePath = path.join(dataDirectory, "lens-cluster-store.json");
    // The entries are added in the order the reads of the files end, which
    // changes from run to run; they are compared, and written, sorted.
    const clusterStore = sortedEntries(
      withOutputPlaceholders(
        existsSync(clusterStorePath) ? (JSON.parse(readFileSync(clusterStorePath, "utf-8")).clusters ?? []) : [],
        root,
      ) as unknown[],
    );
    const textsDirectory = path.join(caseDirectory, "texts");
    const parses = Object.fromEntries(
      (existsSync(textsDirectory) ? readdirSync(textsDirectory) : []).map((text) => [
        text,
        checkKubeconfigText(readFileSync(path.join(textsDirectory, text), "utf-8")),
      ]),
    );

    const outputs: Record<string, unknown> = {
      "entities.json": entities,
      "lens-cluster-store.json": clusterStore,
      ...Object.fromEntries(Object.entries(parses).map(([text, answer]) => [`parse/${text}.json`, answer])),
    };

    if (definition.channels) {
      const channels = definition.channels;
      const id = (value: string) => withInputPlaceholders(value, root);
      const getById = di.inject(getClusterInfoByIdInjectable);
      const discover = di.inject(discoverKubeconfigSyncKindListenerInjectable).handler;
      const add = di.inject(addKubeconfigTextListenerInjectable).handler;
      const visibility = di.inject(clusterVisibilityHandlerInjectable).handler;
      const active = [];

      for (const visible of channels.visible) {
        visibility(visible === null ? null : id(visible));
        active.push(
          registry.items
            .filter((entity) => entity.kind === "KubernetesCluster" && entity.status.active)
            .map((entity) => entity.getName()),
        );
      }

      const kinds: Record<string, unknown> = {};

      for (const file of channels.discover) {
        kinds[file] = await discover(path.join(root, file));
      }

      Object.assign(
        outputs,
        withOutputPlaceholders(
          {
            "channels/get-all-clusters.json": di.inject(getAllClustersInjectable)(),
            // An unknown id is answered with no value, written `null`.
            "channels/get-cluster-by-id.json": channels.byId.map((value) => getById(id(value)) ?? null),
            "channels/discover-kubeconfig-sync-kind.json": kinds,
            "channels/active.json": active,
          },
          root,
        ),
      );

      for (const text of Object.keys(parses)) {
        outputs[`channels/add-kubeconfig-text/${text}.json`] = await add(
          readFileSync(path.join(textsDirectory, text), "utf-8"),
        );
      }
    }

    if (update) {
      for (const [file, value] of Object.entries(outputs)) {
        const target = path.join(expected, file);

        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
      }

      return;
    }

    for (const [file, value] of Object.entries(outputs)) {
      const wanted = JSON.parse(readFileSync(path.join(expected, file), "utf-8"));

      expect(value, file).toEqual(file === "lens-cluster-store.json" ? sortedEntries(wanted) : wanted);
    }
  });
});

function sortedEntries(entries: unknown[]): unknown[] {
  return [...entries].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function copyInto(from: string, to: string) {
  if (!existsSync(from)) {
    return;
  }

  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);

    if (entry.isDirectory()) {
      mkdirSync(target, { recursive: true });
      copyInto(source, target);
    } else {
      const text = readFileSync(source);
      const isStore = entry.name.endsWith(".json") && path.basename(from) === "data";

      writeFileSync(target, isStore ? withInputPlaceholders(text.toString("utf-8"), to.replace(/\/data$/, "")) : text);
    }
  }
}
