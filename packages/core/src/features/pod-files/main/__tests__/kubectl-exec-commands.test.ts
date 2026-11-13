/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { describe, expect, it } from "vitest";
import { buildKubectlExecArgs, podFileCommands } from "../kubectl-exec-commands";

const target = { namespace: "default", pod: "web-0", container: "app" };

const hostileNames = [
  "/tmp/file with spaces.txt",
  '/tmp/it\'s "quoted"',
  "/tmp/$(rm -rf /)",
  "/tmp/`reboot`",
  "/tmp/a; rm -rf / #",
  "/tmp/new\nline",
  "-rf",
  "/tmp/--help",
];

describe("buildKubectlExecArgs", () => {
  it("runs the command in the container after --", () => {
    expect(buildKubectlExecArgs(target, ["ls", "-la"])).toEqual([
      "exec",
      "--namespace",
      "default",
      "web-0",
      "--container",
      "app",
      "--",
      "ls",
      "-la",
    ]);
  });

  it("keeps the standard input open only when asked", () => {
    expect(buildKubectlExecArgs(target, ["true"], { stdin: true }).slice(0, 2)).toEqual(["exec", "--stdin"]);
    expect(buildKubectlExecArgs(target, ["true"])).not.toContain("--stdin");
  });
});

describe("podFileCommands", () => {
  it.each(hostileNames)("passes %j to ls, head, cat and rm as one argument after --", (path) => {
    for (const command of [
      podFileCommands.listLong(path),
      podFileCommands.listShort(path),
      podFileCommands.readHead(path, 10),
      podFileCommands.readAll(path),
      podFileCommands.remove(path, true),
      podFileCommands.remove(path, false),
    ]) {
      expect(command.slice(command.indexOf("--") + 1)).toEqual([path]);
    }
  });

  it.each(hostileNames)("writes %j through a constant script that reads the path from $1", (path) => {
    expect(podFileCommands.write(path)).toEqual(["sh", "-c", 'cat > "$1"', "sh", path]);
  });

  it("lists in long form without colors", () => {
    expect(podFileCommands.listLong("/etc/")).toEqual(["ls", "-la", "--color=never", "--", "/etc/"]);
  });

  it("reads at most the given number of bytes", () => {
    expect(podFileCommands.readHead("/etc/hosts", 1025)).toEqual(["head", "-c", "1025", "--", "/etc/hosts"]);
  });

  it("deletes a directory recursively and a file alone", () => {
    expect(podFileCommands.remove("/tmp/dir", true)).toEqual(["rm", "-rf", "--", "/tmp/dir"]);
    expect(podFileCommands.remove("/tmp/file", false)).toEqual(["rm", "-f", "--", "/tmp/file"]);
  });
});
