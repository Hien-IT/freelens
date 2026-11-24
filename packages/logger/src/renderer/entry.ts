/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

/**
 * The entries of the renderer's logger, built as winston 3 builds them with
 * `format.combine(format.splat(), format.simple(), format.timestamp(…))`, the
 * format of the main process's logger: the transports of both processes, and
 * the log file of each frame, get the same entries. The steps follow winston's
 * `Logger.log` and logform's `splat`, `simple` and `timestamp`.
 */

/** The symbols of `triple-beam`, which winston and its transports share. */
export const LEVEL = Symbol.for("level");
export const MESSAGE = Symbol.for("message");
export const SPLAT = Symbol.for("splat");

/** The npm levels of winston, most severe first. */
export const levels: Readonly<Record<string, number>> = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  verbose: 4,
  debug: 5,
  silly: 6,
};

export interface LogEntry {
  level: string;
  message: string;
  [key: string]: unknown;
  [key: symbol]: unknown;
}

const formatRegExp = /%[scdjifoO%]/g;
const escapedPercent = /%%/g;

/** The entry winston writes for `logger[level](message, ...splat)`. */
const createEntry = (level: string, message: string, splat: unknown[]): LogEntry => {
  if (splat.length === 0) {
    const entry = { message } as LogEntry;

    entry.level = entry[LEVEL] = level;

    return entry;
  }

  const [meta] = splat;

  if (typeof meta === "object" && meta !== null && !message.match(formatRegExp)) {
    const entry: LogEntry = Object.assign({}, meta, { [LEVEL]: level, [SPLAT]: splat, level, message });
    const { message: metaMessage, stack, cause } = meta as Record<string, unknown>;

    if (metaMessage) entry.message = `${entry.message} ${metaMessage}`;
    if (stack) entry.stack = stack;
    if (cause) entry.cause = cause;

    return entry;
  }

  return { [LEVEL]: level, [SPLAT]: splat, level, message };
};

/** logform's `splat`: interpolates the tokens, and merges the rest into the entry. */
const splat = (entry: LogEntry): LogEntry => {
  const message = entry.message;
  const args = (entry[SPLAT] || entry.splat) as unknown[] | undefined;

  if (!args || !args.length) {
    return entry;
  }

  const tokens = message?.match?.(formatRegExp);

  if (!tokens) {
    // Like logform, this moves two or more arguments out of the splat.
    for (const meta of args.length > 1 ? args.splice(0) : args) {
      Object.assign(entry, meta);
    }

    return entry;
  }

  const escapes = message.match(escapedPercent)?.length ?? 0;
  const extraSplat = tokens.length - escapes - args.length;
  const metas = extraSplat < 0 ? args.splice(extraSplat, -extraSplat) : [];

  for (const meta of metas) {
    Object.assign(entry, meta);
  }

  entry.message = format(message, args);

  return entry;
};

/** logform's `simple`: `level: message {rest as JSON}`. */
const simple = (entry: LogEntry): LogEntry => {
  const rest = stableStringify(Object.assign({}, entry, { level: undefined, message: undefined, splat: undefined }));
  const padding = (entry.padding && (entry.padding as Record<string, unknown>)[entry.level]) || "";

  entry[MESSAGE] =
    rest !== "{}" ? `${entry.level}:${padding} ${entry.message} ${rest}` : `${entry.level}:${padding} ${entry.message}`;

  return entry;
};

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

/** logform's `timestamp` with the format `DD/MM/YYYY HH:mm:ss`, in local time as fecha writes it. */
const timestamp = (entry: LogEntry): LogEntry => {
  const now = new Date();

  entry.timestamp = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${pad(now.getFullYear(), 4)} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  return entry;
};

export const buildEntry = (level: string, message: string, data: unknown[]): LogEntry =>
  timestamp(simple(splat(createEntry(level, message, data))));

/**
 * `JSON.stringify` with the keys of every object sorted and a circular
 * reference written as `"[Circular]"`, as `safe-stable-stringify` does for
 * logform.
 */
export const stableStringify = (value: unknown): string | undefined => {
  const stack: unknown[] = [];

  const walk = (key: string, input: unknown): string | undefined => {
    const toJSON = (input as { toJSON?: unknown } | null)?.toJSON;
    const value =
      typeof input === "object" && input !== null && typeof toJSON === "function" ? toJSON.call(input, key) : input;

    switch (typeof value) {
      case "string":
        return JSON.stringify(value);
      case "number":
        return Number.isFinite(value) ? String(value) : "null";
      case "boolean":
      case "bigint":
        return String(value);
      case "object": {
        if (value === null) return "null";
        if (stack.includes(value)) return JSON.stringify("[Circular]");

        stack.push(value);

        const result = Array.isArray(value)
          ? `[${value.map((item, index) => walk(String(index), item) ?? "null").join(",")}]`
          : `{${Object.keys(value)
              .sort()
              .flatMap((field) => {
                const written = walk(field, (value as Record<string, unknown>)[field]);

                return written === undefined ? [] : [`${JSON.stringify(field)}:${written}`];
              })
              .join(",")}}`;

        stack.pop();

        return result;
      }
      default:
        return undefined;
    }
  };

  return walk("", value);
};

const formatNumber = (value: number) => (Object.is(value, -0) ? "-0" : `${value}`);

/**
 * A value as `util.inspect` writes it, for the primitives.
 *
 * shortcut: an object is written as JSON, where `util.inspect` writes its own
 * notation; upgrade if a log message interpolates objects with `%s`, `%o` or
 * `%O`, or passes them after its tokens.
 */
const inspect = (value: unknown): string => {
  switch (typeof value) {
    case "string":
      return `'${value}'`;
    case "number":
      return formatNumber(value);
    case "bigint":
      return `${value}n`;
    case "function":
      return `[Function: ${value.name || "(anonymous)"}]`;
    case "object":
      if (value === null) return "null";
      if (value instanceof Error) return value.stack ?? String(value);

      return stableStringify(value) ?? String(value);
    default:
      return String(value);
  }
};

const toJson = (value: unknown) => {
  try {
    return JSON.stringify(value);
  } catch {
    return "[Circular]";
  }
};

/** `util.format`, which logform's `splat` uses to interpolate the tokens. */
export const format = (template: string, args: unknown[]): string => {
  if (args.length === 0) {
    return template;
  }

  let result = "";
  let next = 0;
  let lastPos = 0;

  for (let i = 0; i < template.length - 1; i++) {
    if (template[i] !== "%") continue;

    const specifier = template[++i];

    if (next === args.length) {
      if (specifier === "%") {
        result += template.slice(lastPos, i);
        lastPos = i + 1;
      }

      continue;
    }

    let written: string;

    switch (specifier) {
      case "s": {
        const arg = args[next++];

        written =
          typeof arg === "number"
            ? formatNumber(arg)
            : typeof arg === "bigint"
              ? `${arg}n`
              : typeof arg === "object" && arg !== null
                ? inspect(arg)
                : String(arg);
        break;
      }
      case "j":
        written = toJson(args[next++]);
        break;
      case "d": {
        const arg = args[next++];

        written = typeof arg === "bigint" ? `${arg}n` : typeof arg === "symbol" ? "NaN" : formatNumber(Number(arg));
        break;
      }
      case "i": {
        const arg = args[next++];

        written =
          typeof arg === "bigint"
            ? `${arg}n`
            : typeof arg === "symbol"
              ? "NaN"
              : formatNumber(Number.parseInt(arg as string));
        break;
      }
      case "f": {
        const arg = args[next++];

        written = typeof arg === "symbol" ? "NaN" : formatNumber(Number.parseFloat(arg as string));
        break;
      }
      case "o":
      case "O":
        written = inspect(args[next++]);
        break;
      case "c":
        next++;
        written = "";
        break;
      case "%":
        result += template.slice(lastPos, i);
        lastPos = i + 1;
        continue;
      default:
        continue;
    }

    if (lastPos !== i - 1) {
      result += template.slice(lastPos, i - 1);
    }

    result += written;
    lastPos = i + 1;
  }

  let separator = "";

  if (lastPos !== 0) {
    separator = " ";

    if (lastPos < template.length) {
      result += template.slice(lastPos);
    }
  } else {
    result = template;
    separator = " ";
  }

  for (; next < args.length; next++) {
    const arg = args[next];

    result += separator + (typeof arg === "string" ? arg : inspect(arg));
  }

  return result;
};
