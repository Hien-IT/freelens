/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { describe, expect, it } from "vitest";
import {
  getBaseName,
  getBreadcrumbSegments,
  getParentDirectory,
  isAbsoluteContainerPath,
  joinContainerPath,
  normalizeDirectoryPath,
} from "../paths";

describe("container paths", () => {
  it.each([
    ["/", "/"],
    ["", "/"],
    ["/var/log", "/var/log/"],
    ["/var//log/", "/var/log/"],
    ["/var/./log/../lib", "/var/lib/"],
    ["/../..", "/"],
  ])("normalizes the directory %j to %j", (path, expected) => {
    expect(normalizeDirectoryPath(path)).toBe(expected);
  });

  it("joins a name to a directory", () => {
    expect(joinContainerPath("/etc", "hosts")).toBe("/etc/hosts");
    expect(joinContainerPath("/", "etc")).toBe("/etc");
  });

  it.each([
    ["/var/log/", "/var/"],
    ["/var/log/syslog", "/var/log/"],
    ["/var", "/"],
    ["/", "/"],
  ])("gives %j the parent %j", (path, expected) => {
    expect(getParentDirectory(path)).toBe(expected);
  });

  it("gives the base name", () => {
    expect(getBaseName("/var/log/syslog")).toBe("syslog");
    expect(getBaseName("/var/log/")).toBe("log");
    expect(getBaseName("/")).toBe("/");
  });

  it("gives a breadcrumb segment per directory", () => {
    expect(getBreadcrumbSegments("/var/log/")).toEqual([
      { name: "var", path: "/var/" },
      { name: "log", path: "/var/log/" },
    ]);
    expect(getBreadcrumbSegments("/")).toEqual([]);
  });

  it("accepts only absolute paths without a NUL byte", () => {
    expect(isAbsoluteContainerPath("/etc/hosts")).toBe(true);
    expect(isAbsoluteContainerPath("etc/hosts")).toBe(false);
    expect(isAbsoluteContainerPath("/etc/\0hosts")).toBe(false);
    expect(isAbsoluteContainerPath(42)).toBe(false);
    expect(isAbsoluteContainerPath(undefined)).toBe(false);
  });
});
