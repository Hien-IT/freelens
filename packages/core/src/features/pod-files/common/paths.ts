/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

/**
 * Paths inside a container are POSIX paths whatever the host is, so these
 * helpers never use `node:path`.
 */

/**
 * True for an absolute POSIX path without a NUL byte, the only kind of path
 * the file operations accept.
 */
export function isAbsoluteContainerPath(path: unknown): path is string {
  return typeof path === "string" && path.startsWith("/") && !path.includes("\0");
}

function toSegments(path: string): string[] {
  const segments: string[] = [];

  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }

    if (segment === "..") {
      segments.pop();
    } else {
      segments.push(segment);
    }
  }

  return segments;
}

/**
 * Resolves `.` and `..`, collapses repeated slashes and ends the path with a
 * slash: `"/var//log/../lib"` is `"/var/lib/"`.
 */
export function normalizeDirectoryPath(path: string): string {
  const segments = toSegments(path);

  return segments.length === 0 ? "/" : `/${segments.join("/")}/`;
}

export function joinContainerPath(directory: string, name: string): string {
  return `${normalizeDirectoryPath(directory)}${name}`;
}

export function getParentDirectory(path: string): string {
  const segments = toSegments(path);

  segments.pop();

  return segments.length === 0 ? "/" : `/${segments.join("/")}/`;
}

export function getBaseName(path: string): string {
  return toSegments(path).at(-1) ?? "/";
}

export interface BreadcrumbSegment {
  readonly name: string;
  readonly path: string;
}

/**
 * The directories from the root to `directory`, each with the path that
 * navigates to it. The root is not included.
 */
export function getBreadcrumbSegments(directory: string): BreadcrumbSegment[] {
  const segments = toSegments(directory);

  return segments.map((name, index) => ({
    name,
    path: `/${segments.slice(0, index + 1).join("/")}/`,
  }));
}
