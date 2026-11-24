/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Conf from "conf";
import { afterEach, describe, expect, it } from "vitest";
import { ConfCompatible } from "./conf-compatible";

import type { Options } from "conf";

type Scenario = {
  options: Partial<Options<Record<string, unknown>>>;
  file?: string;
  /** What is done with the store once it is loaded, as an extension would. */
  use?: (store: { set(key: string, value: unknown): void; delete(key: string): void }) => void;
};

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

/** What conf itself makes of the scenario: the store, the file it leaves, or the error. */
const throughConf = ({ options, file, use }: Scenario) => {
  const cwd = mkdtempSync(join(tmpdir(), "conf-compatible-"));
  const path = join(cwd, "some-store.json");

  directories.push(cwd);

  if (file !== undefined) {
    writeFileSync(path, file);
  }

  try {
    const conf = new Conf({ ...options, cwd, configName: "some-store" });

    use?.(conf as never);

    return { store: { ...conf.store }, file: existsSync(path) ? readFileSync(path, "utf8") : undefined };
  } catch (error) {
    return { error: (error as Error).message.replace(path, "<path>") };
  }
};

const throughClass = ({ options, file: initial, use }: Scenario) => {
  let file = initial;

  try {
    const conf = new ConfCompatible(
      { ...options, cwd: "/some-cwd", configName: "some-store" },
      { path: "/some-cwd/some-store.json", contents: initial, write: (contents) => (file = contents) },
    );

    use?.(conf);

    return { store: { ...conf.store }, file };
  } catch (error) {
    return { error: (error as Error).message.replace("/some-cwd/some-store.json", "<path>") };
  }
};

const scenarios: Record<string, Scenario> = {
  "a new store with defaults": {
    options: { defaults: { some: "value", nested: { count: 1 } } },
  },
  "a stored file with defaults it lacks": {
    options: { defaults: { some: "value", other: 2 } },
    file: JSON.stringify({ some: "stored" }),
  },
  "a stored file with everything": {
    options: { defaults: { some: "value" } },
    file: JSON.stringify({ some: "stored", extra: [1, 2] }),
  },
  "a schema default": {
    options: { schema: { level: { type: "string", default: "info" } } },
  },
  "a schema failure": {
    options: { schema: { count: { type: "number" } } },
    file: JSON.stringify({ count: "not a number" }),
  },
  "a schema failure, cleared": {
    options: { schema: { count: { type: "number", default: 0 } }, clearInvalidConfig: true },
    file: JSON.stringify({ count: "not a number" }),
  },
  "a file that is not JSON": {
    options: { defaults: { some: "value" } },
    file: "{ not json",
  },
  "a file that is not JSON, cleared": {
    options: { defaults: { some: "value" }, clearInvalidConfig: true },
    file: "{ not json",
  },
  "a new store with migrations": {
    options: { projectVersion: "2.0.0", migrations: { "1.0.0": (store) => store.set("ran", "1.0.0") } },
  },
  "migrations across versions": {
    options: {
      projectVersion: "2.1.0",
      migrations: {
        "1.0.0": (store) => store.set("first", true),
        "1.5.0": (store) => store.set("count", 1),
        "2.0.0": (store) => store.set("count", (store.get("count") as number) + 1),
        "3.0.0": (store) => store.set("future", true),
      },
    },
    file: JSON.stringify({ __internal__: { migrations: { version: "1.2.0" } }, kept: "yes" }),
  },
  "migrations by a range": {
    options: {
      projectVersion: "2.3.0",
      migrations: { ">=2.0.0 <3.0.0": (store) => store.set("ranged", true) },
    },
    file: JSON.stringify({ __internal__: { migrations: { version: "1.0.0" } } }),
  },
  "dot notation in migrations and writes": {
    options: {
      projectVersion: "1.1.0",
      migrations: { "1.1.0": (store) => store.set("deep.nested.key", "value") },
    },
    file: JSON.stringify({ __internal__: { migrations: { version: "1.0.0" } }, deep: { kept: 1 } }),
    use: (store) => {
      store.set("deep.other", 2);
      store.delete("deep.kept");
    },
  },
  "dot notation turned off": {
    options: { accessPropertiesByDotNotation: false, defaults: { "a.b": 1 } },
    use: (store) => store.set("c.d", 2),
  },
  "custom serialization": {
    options: {
      defaults: { some: "value" },
      serialize: (value) => `custom:${JSON.stringify(value)}`,
      deserialize: (text) => JSON.parse(text.slice("custom:".length)),
    },
    file: `custom:${JSON.stringify({ other: 1 })}`,
  },
};

describe("ConfCompatible, compared with conf", () => {
  it.each(Object.entries(scenarios))("does as conf does with %s", (_name, scenario) => {
    expect(throughClass(scenario)).toEqual(throughConf(scenario));
  });
});
