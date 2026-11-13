/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

/**
 * The most of a file that is read into the editor. A longer file opens
 * truncated and read-only.
 */
export const maxEditorBytes = 1024 * 1024;

/**
 * The largest file that can be downloaded from, or uploaded to, a container.
 * The content crosses the IPC as base64, so this bounds the memory both
 * processes hold for one transfer.
 */
export const maxTransferBytes = 16 * 1024 * 1024;
