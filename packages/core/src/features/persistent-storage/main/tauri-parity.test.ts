/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { testUtils } from "@freelensapp/messaging";
import Conf from "conf";
import { afterEach, describe, expect, it } from "vitest";
import directoryForUserDataInjectable from "../../../common/app-paths/directory-for-user-data/directory-for-user-data.injectable";
import readFileBufferSyncInjectable from "../../../common/fs/main/read-file-buffer-sync.injectable";
import writeBufferSyncInjectable from "../../../common/fs/main/write-buffer-sync.injectable";
import getConfigurationFileModelInjectable from "../../../common/get-configuration-file-model/get-configuration-file-model.injectable";
import kubeDirectoryPathInjectable from "../../../common/os/kube-directory-path.injectable";
import currentTimezoneInjectable from "../../../common/vars/current-timezone.injectable";
import isDevelopmentInjectable from "../../../common/vars/is-development.injectable";
import { getDiForUnitTesting } from "../../../main/getDiForUnitTesting";
import clustersPersistentStorageInjectable from "../../cluster/storage/common/storage.injectable";
import favoritesPersistentStorageInjectable from "../../favorites/common/storage.injectable";
import hotbarsPersistentStorageInjectable from "../../hotbar/storage/common/storage.injectable";
import { defaultEditorConfig, defaultTerminalConfig } from "../../user-preferences/common/preferences-helpers";
import userPreferencesPersistentStorageInjectable from "../../user-preferences/common/storage.injectable";
import weblinksPersistentStorageInjectable from "../../weblinks/common/storage.injectable";
import persistentStorageRegistryInjectable from "../common/registry.injectable";

/**
 * The fixtures the cargo tests of the Tauri build assert too
 * (`specs/007-main-foundation/contracts/store-format.md`, "Fixtures"): this
 * test shows that they are the Electron build's behaviour. Run with
 * `UPDATE_TAURI_PARITY=1` to write `expected/` from this build's own code.
 */
// `import.meta.url` is not a file URL under jsdom; Vitest provides `__dirname`.
const fixtures = path.resolve(__dirname, "../../../../../../freelens-tauri/src-tauri/tests/fixtures/data-dir");
const update = process.env.UPDATE_TAURI_PARITY === "1";
const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g;
const configNames = [
  "lens-user-store",
  "lens-cluster-store",
  "freelens-favorites-store",
  "lens-hotbar-store",
  "lens-weblink-store",
];

// The descriptors deep-merge into these shared defaults, changing them, so
// each case starts from the defaults the module was loaded with.
const pristine = structuredClone({ defaultEditorConfig, defaultTerminalConfig });
const restoreDefaults = () => {
  for (const [target, source] of [
    [defaultEditorConfig, pristine.defaultEditorConfig],
    [defaultTerminalConfig, pristine.defaultTerminalConfig],
  ] as const) {
    for (const key of Object.keys(target)) {
      delete (target as Record<string, unknown>)[key];
    }
    Object.assign(target, structuredClone(source));
  }
};

/** What the stub of the message listeners is handed. */
interface Listener {
  channel: { id: string };
  handler: (model: unknown) => void;
}

const withoutRandomIds = (text: string) => text.replace(uuid, "<uuid>");

const cases = existsSync(fixtures)
  ? readdirSync(fixtures).filter((name) => !name.startsWith("core-only-") && !name.startsWith("."))
  : [];

describe("the store fixtures shared with the Tauri build", () => {
  let directory: string | undefined;

  afterEach(() => {
    restoreDefaults();

    if (directory) {
      rmSync(directory, { recursive: true, force: true });
      directory = undefined;
    }
  });

  it("has cases", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  it.each(cases)("%s", (name) => {
    const caseDirectory = path.join(fixtures, name);
    const input = path.join(caseDirectory, "input");
    const expected = path.join(caseDirectory, "expected");
    const dataDirectory = mkdtempSync(path.join(tmpdir(), "tauri-parity-"));

    directory = dataDirectory;

    if (existsSync(input)) {
      cpSync(input, dataDirectory, { recursive: true });
    }

    const listeners = new Map<string, (model: unknown) => void>();
    const di = getDiForUnitTesting();

    di.override(directoryForUserDataInjectable, () => dataDirectory);
    di.override(getConfigurationFileModelInjectable, () => (options) => new Conf(options));
    // The copy of a file that is not valid JSON goes to the disk, as `conf` does.
    di.override(readFileBufferSyncInjectable, () => (file) => readFileSync(file));
    di.override(writeBufferSyncInjectable, () => (file, contents) => writeFileSync(file, contents));
    di.override(isDevelopmentInjectable, () => false);
    di.override(kubeDirectoryPathInjectable, () => "/home/test/.kube");
    di.override(currentTimezoneInjectable, () => "UTC");
    // The stub is declared without the listener its callers pass, so the
    // function that records them is given the stub's own type.
    const enlist = ((listener?: Listener) => {
      if (listener) {
        listeners.set(listener.channel.id, listener.handler);
      }

      return () => {};
    }) as () => () => void;

    di.override(testUtils.enlistMessageChannelListenerStubInjectable, () => enlist);

    for (const storage of [
      userPreferencesPersistentStorageInjectable,
      clustersPersistentStorageInjectable,
      favoritesPersistentStorageInjectable,
      hotbarsPersistentStorageInjectable,
      weblinksPersistentStorageInjectable,
    ]) {
      di.inject(storage).loadAndStartSyncing();
    }

    const registry = di.inject(persistentStorageRegistryInjectable);
    const models = Object.fromEntries(
      [...registry.values()].map(({ configName, toJSON }) => [configName, JSON.parse(JSON.stringify(toJSON()))]),
    );
    const modelsText = withoutRandomIds(`${JSON.stringify(models, null, 2)}\n`);

    const changePath = path.join(caseDirectory, "change.json");
    const changes: Record<string, unknown> = existsSync(changePath)
      ? JSON.parse(readFileSync(changePath, "utf-8"))
      : {};

    for (const [configName, model] of Object.entries(changes)) {
      const listener = listeners.get(`store-sync-main:${path.join(dataDirectory, `${configName}.json`)}`);

      expect(listener, `a listener for ${configName}`).toBeDefined();
      listener?.(model);
    }

    const files = Object.fromEntries(
      configNames.map((configName) => {
        const file = path.join(dataDirectory, `${configName}.json`);

        return [configName, existsSync(file) ? withoutRandomIds(readFileSync(file, "utf-8")) : undefined];
      }),
    );
    // The copies of a file that is not valid JSON, by store; their names carry the time.
    const corrupt = Object.fromEntries(
      readdirSync(dataDirectory)
        .map((file) => /^(.+)\.corrupt-\d+\.json$/.exec(file))
        .filter((match) => match !== null)
        .map((match) => [match[1], readFileSync(path.join(dataDirectory, match[0]), "utf-8")]),
    );
    const expectedCorrupt = path.join(expected, "corrupt");

    if (update) {
      mkdirSync(expected, { recursive: true });
      writeFileSync(path.join(expected, "models.json"), modelsText);

      for (const [configName, text] of Object.entries(files)) {
        if (text !== undefined) {
          writeFileSync(path.join(expected, `${configName}.json`), text);
        }
      }

      for (const [configName, text] of Object.entries(corrupt)) {
        mkdirSync(expectedCorrupt, { recursive: true });
        writeFileSync(path.join(expectedCorrupt, `${configName}.json`), text);
      }

      return;
    }

    expect(modelsText).toBe(readFileSync(path.join(expected, "models.json"), "utf-8"));

    for (const [configName, text] of Object.entries(files)) {
      const expectedFile = path.join(expected, `${configName}.json`);

      expect(text, configName).toBe(existsSync(expectedFile) ? readFileSync(expectedFile, "utf-8") : undefined);
    }

    const expectedCopies = existsSync(expectedCorrupt)
      ? Object.fromEntries(
          readdirSync(expectedCorrupt).map((file) => [
            file.replace(/\.json$/, ""),
            readFileSync(path.join(expectedCorrupt, file), "utf-8"),
          ]),
        )
      : {};

    expect(corrupt).toEqual(expectedCopies);
  });
});
