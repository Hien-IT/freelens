/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import type { MonacoLanguage } from "../../../renderer/components/monaco-editor";
import type { PodFileEntry } from "../common/types";

const languagesByExtension: Record<string, MonacoLanguage> = {
  bash: "shell",
  cfg: "ini",
  conf: "ini",
  env: "ini",
  go: "go",
  ini: "ini",
  java: "java",
  json: "json",
  md: "markdown",
  properties: "ini",
  py: "python",
  rs: "rust",
  sh: "shell",
  sql: "sql",
  toml: "ini",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "shell",
};

function getExtension(name: string): string | undefined {
  const dot = name.lastIndexOf(".");

  return dot > 0 ? name.slice(dot + 1).toLowerCase() : undefined;
}

export function getEditorLanguage(path: string): MonacoLanguage {
  const name = path.slice(path.lastIndexOf("/") + 1);

  if (name === "Dockerfile" || name.startsWith("Dockerfile.")) {
    return "dockerfile";
  }

  return languagesByExtension[getExtension(name) ?? ""] ?? "plaintext";
}

const archiveExtensions = new Set(["7z", "bz2", "gz", "jar", "rar", "tar", "tgz", "xz", "zip", "zst"]);
const imageExtensions = new Set(["bmp", "gif", "ico", "jpeg", "jpg", "png", "svg", "webp"]);
const keyExtensions = new Set(["crt", "key", "pem", "pub"]);

/**
 * The Material icon of an entry.
 */
export function getEntryIcon(entry: PodFileEntry): string {
  if (entry.isSymlink) {
    return "link";
  }

  if (entry.isDirectory) {
    return "folder";
  }

  const extension = getExtension(entry.name) ?? "";

  if (archiveExtensions.has(extension)) {
    return "archive";
  }

  if (imageExtensions.has(extension)) {
    return "image";
  }

  if (keyExtensions.has(extension)) {
    return "key";
  }

  if (languagesByExtension[extension] || entry.name === "Dockerfile") {
    return "code";
  }

  return "description";
}

export function formatFileSize(bytes: number | undefined): string {
  if (bytes === undefined) {
    return "";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KiB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
