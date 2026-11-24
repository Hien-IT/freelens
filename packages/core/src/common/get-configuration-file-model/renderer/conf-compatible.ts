/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The loading, migrations and validation below follow conf 16.0.0, under this notice:
//
// MIT License
//
// Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)

import Ajv2020 from "ajv/dist/2020";
import ajvFormats from "ajv-formats";
import { cloneDeep, isEqual } from "es-toolkit";
import { get, has, set, unset } from "es-toolkit/compat";
import * as verkit from "verkit";

import type { Options as ConfOptions } from "conf";

/**
 * The file of a store, as main read it, and the way to write it back. Main
 * reads and writes the file, decrypting and encrypting it when the store has
 * a key, so the store here holds only its text.
 */
export interface ConfCompatibleFile {
  readonly path: string;
  readonly contents: string | undefined;
  write(contents: string): void;
}

const INTERNAL_KEY = "__internal__";
const MIGRATION_KEY = `${INTERNAL_KEY}.migrations.version`;
const COMPLETED_RANGE_MIGRATIONS_KEY = `${INTERNAL_KEY}.migrations.completedRanges`;

export class SchemaViolationError extends Error {}

type Store = Record<string, unknown>;

const createPlainObject = (): Store => Object.create(null);

const asStore = (value: unknown): Store =>
  value === null || typeof value !== "object" || Array.isArray(value) ? createPlainObject() : (value as Store);

const storeFromDeserialized = (deserialized: unknown): Store => {
  const store = Object.assign(createPlainObject(), asStore(deserialized));

  if (typeof store.toJSON === "function") {
    delete store.toJSON;
  }

  return store;
};

const omitUndefined = (object: object) =>
  Object.assign(
    createPlainObject(),
    Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined)),
  );

const keyFromInstancePath = (instancePath: string) =>
  instancePath.slice(1).replaceAll(/~([01])/g, (_match, code) => (code === "0" ? "~" : "/"));

const keyFromError = ({ instancePath, params }: { instancePath: string; params: Record<string, unknown> }) => {
  const { additionalProperty, unevaluatedProperty, propertyName } = params;
  const key = additionalProperty ?? unevaluatedProperty ?? propertyName;
  const level = keyFromInstancePath(instancePath);

  if (key === undefined) {
    return level;
  }

  return level === "" ? `${key}` : `${level}/${key}`;
};

const isVersionInRangeFormat = (version: string) => !verkit.isValid(version);

const rangeBranchFor = (range: string, version: string) => {
  const branches = range.split("||").map((branch) => branch.trim());

  if (branches.length < 2) {
    return range;
  }

  return branches.find((branch) => verkit.satisfies(version, branch)) ?? range;
};

const completedRangeFor = (range: string, version: string) => {
  const branch = rangeBranchFor(range, version);

  return branch === range ? range : JSON.stringify([range, branch]);
};

const movesForward = (version: string, recorded: unknown) =>
  recorded === undefined || isVersionInRangeFormat(`${recorded}`) || verkit.isGreaterThan(version, `${recorded}`);

const versionToCompare = (version: string, versionToMigrate: string) => {
  if (!isVersionInRangeFormat(version)) {
    return version;
  }

  return `${verkit.findMinimumForRange(rangeBranchFor(version, versionToMigrate)) ?? versionToMigrate}`;
};

const shouldPerformMigration = (
  candidateVersion: string,
  previousMigratedVersion: string | undefined,
  versionToMigrate: string,
) => {
  if (isVersionInRangeFormat(candidateVersion)) {
    if (!verkit.satisfies(versionToMigrate, candidateVersion)) {
      return false;
    }

    if (previousMigratedVersion === undefined) {
      return true;
    }

    return (
      verkit.isGreaterThan(versionToMigrate, previousMigratedVersion) &&
      !verkit.satisfies(previousMigratedVersion, candidateVersion)
    );
  }

  if (previousMigratedVersion !== undefined && verkit.isLessThanOrEqual(candidateVersion, previousMigratedVersion)) {
    return false;
  }

  return !verkit.isGreaterThan(candidateVersion, versionToMigrate);
};

type Options<T extends Store> = ConfOptions<T> & {
  configName: string;
  fileExtension: string;
  clearInvalidConfig: boolean;
  accessPropertiesByDotNotation: boolean;
};

/**
 * What `conf` makes of a store's file, for the renderer, which has no file
 * system: the defaults of the `defaults` and `schema` options, validation
 * with the schema, the migrations, dot notation, custom serialization and
 * change events. Main reads the file before and writes what this writes.
 *
 * shortcut: `watch` and `configFileMode` have no effect here, as main does the
 * file system, and keys are read and written with lodash paths rather than
 * dot-prop's escapes; upgrade if an extension needs them in the renderer.
 */
export class ConfCompatible<T extends Store = Store> {
  readonly path: string;
  readonly events = new EventTarget();

  readonly #options: Options<T>;
  readonly #file: ConfCompatibleFile;
  readonly #defaults: [string, unknown][];
  readonly #validator?: ReturnType<Ajv2020["compile"]>;
  #contents: string | undefined;
  #isInMigration = false;
  #isClearing = false;

  readonly #serialize: (value: Store) => string;
  readonly #deserialize: (text: string) => unknown;

  constructor(partialOptions: ConfOptions<T>, file: ConfCompatibleFile) {
    const definedOptions = omitUndefined(partialOptions) as ConfOptions<T>;
    const options = {
      ...definedOptions,
      configName: definedOptions.configName ?? "config",
      fileExtension: definedOptions.fileExtension ?? "json",
      clearInvalidConfig: definedOptions.clearInvalidConfig ?? false,
      accessPropertiesByDotNotation: definedOptions.accessPropertiesByDotNotation ?? true,
    } as Options<T>;

    this.#options = options;
    this.#file = file;
    this.#contents = file.contents;
    this.path = file.path;
    this.#serialize =
      (options.serialize as ((value: Store) => string) | undefined) ??
      ((value) => JSON.stringify(value, undefined, "\t"));
    this.#deserialize =
      (options.deserialize as ((text: string) => unknown) | undefined) ??
      ((text) => {
        try {
          return JSON.parse(text.replace(/^﻿/, ""));
        } catch {
          throw new SyntaxError(`The config file \`${this.path}\` is not valid JSON.`);
        }
      });

    const defaults = Object.entries(omitUndefined(options.defaults ?? {}));

    // a key that names a path is written after a key it is a prefix of
    this.#defaults = options.accessPropertiesByDotNotation
      ? defaults.toSorted(([first], [second]) => first.split(".").length - second.split(".").length)
      : defaults;

    if (options.schema ?? options.ajvOptions ?? options.rootSchema) {
      const ajv = new Ajv2020({ allErrors: true, useDefaults: true, ...omitUndefined(options.ajvOptions ?? {}) });

      ajvFormats.default(ajv);
      this.#validator = ajv.compile({ ...options.rootSchema, type: "object", properties: options.schema });
    }

    this.#initializeStore();
  }

  get store(): T {
    const store = this.#readStore();

    delete store[INTERNAL_KEY];

    return store as T;
  }

  set store(value: T) {
    this.#writeStore(value, false);
  }

  get size() {
    return Object.keys(this.store).length;
  }

  get(key: string, defaultValue?: unknown): unknown {
    const store = this.store;
    const value = this.#options.accessPropertiesByDotNotation ? get(store, key) : store[key];

    return value === undefined ? defaultValue : value;
  }

  set(key: string | Partial<T>, value?: unknown) {
    if (typeof key !== "object" && value === undefined) {
      throw new TypeError("Use `delete()` to clear values");
    }

    const keys = typeof key === "object" ? Object.keys(key) : [key];

    if (keys.some((candidate) => this.#isReservedKey(candidate))) {
      throw new TypeError(
        `Please don't use the ${INTERNAL_KEY} key, as it's used to manage this module internal operations.`,
      );
    }

    const store = this.#readStore();
    const entries = typeof key === "object" ? Object.entries(key) : [[key, value] as const];

    for (const [entryKey, entryValue] of entries) {
      this.#setValue(store, entryKey, cloneDeep(entryValue));
    }

    this.#writeStore(store, true);
  }

  has(key: string) {
    return this.#options.accessPropertiesByDotNotation
      ? has(this.store, key) && get(this.store, key) !== undefined
      : this.store[key] !== undefined;
  }

  delete(key: string) {
    const store = this.#readStore();

    if (this.#options.accessPropertiesByDotNotation) {
      unset(store, key);
    } else {
      delete store[key];
    }

    this.#writeStore(store, true);
  }

  clear() {
    this.store = createPlainObject() as T;
  }

  onDidChange(key: string, callback: (newValue: unknown, oldValue: unknown) => void) {
    return this.#onChange(() => this.get(key), callback);
  }

  onDidAnyChange(callback: (newValue: T, oldValue: T) => void) {
    return this.#onChange(() => this.store, callback as (newValue: unknown, oldValue: unknown) => void);
  }

  #onChange(getter: () => unknown, callback: (newValue: unknown, oldValue: unknown) => void) {
    let current = getter();
    const listener = () => {
      const next = getter();

      if (!isEqual(next, current)) {
        const previous = current;

        current = next;
        callback(next, previous);
      }
    };

    this.events.addEventListener("change", listener);

    return () => this.events.removeEventListener("change", listener);
  }

  #isReservedKey(key: string) {
    return this.#options.accessPropertiesByDotNotation ? key.split(".")[0] === INTERNAL_KEY : key === INTERNAL_KEY;
  }

  #setValue(store: Store, key: string, value: unknown) {
    if (this.#options.accessPropertiesByDotNotation) {
      set(store, key, value);
    } else {
      store[key] = value;
    }
  }

  #fillInDefaults(value: Store): Store {
    const dotNotation = this.#options.accessPropertiesByDotNotation;
    let filled: Store | undefined;

    for (const [key, defaultValue] of this.#defaults) {
      const missing = dotNotation ? get(value, key) === undefined : value[key] === undefined;

      if (!missing) {
        continue;
      }

      filled ??= cloneDeep(value);
      this.#setValue(filled, key, cloneDeep(defaultValue));
    }

    return filled ?? value;
  }

  #validate(store: Store) {
    if (!this.#validator) {
      return;
    }

    const reserved = store[INTERNAL_KEY];

    delete store[INTERNAL_KEY];

    const valid = this.#validator(store);

    if (reserved !== undefined) {
      store[INTERNAL_KEY] = reserved;
    }

    if (valid || !this.#validator.errors) {
      return;
    }

    const messages = this.#validator.errors.map(
      (error) =>
        `\`${keyFromError(error as { instancePath: string; params: Record<string, unknown> })}\` ${error.message ?? ""}`,
    );

    throw new SchemaViolationError(`Config schema violation: ${messages.join("; ")}`);
  }

  #readStore(shouldValidate = true): Store {
    let parsedStore: Store | undefined;

    try {
      if (this.#contents === undefined) {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      }

      const store = storeFromDeserialized(this.#deserialize(this.#contents));

      parsedStore = store;

      if (shouldValidate && !this.#isInMigration) {
        this.#validate(store);
      }

      return store;
    } catch (error) {
      if ((error as { code?: string })?.code === "ENOENT") {
        if (!shouldValidate || this.#isInMigration) {
          return createPlainObject();
        }

        const store = this.#fillInDefaults(createPlainObject());

        this.#validator?.(store);

        return store;
      }

      if (
        this.#options.clearInvalidConfig &&
        !this.#isClearing &&
        (error instanceof SchemaViolationError || (error as Error)?.name === "SyntaxError")
      ) {
        return this.#clearStore(parsedStore);
      }

      throw error;
    }
  }

  #clearStore(parsedStore: Store | undefined): Store {
    const store = this.#fillInDefaults(createPlainObject());

    this.#validate(store);

    if (parsedStore?.[INTERNAL_KEY] !== undefined) {
      store[INTERNAL_KEY] = parsedStore[INTERNAL_KEY];
    }

    this.#isClearing = true;

    try {
      this.#write(store);
      this.events.dispatchEvent(new Event("change"));

      return this.#readStore();
    } finally {
      this.#isClearing = false;
    }
  }

  #writeStore(rawValue: unknown, isFromFile: boolean) {
    let value = asStore(rawValue);

    if (!isFromFile && !this.#isInMigration && value[INTERNAL_KEY] !== undefined) {
      value = { ...value };
      delete value[INTERNAL_KEY];
    }

    if (!isFromFile && value[INTERNAL_KEY] === undefined) {
      try {
        const current =
          this.#contents === undefined ? undefined : storeFromDeserialized(this.#deserialize(this.#contents));

        if (current?.[INTERNAL_KEY] !== undefined) {
          value = { ...value, [INTERNAL_KEY]: current[INTERNAL_KEY] };
        }
      } catch {
        // a file that cannot be read keeps no bookkeeping to carry over
      }
    }

    value = this.#fillInDefaults(value);

    if (!this.#isInMigration && this.#validator) {
      if (!isFromFile) {
        value = cloneDeep(value);
      }

      this.#validate(value);
    }

    this.#write(value);
    this.events.dispatchEvent(new Event("change"));
  }

  #write(value: Store) {
    const serialized = this.#serialize(value);

    if (typeof serialized !== "string") {
      throw new TypeError(`The \`serialize\` option must return a string, got ${typeof serialized}`);
    }

    this.#contents = serialized;
    this.#file.write(serialized);
  }

  #setBookkeeping(key: string, value: unknown, store: Store) {
    set(store, key, value);
    this.#writeStore(store, true);

    return store;
  }

  #initializeStore() {
    const snapshot = this.#contents;

    try {
      this.#runMigrations();

      const fileStore = this.#readStore(false);
      const storeWithDefaults = this.#fillInDefaults(cloneDeep(fileStore));

      try {
        this.#validate(storeWithDefaults);
      } catch (error) {
        if (!this.#options.clearInvalidConfig || !(error instanceof SchemaViolationError)) {
          throw error;
        }

        const clearedStore = this.#fillInDefaults(createPlainObject());

        this.#validate(clearedStore);
        this.store = clearedStore as T;

        return;
      }

      if (!isEqual(fileStore, storeWithDefaults)) {
        this.store = fileStore as T;
      }
    } catch (error) {
      // the file is left as it was, as conf restores it
      if (snapshot !== undefined && this.#contents !== snapshot) {
        this.#contents = snapshot;
        this.#file.write(snapshot);
      }

      throw error;
    }
  }

  #runMigrations() {
    const { migrations, projectVersion, beforeEachMigration } = this.#options;

    if (!migrations) {
      return;
    }

    if (!projectVersion) {
      throw new Error("Please specify the `projectVersion` option.");
    }

    if (!verkit.isValid(projectVersion)) {
      throw new Error(`The \`projectVersion\` option must be a valid semantic version, got \`${projectVersion}\``);
    }

    this.#isInMigration = true;

    try {
      const isNewStore = this.#contents === undefined;
      const fileStore = this.#readStore();
      const storeWithDefaults = this.#fillInDefaults(fileStore);

      if (isNewStore) {
        this.#setBookkeeping(MIGRATION_KEY, projectVersion, storeWithDefaults);

        return;
      }

      if (!isEqual(fileStore, storeWithDefaults)) {
        this.#write(storeWithDefaults);
      }

      this.#migrate(
        migrations as unknown as Record<string, (store: this) => void>,
        projectVersion,
        beforeEachMigration as ((store: this, context: object) => void) | undefined,
        storeWithDefaults,
      );
    } finally {
      this.#isInMigration = false;
    }
  }

  #migrate(
    migrations: Record<string, (store: this) => void>,
    versionToMigrate: string,
    beforeEachMigration: ((store: this, context: object) => void) | undefined,
    storedData: Store,
  ) {
    const storedVersion = get(storedData, MIGRATION_KEY) as string | undefined;
    const storedCompletedRanges = get(storedData, COMPLETED_RANGE_MIGRATIONS_KEY);
    const completedRanges = new Set<string>(
      Array.isArray(storedCompletedRanges) ? storedCompletedRanges.filter((item) => typeof item === "string") : [],
    );
    const previousMigratedVersion =
      storedVersion === undefined || isVersionInRangeFormat(`${storedVersion}`) ? undefined : `${storedVersion}`;
    const steps = Object.keys(migrations)
      .filter(
        (candidateVersion) =>
          shouldPerformMigration(candidateVersion, previousMigratedVersion, versionToMigrate) &&
          !(
            isVersionInRangeFormat(candidateVersion) &&
            completedRanges.has(completedRangeFor(candidateVersion, versionToMigrate))
          ),
      )
      .map((version) => ({ version, toVersion: versionToCompare(version, versionToMigrate) }))
      .sort((first, second) => verkit.compare(first.toVersion, second.toVersion));
    const versionsToRun = steps.map(({ toVersion }) => toVersion);
    let fromVersion = previousMigratedVersion ?? "0.0.0";
    let storeBackup = storedData;

    for (const { version, toVersion } of steps) {
      try {
        beforeEachMigration?.(this, {
          fromVersion,
          toVersion,
          finalVersion: versionToMigrate,
          versions: [...versionsToRun],
        });
        migrations[version]?.(this);
        fromVersion = toVersion;

        if (isVersionInRangeFormat(version)) {
          completedRanges.add(completedRangeFor(version, versionToMigrate));
          storeBackup = this.#setBookkeeping(COMPLETED_RANGE_MIGRATIONS_KEY, [...completedRanges], this.#readStore());
        } else {
          const store = this.#readStore();

          storeBackup = movesForward(version, get(store, MIGRATION_KEY))
            ? this.#setBookkeeping(MIGRATION_KEY, version, store)
            : store;
        }
      } catch (error) {
        this.#writeStore(storeBackup, true);

        const errorMessage = error instanceof Error ? error.message : String(error);

        throw new Error(
          `Something went wrong during the migration! Changes applied to the store until this failed migration will be restored. ${errorMessage}`,
        );
      }
    }

    const store = steps.length > 0 ? this.#readStore() : storedData;

    if (movesForward(versionToMigrate, get(store, MIGRATION_KEY))) {
      this.#setBookkeeping(MIGRATION_KEY, versionToMigrate, store);
    }
  }
}
