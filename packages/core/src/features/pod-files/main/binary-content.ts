/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

const binaryExtensions = new Set([
  "7z",
  "a",
  "avi",
  "bin",
  "bmp",
  "bz2",
  "class",
  "db",
  "dll",
  "doc",
  "docx",
  "dylib",
  "elf",
  "eot",
  "exe",
  "flac",
  "gif",
  "gz",
  "ico",
  "jar",
  "jpeg",
  "jpg",
  "mkv",
  "mov",
  "mp3",
  "mp4",
  "o",
  "ogg",
  "otf",
  "pdf",
  "png",
  "ppt",
  "pptx",
  "pyc",
  "pyo",
  "rar",
  "so",
  "sqlite",
  "tar",
  "tgz",
  "ttf",
  "wasm",
  "wav",
  "webp",
  "woff",
  "woff2",
  "xls",
  "xlsx",
  "xz",
  "zip",
  "zst",
]);

/**
 * How much of the start of a file is looked at for a NUL byte.
 */
const sniffLength = 512;

export function hasBinaryExtension(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");

  return dot > 0 && binaryExtensions.has(name.slice(dot + 1).toLowerCase());
}

/**
 * True when the start of the content holds a NUL byte, which text files do not.
 */
export function looksBinary(content: Uint8Array): boolean {
  return content.subarray(0, sniffLength).includes(0);
}
