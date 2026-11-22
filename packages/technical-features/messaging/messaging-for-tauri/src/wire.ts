/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

/**
 * A value on the wire: `payload` carries it, and its absence means "no value"
 * (`undefined`), so that `null` stays a value (contracts/ipc-routes.md).
 */
export interface Envelope {
  payload?: unknown;
}

const reject = (channelId: string, path: string, what: string): never => {
  throw new TypeError(
    `Cannot send ${what} at ${path} on channel "${channelId}": it would not arrive as the Electron build delivers it`,
  );
};

const describeObject = (value: object): string | undefined => {
  if (value instanceof Date) return "a Date";
  if (value instanceof RegExp) return "a RegExp";
  if (value instanceof Map) return "a Map";
  if (value instanceof Set) return "a Set";
  if (value instanceof Error) return "an Error";
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return "binary data";
  if (typeof (value as { toJSON?: unknown }).toJSON === "function") return "an object with toJSON";

  return undefined;
};

// Throws where JSON and the structured clone of Electron would disagree (research R4).
const check = (channelId: string, value: unknown, path: string, ancestors: Set<object>): void => {
  switch (typeof value) {
    case "string":
    case "boolean":
      return;
    case "number":
      return Number.isFinite(value) ? undefined : reject(channelId, path, "a non-finite number");
    case "bigint":
      return reject(channelId, path, "a bigint");
    case "function":
      return reject(channelId, path, "a function");
    case "symbol":
      return reject(channelId, path, "a symbol");
    case "undefined":
      return reject(channelId, path, "undefined");
  }

  if (value === null) {
    return;
  }

  const object = value as object;

  if (ancestors.has(object)) {
    reject(channelId, path, "a cycle");
  }

  // An array's toJSON, such as a MobX observable array's, gives the same items.
  const what = Array.isArray(object) ? undefined : describeObject(object);

  if (what) {
    reject(channelId, path, what);
  }

  ancestors.add(object);

  if (Array.isArray(object)) {
    object.forEach((item, index) => check(channelId, item, `${path}[${index}]`, ancestors));
  } else {
    for (const [key, item] of Object.entries(object)) {
      // JSON drops the property, and reading it gives undefined in both builds.
      if (item !== undefined) {
        check(channelId, item, `${path}.${key}`, ancestors);
      }
    }
  }

  ancestors.delete(object);
};

export const toEnvelope = (channelId: string, value: unknown): Envelope => {
  if (value === undefined) {
    return {};
  }

  check(channelId, value, "payload", new Set());

  return { payload: value };
};

export const fromEnvelope = (envelope: Envelope): unknown => ("payload" in envelope ? envelope.payload : undefined);
