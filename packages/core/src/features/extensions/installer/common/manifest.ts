/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { isObject, isString } from "@freelensapp/utilities";
import * as verkit from "verkit";

import type { LensExtensionManifest } from "../../../../extensions/installed-extension";

export const manifestFilename = "package.json";

/**
 * An npm package name, optionally scoped: lowercase, and neither part may
 * start with a dot or an underscore, so no part is `.` or `..`.
 */
const packageNamePattern = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/;

/**
 * The checks every install shape shares, whether the manifest came out of a
 * tarball or out of a directory registered in place.
 *
 * The name and the version are required here and not only by the loader,
 * because they are what the install path is built from: the name must be a
 * valid npm package name and the version valid semver, so that neither can
 * carry a path separator or a `..` segment out of the extensions root.
 */
export function validateExtensionManifest(manifest: unknown): LensExtensionManifest {
  if (!isObject(manifest)) {
    throw new Error(`${manifestFilename} is not an object`);
  }

  if (!isString(manifest.name) || !manifest.name) {
    throw new Error(`${manifestFilename} must specify "name"`);
  }

  if (!packageNamePattern.test(manifest.name)) {
    throw new Error(`${manifestFilename} "name" is not a valid npm package name: ${JSON.stringify(manifest.name)}`);
  }

  if (!isString(manifest.version) || !manifest.version) {
    throw new Error(`${manifestFilename} must specify "version"`);
  }

  if (manifest.version !== manifest.version.trim() || !verkit.isValid(manifest.version)) {
    throw new Error(`${manifestFilename} "version" is not a valid semver version: ${JSON.stringify(manifest.version)}`);
  }

  if (!isString(manifest.main) && !isString(manifest.renderer)) {
    throw new Error(`${manifestFilename} must specify "main" and/or "renderer" field`);
  }

  if (!isObject(manifest.engines) || !isString(manifest.engines.freelens)) {
    throw new Error(`${manifestFilename} must specify "freelens" in "engines" field`);
  }

  return manifest as unknown as LensExtensionManifest;
}
