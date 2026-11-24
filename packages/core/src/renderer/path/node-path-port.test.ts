/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import path from "node:path";
import { describe, expect, it } from "vitest";
import { posix, win32 } from "./node-path-port";

const paths = [
  "",
  ".",
  "..",
  "/",
  "//",
  "///",
  "\\",
  "\\\\",
  "a",
  "a/",
  "a//",
  "./a",
  "../a",
  "a/./b",
  "a/../b",
  "a/../../b",
  "/a/b/c",
  "/a/b/c/",
  "/a/b/../../..",
  "/a/./b/.",
  "a/b/c.txt",
  "a/b/.hidden",
  "a/b/.hidden.txt",
  "a/b/file.tar.gz",
  "a/b/file.",
  "a/b/..",
  "...",
  "a/...",
  "a\\b\\c",
  "a\\b/c\\d",
  "C:",
  "C:\\",
  "C:/",
  "C:a",
  "C:a\\b",
  "C:\\a\\b",
  "C:/a/b/",
  "c:\\a\\..\\..\\b",
  "C:\\..",
  "C:\\a\\b.txt",
  "\\\\server\\share",
  "\\\\server\\share\\",
  "\\\\server\\share\\dir\\file.txt",
  "//server/share/dir",
  "\\\\server",
  "\\\\?\\C:\\a",
  "\\\\.\\PHYSICALDRIVE0",
  "\\\\?\\COM1:\\a",
  "a:b",
  "a:b:c",
  "./a:b",
  "c:/../a:b",
  "CON:",
  "con:\\a",
  "COM1:",
  "foo\\..\\..\\bar",
  "~/a/b",
  "/home/user/.kube/config",
  "C:\\Users\\user\\.kube\\config",
];

const joins: string[][] = [
  [],
  [""],
  ["", ""],
  ["a", "b"],
  ["a/", "/b"],
  ["/a", "b", "../c"],
  ["a", "", "b"],
  ["..", "a"],
  ["C:", "a"],
  ["C:\\", "a", "b"],
  ["//server", "share"],
  ["\\\\server", "share", "dir"],
  ["//", "a"],
  ["///", "a"],
  ["\\", "a"],
  ["a", "CON:"],
  ["a", "b:c"],
  ["/home/user", ".kube", "config"],
  ["C:\\Users\\user", ".kube", "config"],
];

const suffixes = ["", ".txt", "c.txt", "txt", "config", "b"];

describe.each([
  ["posix", posix, path.posix],
  ["win32", win32, path.win32],
] as const)("the %s port of node:path", (_form, port, node) => {
  it("has the same separator", () => {
    expect(port.sep).toBe(node.sep);
  });

  it.each(paths)("normalizes %j as node:path does", (value) => {
    expect(port.normalize(value)).toBe(node.normalize(value));
  });

  it.each(paths)("tells whether %j is absolute as node:path does", (value) => {
    expect(port.isAbsolute(value)).toBe(node.isAbsolute(value));
  });

  it.each(paths)("takes the dirname of %j as node:path does", (value) => {
    expect(port.dirname(value)).toBe(node.dirname(value));
  });

  it.each(paths)("takes the basename of %j as node:path does", (value) => {
    expect(port.basename(value)).toBe(node.basename(value));

    for (const suffix of suffixes) {
      expect(port.basename(value, suffix)).toBe(node.basename(value, suffix));
    }
  });

  it.each(paths)("parses %j as node:path does", (value) => {
    expect(port.parse(value)).toEqual(node.parse(value));
  });

  it.each(joins.map((parts) => [parts]))("joins %j as node:path does", (parts) => {
    expect(port.join(...parts)).toBe(node.join(...parts));
  });

  it("refuses a path that is not a string, as node:path does", () => {
    expect(() => port.normalize(1 as unknown as string)).toThrow(TypeError);
    expect(() => node.normalize(1 as unknown as string)).toThrow(TypeError);
  });
});
