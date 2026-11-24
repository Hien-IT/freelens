/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannel } from "@freelensapp/messaging";

import type { LensExtensionManifest } from "../../../../extensions/installed-extension";
import type { InstalledExtensionSource } from "./installed-extensions";

/** What is at a path the user gave: main reads only its kind. */
export type ExtensionPathKind = "file" | "directory" | "missing";

export const extensionPathKindChannel = getRequestChannel<{ path: string }, ExtensionPathKind>(
  "extension-install:path-kind",
);

/**
 * A package or a directory the user chose: a package's bytes as base64, with
 * the text of the `.sha256` beside it if there is one, or a directory's
 * validated manifest. Main refuses what it cannot read.
 */
export type ExtensionPathContents =
  | { kind: "file"; base64: string; sidecar?: string }
  | { kind: "directory"; manifest: LensExtensionManifest };

export const readExtensionPathChannel = getRequestChannel<{ path: string }, ExtensionPathContents>(
  "extension-install:read-path",
);

/** Puts a package in a directory of its own and reads its manifest; the id names it from then on. */
export const stageExtensionPackageChannel = getRequestChannel<
  { fileName: string; base64: string },
  { stagingId: string; manifest: LensExtensionManifest }
>("extension-install:stage");

/** Unpacks a staged package into the extensions directory and records it; the id is used once. */
export const commitExtensionPackageChannel = getRequestChannel<
  { stagingId: string; source?: InstalledExtensionSource; verified: boolean },
  { id: string; version: string }
>("extension-install:commit");

export const discardExtensionPackageChannel = getRequestChannel<{ stagingId: string }, void>(
  "extension-install:discard",
);

/** Records a directory the user chose as an extension loaded from where it is. */
export const registerExtensionDirectoryChannel = getRequestChannel<{ path: string }, { id: string }>(
  "extension-install:register-directory",
);

/** Opens the directory of an extension's builds in the file manager. */
export const openExtensionFolderChannel = getRequestChannel<{ name: string }, void>("extension-install:open-folder");
