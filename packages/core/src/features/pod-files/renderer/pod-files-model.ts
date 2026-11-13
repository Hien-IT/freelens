/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { action, computed, observable, observableRef, runInAction } from "mobx";
import { maxTransferBytes } from "../common/limits";
import { getBaseName, joinContainerPath, normalizeDirectoryPath } from "../common/paths";
import { base64ToBytes, bytesToBase64 } from "./base64";

import type { ClusterId } from "../../../common/cluster-types";
import type { PodFileContent, PodFileEntry, PodFilesTarget } from "../common/types";
import type { RequestPodFiles } from "./request-pod-files.injectable";
import type { PodFilesTabData, PodFilesTabStore } from "./tab-store";

export interface PodFilesModelDependencies {
  readonly tabStore: PodFilesTabStore;
  readonly requestPodFiles: RequestPodFiles;
  readonly clusterId: ClusterId;
  readonly showSuccess: (message: string) => void;
  readonly showError: (message: string) => void;
  readonly confirm: (params: { message: string; labelOk: string }) => Promise<boolean>;
  readonly saveFile: (fileName: string, contents: Uint8Array<ArrayBuffer>, type: string) => void;
  readonly copyToClipboard: (text: string) => Promise<void>;
}

export interface OpenFile {
  readonly path: string;
  readonly size?: number;
}

/**
 * The state of one file browser tab: the directory listing and the file open
 * in the editor.
 */
export class PodFilesModel {
  @observableRef accessor entries: PodFileEntry[] = [];
  @observable accessor isLoading = false;
  @observable accessor loadError: string | undefined = undefined;
  @observable accessor filter = "";

  @observableRef accessor openFile: OpenFile | undefined = undefined;
  @observableRef accessor fileContent: PodFileContent | undefined = undefined;
  @observable accessor isFileLoading = false;
  @observable accessor fileError: string | undefined = undefined;
  @observable accessor editedContent = "";
  @observable accessor isSaving = false;
  @observable accessor pendingUploads = 0;

  /** Discards the answer of a listing that a later navigation superseded. */
  private listingRequest = 0;
  private fileRequest = 0;

  constructor(
    private readonly tabId: string,
    private readonly dependencies: PodFilesModelDependencies,
  ) {}

  @computed
  get data(): PodFilesTabData | undefined {
    return this.dependencies.tabStore.getData(this.tabId);
  }

  @computed
  get directory(): string {
    return this.data?.directory ?? "/";
  }

  get target(): PodFilesTarget | undefined {
    const data = this.data;

    return (
      data && {
        clusterId: this.dependencies.clusterId,
        namespace: data.namespace,
        pod: data.pod,
        container: data.container,
      }
    );
  }

  @computed
  get visibleEntries(): PodFileEntry[] {
    const filter = this.filter.trim().toLowerCase();

    return filter ? this.entries.filter((entry) => entry.name.toLowerCase().includes(filter)) : this.entries;
  }

  @computed
  get isModified(): boolean {
    return this.fileContent !== undefined && this.editedContent !== this.fileContent.content;
  }

  @computed
  get isReadOnly(): boolean {
    return !this.fileContent || this.fileContent.truncated || this.fileContent.isBinary;
  }

  @action
  setFilter(filter: string) {
    this.filter = filter;
  }

  @action
  setEditedContent(content: string) {
    this.editedContent = content;
  }

  @action
  discardChanges() {
    this.editedContent = this.fileContent?.content ?? "";
  }

  @action
  closeFile() {
    this.fileRequest++;
    this.openFile = undefined;
    this.fileContent = undefined;
    this.fileError = undefined;
    this.isFileLoading = false;
    this.editedContent = "";
  }

  @action
  private setTabData(data: Partial<PodFilesTabData>) {
    const current = this.data;

    if (current) {
      this.dependencies.tabStore.setData(this.tabId, { ...current, ...data });
    }
  }

  async refresh(): Promise<void> {
    const target = this.target;

    if (!target) {
      return;
    }

    const request = ++this.listingRequest;
    const directory = this.directory;

    runInAction(() => {
      this.isLoading = true;
      this.loadError = undefined;
    });

    const result = await this.dependencies.requestPodFiles(target, { type: "list", path: directory });

    runInAction(() => {
      if (request !== this.listingRequest) {
        return;
      }

      this.isLoading = false;

      if (result.callWasSuccessful) {
        this.entries = result.response;
      } else {
        this.entries = [];
        this.loadError = result.error;
      }
    });
  }

  async navigate(directory: string): Promise<void> {
    runInAction(() => {
      this.setTabData({ directory: normalizeDirectoryPath(directory) });
      this.filter = "";
    });

    await this.refresh();
  }

  async selectContainer(container: string): Promise<void> {
    if (container === this.data?.container) {
      return;
    }

    if (this.isModified && !(await this.confirmDiscard())) {
      return;
    }

    runInAction(() => {
      this.closeFile();
      this.setTabData({ container, directory: "/" });
      this.filter = "";
    });

    await this.refresh();
  }

  /**
   * Opens a directory by navigating into it and a file in the editor. A
   * symbolic link is opened as a directory when it lists as one.
   */
  async openEntry(entry: PodFileEntry): Promise<void> {
    if (entry.isDirectory) {
      return this.navigate(entry.path);
    }

    const target = this.target;

    if (entry.isSymlink && target) {
      const listing = await this.dependencies.requestPodFiles(target, {
        type: "list",
        path: normalizeDirectoryPath(entry.path),
      });

      if (listing.callWasSuccessful) {
        return this.navigate(entry.path);
      }
    }

    return this.open({ path: entry.path, size: entry.size });
  }

  async open(file: OpenFile): Promise<void> {
    const target = this.target;

    if (!target || file.path === this.openFile?.path) {
      return;
    }

    if (this.isModified && !(await this.confirmDiscard())) {
      return;
    }

    const request = ++this.fileRequest;

    runInAction(() => {
      this.openFile = file;
      this.fileContent = undefined;
      this.fileError = undefined;
      this.editedContent = "";
      this.isFileLoading = true;
    });

    const result = await this.dependencies.requestPodFiles(target, { type: "read", path: file.path });

    runInAction(() => {
      if (request !== this.fileRequest) {
        return;
      }

      this.isFileLoading = false;

      if (result.callWasSuccessful) {
        this.fileContent = result.response;
        this.editedContent = result.response.content;
      } else {
        this.fileError = result.error;
      }
    });
  }

  async save(): Promise<void> {
    const target = this.target;
    const file = this.openFile;

    if (!target || !file || this.isReadOnly || this.isSaving) {
      return;
    }

    const content = this.editedContent;

    runInAction(() => (this.isSaving = true));

    const result = await this.dependencies.requestPodFiles(target, {
      type: "write",
      path: file.path,
      contentBase64: bytesToBase64(new TextEncoder().encode(content)),
    });

    runInAction(() => {
      this.isSaving = false;

      if (result.callWasSuccessful) {
        if (this.openFile?.path === file.path && this.fileContent) {
          this.fileContent = { ...this.fileContent, content };
        }
      }
    });

    if (result.callWasSuccessful) {
      this.dependencies.showSuccess(`Saved ${file.path}`);
      void this.refresh();
    } else {
      this.dependencies.showError(`Failed to save ${file.path}: ${result.error}`);
    }
  }

  async download(path: string): Promise<void> {
    const target = this.target;

    if (!target) {
      return;
    }

    const result = await this.dependencies.requestPodFiles(target, { type: "download", path });

    if (result.callWasSuccessful) {
      this.dependencies.saveFile(
        getBaseName(path),
        base64ToBytes(result.response.contentBase64),
        "application/octet-stream",
      );
    } else {
      this.dependencies.showError(`Failed to download ${path}: ${result.error}`);
    }
  }

  async upload(files: File[]): Promise<void> {
    const target = this.target;

    if (!target) {
      return;
    }

    const directory = this.directory;

    for (const file of files) {
      if (file.size > maxTransferBytes) {
        this.dependencies.showError(
          `${file.name} is larger than the upload limit of ${maxTransferBytes / (1024 * 1024)} MiB`,
        );
        continue;
      }

      const existing = this.entries.find((entry) => entry.name === file.name);

      if (existing?.isDirectory) {
        this.dependencies.showError(`${file.name} is a directory in ${directory}`);
        continue;
      }

      if (
        existing &&
        !(await this.dependencies.confirm({
          message: `${file.name} already exists in ${directory}. Overwrite it?`,
          labelOk: "Overwrite",
        }))
      ) {
        continue;
      }

      const path = joinContainerPath(directory, file.name);

      runInAction(() => this.pendingUploads++);

      try {
        const contentBase64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
        const result = await this.dependencies.requestPodFiles(target, { type: "write", path, contentBase64 });

        if (result.callWasSuccessful) {
          this.dependencies.showSuccess(`Uploaded ${path}`);
        } else {
          this.dependencies.showError(`Failed to upload ${path}: ${result.error}`);
        }
      } finally {
        runInAction(() => this.pendingUploads--);
      }
    }

    if (this.directory === directory) {
      await this.refresh();
    }
  }

  async remove(entry: PodFileEntry): Promise<void> {
    const target = this.target;

    if (!target) {
      return;
    }

    const confirmed = await this.dependencies.confirm({
      message: entry.isDirectory ? `Delete the directory ${entry.path} and everything in it?` : `Delete ${entry.path}?`,
      labelOk: "Delete",
    });

    if (!confirmed) {
      return;
    }

    const result = await this.dependencies.requestPodFiles(target, {
      type: "delete",
      path: entry.path,
      recursive: entry.isDirectory,
    });

    if (result.callWasSuccessful) {
      this.dependencies.showSuccess(`Deleted ${entry.path}`);

      if (
        this.openFile?.path === entry.path ||
        (entry.isDirectory && this.openFile?.path.startsWith(`${entry.path}/`))
      ) {
        this.closeFile();
      }

      await this.refresh();
    } else {
      this.dependencies.showError(`Failed to delete ${entry.path}: ${result.error}`);
    }
  }

  async copyPath(path: string): Promise<void> {
    try {
      await this.dependencies.copyToClipboard(path);
      this.dependencies.showSuccess("Path copied to clipboard");
    } catch (error) {
      this.dependencies.showError(`Failed to copy the path: ${String(error)}`);
    }
  }

  private confirmDiscard(): Promise<boolean> {
    return this.dependencies.confirm({
      message: `Discard the unsaved changes to ${this.openFile?.path}?`,
      labelOk: "Discard",
    });
  }
}
