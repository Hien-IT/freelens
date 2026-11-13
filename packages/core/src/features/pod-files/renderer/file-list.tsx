/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Icon } from "@freelensapp/icon";
import { Spinner } from "@freelensapp/spinner";
import { cssNames } from "@freelensapp/utilities";
import { observer } from "mobx-react";
import React from "react";
import { DropFileInput } from "../../../renderer/components/input";
import { getParentDirectory } from "../common/paths";
import { formatFileSize, getEntryIcon } from "./file-types";
import styles from "./pod-files.module.scss";

import type { PodFileEntry } from "../common/types";
import type { PodFilesModel } from "./pod-files-model";

export interface PodFileListProps {
  model: PodFilesModel;
}

const stop = (handler: () => void) => (event: React.MouseEvent) => {
  event.stopPropagation();
  handler();
};

const EntryRow = observer(({ model, entry }: { model: PodFilesModel; entry: PodFileEntry }) => (
  <div
    className={cssNames(styles.entry, { [styles.entrySelected]: model.openFile?.path === entry.path })}
    onClick={() => void model.openEntry(entry)}
    data-testid={`pod-file-entry-${entry.name}`}
  >
    <Icon
      small
      material={getEntryIcon(entry)}
      className={cssNames(styles.entryIcon, { [styles.directoryIcon]: entry.isDirectory })}
    />
    <span className={styles.entryName} title={entry.path}>
      {entry.name}
      {entry.symlinkTarget && <span className={styles.symlinkTarget}>{`→ ${entry.symlinkTarget}`}</span>}
    </span>
    <span className={styles.entryPermissions}>{entry.permissions}</span>
    <span className={styles.entrySize}>{entry.isDirectory ? "" : formatFileSize(entry.size)}</span>
    <span className={styles.entryActions}>
      {!entry.isDirectory && (
        <Icon small material="download" tooltip="Download" onClick={stop(() => void model.download(entry.path))} />
      )}
      <Icon small material="content_copy" tooltip="Copy path" onClick={stop(() => void model.copyPath(entry.path))} />
      <Icon small material="delete" tooltip="Delete" onClick={stop(() => void model.remove(entry))} />
    </span>
  </div>
));

export const PodFileList = observer(({ model }: PodFileListProps) => {
  const renderContent = () => {
    if (model.isLoading && model.entries.length === 0) {
      return <Spinner center />;
    }

    if (model.loadError) {
      return <div className={styles.error}>{model.loadError}</div>;
    }

    const entries = model.visibleEntries;

    return (
      <>
        {model.directory !== "/" && (
          <div className={styles.entry} onClick={() => void model.navigate(getParentDirectory(model.directory))}>
            <Icon small material="folder" className={cssNames(styles.entryIcon, styles.directoryIcon)} />
            <span className={styles.entryName}>..</span>
          </div>
        )}
        {entries.map((entry) => (
          <EntryRow key={entry.path} model={model} entry={entry} />
        ))}
        {entries.length === 0 && (
          <div className={styles.message}>{model.filter ? "No matching files" : "Empty directory"}</div>
        )}
      </>
    );
  };

  return (
    <DropFileInput onDropFiles={(files) => void model.upload(files)}>
      <div className={cssNames(styles.list, { [styles.listWithEditor]: model.openFile })}>{renderContent()}</div>
    </DropFileInput>
  );
});
