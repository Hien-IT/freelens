/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { describe, expect, it } from "vitest";
import { parseLongListing, parseShortListing, sortEntries } from "../parse-ls-output";

describe("parseLongListing", () => {
  it("parses GNU coreutils output", () => {
    const output = [
      "total 16",
      "drwxr-xr-x 1 root root 4096 Nov 13 13:21 .",
      "drwxr-xr-x 1 root root 4096 Nov 13 13:21 ..",
      "-rw-r--r-- 1 root root  220 Jan  1  2025 .bashrc",
      "drwxr-xr-x 2 root root 4096 Nov 13 13:21 conf.d",
      "-rw-r----- 1 www  www  1234 Nov 13 09:05 nginx.conf",
    ].join("\n");

    expect(parseLongListing(output, "/etc/nginx/")).toEqual([
      {
        name: ".bashrc",
        path: "/etc/nginx/.bashrc",
        isDirectory: false,
        isSymlink: false,
        symlinkTarget: undefined,
        permissions: "-rw-r--r--",
        size: 220,
      },
      {
        name: "conf.d",
        path: "/etc/nginx/conf.d",
        isDirectory: true,
        isSymlink: false,
        symlinkTarget: undefined,
        permissions: "drwxr-xr-x",
        size: 4096,
      },
      {
        name: "nginx.conf",
        path: "/etc/nginx/nginx.conf",
        isDirectory: false,
        isSymlink: false,
        symlinkTarget: undefined,
        permissions: "-rw-r-----",
        size: 1234,
      },
    ]);
  });

  it("parses BusyBox output with symbolic links", () => {
    const output = [
      "total 0",
      "lrwxrwxrwx    1 root     root            12 Nov 13 13:21 sh -> /bin/busybox",
      "drwxr-xr-x    2 root     root          4096 Nov 13 13:21 bin",
    ].join("\n");

    expect(parseLongListing(output, "/bin")).toEqual([
      {
        name: "sh",
        path: "/bin/sh",
        isDirectory: false,
        isSymlink: true,
        symlinkTarget: "/bin/busybox",
        permissions: "lrwxrwxrwx",
        size: 12,
      },
      expect.objectContaining({ name: "bin", path: "/bin/bin", isDirectory: true }),
    ]);
  });

  it("parses ISO dates as toybox and some locales print them", () => {
    const output = [
      "-rw-r--r-- 1 root root 42 2025-01-01 12:00 app config.yaml",
      "-rw-r--r-- 1 root root 7 2025-01-01 12:00:00.000000000 +0000 notes.txt",
    ].join("\n");

    expect(parseLongListing(output, "/").map(({ name, size }) => ({ name, size }))).toEqual([
      { name: "app config.yaml", size: 42 },
      { name: "notes.txt", size: 7 },
    ]);
  });

  it("parses a localized month name", () => {
    expect(parseLongListing("-rw-r--r-- 1 root root 5 Mär  3 10:00 datei", "/")).toEqual([
      expect.objectContaining({ name: "datei", size: 5 }),
    ]);
  });

  it("keeps the spaces of a name", () => {
    expect(parseLongListing("-rw-r--r-- 1 root root 5 Nov 13 13:21  leading and  double", "/")).toEqual([
      expect.objectContaining({ name: " leading and  double", path: "/ leading and  double" }),
    ]);
  });

  it("gives device files no size", () => {
    expect(parseLongListing("crw-rw-rw- 1 root root 1,   3 Nov 13 13:21 null", "/dev/")).toEqual([
      expect.objectContaining({ name: "null", size: undefined, permissions: "crw-rw-rw-" }),
    ]);
  });

  it("accepts a permissions suffix for ACLs and SELinux contexts", () => {
    expect(parseLongListing("-rw-r--r--. 1 root root 5 Nov 13 13:21 file", "/")).toEqual([
      expect.objectContaining({ name: "file", permissions: "-rw-r--r--" }),
    ]);
  });

  it("strips the carriage returns of Windows line endings", () => {
    expect(parseLongListing("total 4\r\n-rw-r--r-- 1 root root 5 Nov 13 13:21 file\r\n", "/")).toEqual([
      expect.objectContaining({ name: "file", path: "/file" }),
    ]);
  });

  it("skips lines that are not entries", () => {
    expect(parseLongListing("total 0\n\nls: cannot access: Permission denied\n", "/")).toEqual([]);
  });
});

describe("parseShortListing", () => {
  it("parses ls -1ap output", () => {
    expect(parseShortListing("./\n../\nbin/\nhosts\r\nmy file\n", "/etc")).toEqual([
      { name: "bin", path: "/etc/bin", isDirectory: true, isSymlink: false },
      { name: "hosts", path: "/etc/hosts", isDirectory: false, isSymlink: false },
      { name: "my file", path: "/etc/my file", isDirectory: false, isSymlink: false },
    ]);
  });
});

describe("sortEntries", () => {
  it("puts directories first, then sorts by name", () => {
    const entry = (name: string, isDirectory: boolean) => ({ name, path: `/${name}`, isDirectory, isSymlink: false });

    expect(
      sortEntries([entry("b", false), entry("z", true), entry("a", false), entry("c", true)]).map(({ name }) => name),
    ).toEqual(["c", "z", "a", "b"]);
  });
});
