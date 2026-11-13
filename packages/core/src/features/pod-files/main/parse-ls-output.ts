/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { joinContainerPath } from "../common/paths";

import type { PodFileEntry } from "../common/types";

/**
 * A line of `ls -la` from GNU coreutils, BusyBox or toybox:
 *
 * ```text
 * drwxr-xr-x    2 root     root          4096 Nov 13 13:21 bin
 * lrwxrwxrwx    1 root     root            12 Jan  1  2025 sh -> /bin/busybox
 * crw-rw-rw-    1 root     root        1,   3 Nov 13 13:21 null
 * ```
 *
 * The date is either ISO (`2025-01-01 12:00`, as toybox and some locales of
 * GNU `ls` print it, with optional seconds and zone) or any three fields
 * (`Nov 13 13:21`), so that a localized month name parses too. The name is
 * everything after the single space that follows the date.
 */
const longLinePattern = new RegExp(
  [
    /^(\S)(\S{9})\S?\s+\d+\s+\S+\s+\S+\s+(\d+|\d+,\s*\d+)\s+/.source,
    /(?:\d{4}-\d\d-\d\d\s+\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:\s+[+-]\d{4})?|\S+\s+\S+\s+\S+)/.source,
    / (.+)$/.source,
  ].join(""),
);

/**
 * Parses the output of `ls -la <directory>` into entries, leaving out `.` and
 * `..`. Lines that are not entries, such as `total 12`, are skipped.
 */
export function parseLongListing(output: string, directory: string): PodFileEntry[] {
  const entries: PodFileEntry[] = [];

  for (const rawLine of output.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    const match = longLinePattern.exec(line);

    if (!match) {
      continue;
    }

    const [, type, mode, size, rawName] = match;
    const isSymlink = type === "l";
    const arrow = isSymlink ? rawName.indexOf(" -> ") : -1;
    const name = arrow >= 0 ? rawName.slice(0, arrow) : rawName;

    if (name === "." || name === "..") {
      continue;
    }

    entries.push({
      name,
      path: joinContainerPath(directory, name),
      isDirectory: type === "d",
      isSymlink,
      symlinkTarget: arrow >= 0 ? rawName.slice(arrow + 4) : undefined,
      permissions: `${type}${mode}`,
      size: size.includes(",") ? undefined : Number(size),
    });
  }

  return entries;
}

/**
 * Parses the output of `ls -1ap <directory>`, where a directory ends with `/`.
 */
export function parseShortListing(output: string, directory: string): PodFileEntry[] {
  const entries: PodFileEntry[] = [];

  for (const rawLine of output.split("\n")) {
    const line = rawLine.replace(/\r$/, "");

    if (line === "" || line === "./" || line === "../") {
      continue;
    }

    const isDirectory = line.endsWith("/");
    const name = isDirectory ? line.slice(0, -1) : line;

    entries.push({
      name,
      path: joinContainerPath(directory, name),
      isDirectory,
      isSymlink: false,
    });
  }

  return entries;
}

/**
 * Directories first, then by name.
 */
export function sortEntries(entries: PodFileEntry[]): PodFileEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }

    return a.name.localeCompare(b.name);
  });
}
