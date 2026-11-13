/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { describe, expect, it } from "vitest";
import { validateExtensionManifest } from "./manifest";

const manifestWith = (fields: Record<string, unknown>) => ({
  name: "my-extension",
  version: "1.0.0",
  renderer: "out/renderer.js",
  engines: { freelens: "^2.0.0" },
  ...fields,
});

describe("validateExtensionManifest", () => {
  it.each(["my-extension", "@freelensapp/example-extension", "a.b_c~d"])("accepts the name %j", (name) => {
    expect(validateExtensionManifest(manifestWith({ name })).name).toBe(name);
  });

  it.each(["1.0.0", "2.0.0-3", "1.0.0-beta.1+build.2"])("accepts the version %j", (version) => {
    expect(validateExtensionManifest(manifestWith({ version })).version).toBe(version);
  });

  it.each([
    "..",
    ".",
    ".hidden",
    "_private",
    "a/b",
    "@scope/..",
    "@../x",
    "@scope/a/b",
    "a\\b",
    "..\\..\\x",
    "My-Extension",
    "with space",
  ])("rejects the name %j", (name) => {
    expect(() => validateExtensionManifest(manifestWith({ name }))).toThrow(/not a valid npm package name/);
  });

  it.each(["1.0.0/../../../../tmp/x", "..", "1.0", "latest", "1.0.0\\..\\x", " 1.0.0", "1.0.0\n"])(
    "rejects the version %j",
    (version) => {
      expect(() => validateExtensionManifest(manifestWith({ version }))).toThrow(/not a valid semver version/);
    },
  );

  it("still requires a name and a version", () => {
    expect(() => validateExtensionManifest(manifestWith({ name: "" }))).toThrow(/must specify "name"/);
    expect(() => validateExtensionManifest(manifestWith({ version: undefined }))).toThrow(/must specify "version"/);
  });
});
