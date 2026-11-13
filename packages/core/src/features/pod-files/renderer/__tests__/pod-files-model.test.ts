/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { base64ToBytes } from "../base64";
import { PodFilesModel } from "../pod-files-model";
import { PodFilesTabStore } from "../tab-store";

import type { Mock } from "vitest";

import type { PodFileEntry, PodFilesOperation } from "../../common/types";
import type { PodFilesModelDependencies } from "../pod-files-model";

const file = (name: string, directory = "/srv/"): PodFileEntry => ({
  name,
  path: `${directory}${name}`,
  isDirectory: false,
  isSymlink: false,
  size: 5,
});

const directory = (name: string): PodFileEntry => ({ ...file(name), isDirectory: true });

describe("pod files model", () => {
  let tabStore: PodFilesTabStore;
  let requestPodFiles: Mock;
  let confirm: Mock;
  let dependencies: PodFilesModelDependencies;
  let model: PodFilesModel;

  const operations = (): PodFilesOperation[] => requestPodFiles.mock.calls.map(([, operation]) => operation);

  beforeEach(() => {
    tabStore = new PodFilesTabStore({
      createStorage: () => ({ get: () => ({}), set: () => {}, merge: () => {}, reset: () => {} }) as never,
    });
    tabStore.setData("tab", {
      namespace: "shop",
      pod: "web-0",
      container: "app",
      containers: ["app", "sidecar"],
      directory: "/srv/",
    });

    requestPodFiles = vi.fn(async (_target, operation: PodFilesOperation) => {
      switch (operation.type) {
        case "list":
          return { callWasSuccessful: true, response: [directory("conf"), file("a.txt")] };
        case "read":
          return { callWasSuccessful: true, response: { content: "hello", truncated: false, isBinary: false } };
        case "download":
          return { callWasSuccessful: true, response: { contentBase64: "AAH/" } };
        default:
          return { callWasSuccessful: true, response: undefined };
      }
    });
    confirm = vi.fn(async () => true);

    dependencies = {
      tabStore,
      requestPodFiles,
      clusterId: "cluster",
      showSuccess: vi.fn(),
      showError: vi.fn(),
      confirm,
      saveFile: vi.fn(),
      copyToClipboard: vi.fn(async () => {}),
    };
    model = new PodFilesModel("tab", dependencies);
  });

  it("lists the directory of the tab in its container", async () => {
    await model.refresh();

    expect(requestPodFiles).toHaveBeenCalledWith(
      { clusterId: "cluster", namespace: "shop", pod: "web-0", container: "app" },
      { type: "list", path: "/srv/" },
    );
    expect(model.entries.map(({ name }) => name)).toEqual(["conf", "a.txt"]);
  });

  it("shows the error of a failed listing", async () => {
    requestPodFiles.mockResolvedValueOnce({ callWasSuccessful: false, error: "Permission denied" });

    await model.refresh();

    expect(model.loadError).toBe("Permission denied");
    expect(model.entries).toEqual([]);
  });

  it("navigates into a directory and remembers it in the tab", async () => {
    await model.openEntry(directory("conf"));

    expect(tabStore.getData("tab")?.directory).toBe("/srv/conf/");
    expect(operations().at(-1)).toEqual({ type: "list", path: "/srv/conf/" });
  });

  it("filters the entries by name", async () => {
    await model.refresh();
    model.setFilter("TXT");

    expect(model.visibleEntries.map(({ name }) => name)).toEqual(["a.txt"]);
  });

  it("opens a file in the editor", async () => {
    await model.openEntry(file("a.txt"));

    expect(model.openFile).toEqual({ path: "/srv/a.txt", size: 5 });
    expect(model.editedContent).toBe("hello");
    expect(model.isModified).toBe(false);
  });

  it("opens a symbolic link to a directory as a directory", async () => {
    await model.openEntry({ ...file("current"), isSymlink: true, symlinkTarget: "releases/42" });

    expect(operations()).toEqual([
      { type: "list", path: "/srv/current/" },
      { type: "list", path: "/srv/current/" },
    ]);
    expect(model.openFile).toBeUndefined();
  });

  it("opens a symbolic link to a file as a file", async () => {
    requestPodFiles.mockResolvedValueOnce({ callWasSuccessful: false, error: "Not a directory" });

    await model.openEntry({ ...file("config"), isSymlink: true });

    expect(operations().at(-1)).toEqual({ type: "read", path: "/srv/config" });
  });

  it("saves the edited content", async () => {
    await model.openEntry(file("a.txt"));
    model.setEditedContent("héllo");

    expect(model.isModified).toBe(true);

    await model.save();

    const write = operations().find(({ type }) => type === "write");

    expect(write).toMatchObject({ type: "write", path: "/srv/a.txt" });
    expect(new TextDecoder().decode(base64ToBytes((write as { contentBase64: string }).contentBase64))).toBe("héllo");
    expect(model.isModified).toBe(false);
  });

  it("does not save a truncated file", async () => {
    requestPodFiles.mockResolvedValueOnce({
      callWasSuccessful: true,
      response: { content: "big", truncated: true, isBinary: false },
    });

    await model.open({ path: "/srv/big.log" });
    model.setEditedContent("changed");
    await model.save();

    expect(operations().some(({ type }) => type === "write")).toBe(false);
  });

  it("asks before discarding unsaved changes", async () => {
    await model.openEntry(file("a.txt"));
    model.setEditedContent("changed");
    confirm.mockResolvedValueOnce(false);

    await model.openEntry(file("b.txt"));

    expect(model.openFile?.path).toBe("/srv/a.txt");
    expect(model.editedContent).toBe("changed");
  });

  it("downloads a file", async () => {
    await model.download("/srv/data.bin");

    expect(dependencies.saveFile).toHaveBeenCalledWith(
      "data.bin",
      new Uint8Array([0, 1, 255]),
      "application/octet-stream",
    );
  });

  it("uploads files to the directory shown", async () => {
    await model.refresh();
    await model.upload([new File(["new"], "new.txt")]);

    expect(confirm).not.toHaveBeenCalled();
    expect(operations()).toContainEqual({ type: "write", path: "/srv/new.txt", contentBase64: "bmV3" });
  });

  it("asks before overwriting a file by an upload", async () => {
    await model.refresh();
    confirm.mockResolvedValueOnce(false);

    await model.upload([new File(["new"], "a.txt")]);

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ labelOk: "Overwrite" }));
    expect(operations().some(({ type }) => type === "write")).toBe(false);
  });

  it("refuses an upload over a directory", async () => {
    await model.refresh();
    await model.upload([new File(["new"], "conf")]);

    expect(dependencies.showError).toHaveBeenCalled();
    expect(operations().some(({ type }) => type === "write")).toBe(false);
  });

  it("deletes a directory recursively after confirmation, closing a file in it", async () => {
    await model.open({ path: "/srv/conf/app.yaml" });
    await model.remove(directory("conf"));

    expect(operations()).toContainEqual({ type: "delete", path: "/srv/conf", recursive: true });
    expect(model.openFile).toBeUndefined();
  });

  it("does not delete when the confirmation is declined", async () => {
    confirm.mockResolvedValueOnce(false);

    await model.remove(file("a.txt"));

    expect(operations().some(({ type }) => type === "delete")).toBe(false);
  });

  it("switches to another container at the root", async () => {
    await model.selectContainer("sidecar");

    expect(tabStore.getData("tab")).toMatchObject({ container: "sidecar", directory: "/" });
    expect(requestPodFiles).toHaveBeenLastCalledWith(expect.objectContaining({ container: "sidecar" }), {
      type: "list",
      path: "/",
    });
  });
});
