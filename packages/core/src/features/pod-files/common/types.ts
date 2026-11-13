/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import type { ClusterId } from "../../../common/cluster-types";

/**
 * The container of a running pod that a file operation runs in.
 */
export interface PodFilesTarget {
  readonly clusterId: ClusterId;
  readonly namespace: string;
  readonly pod: string;
  readonly container: string;
}

/**
 * One entry of a directory listing in a container.
 *
 * `permissions` and `size` are missing when the container's `ls` cannot give a
 * long listing, and `size` is missing for device files.
 */
export interface PodFileEntry {
  readonly name: string;
  /** The absolute path of the entry. */
  readonly path: string;
  readonly isDirectory: boolean;
  readonly isSymlink: boolean;
  readonly symlinkTarget?: string;
  readonly permissions?: string;
  readonly size?: number;
}

export interface PodFileContent {
  /** The content decoded as UTF-8, empty for a binary file. */
  readonly content: string;
  /** True when the file is longer than what was read. */
  readonly truncated: boolean;
  readonly isBinary: boolean;
}

export type PodFilesOperation =
  | { readonly type: "list"; readonly path: string }
  | { readonly type: "read"; readonly path: string }
  | { readonly type: "download"; readonly path: string }
  | { readonly type: "write"; readonly path: string; readonly contentBase64: string }
  | { readonly type: "delete"; readonly path: string; readonly recursive: boolean };

export type PodFilesRequest = PodFilesTarget & { readonly operation: PodFilesOperation };

export interface PodFilesResultData {
  list: PodFileEntry[];
  read: PodFileContent;
  download: { readonly contentBase64: string };
  write: undefined;
  delete: undefined;
}

export type PodFilesResponse<T = unknown> =
  | { readonly callWasSuccessful: true; readonly response: T }
  | { readonly callWasSuccessful: false; readonly error: string };
