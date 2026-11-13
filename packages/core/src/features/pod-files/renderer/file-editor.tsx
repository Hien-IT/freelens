/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Button } from "@freelensapp/button";
import { Icon } from "@freelensapp/icon";
import { Spinner } from "@freelensapp/spinner";
import { observer } from "mobx-react";
import { MonacoEditor } from "../../../renderer/components/monaco-editor";
import { getBaseName } from "../common/paths";
import { formatFileSize, getEditorLanguage, getEntryIcon } from "./file-types";
import styles from "./pod-files.module.scss";

import type { PodFilesModel } from "./pod-files-model";

export interface PodFileEditorProps {
  model: PodFilesModel;
  tabId: string;
}

export const PodFileEditor = observer(({ model, tabId }: PodFileEditorProps) => {
  const file = model.openFile;

  if (!file) {
    return null;
  }

  const content = model.fileContent;

  const renderBody = () => {
    if (model.isFileLoading) {
      return <Spinner center />;
    }

    if (model.fileError) {
      return <div className={styles.error}>{model.fileError}</div>;
    }

    if (!content) {
      return null;
    }

    if (content.isBinary) {
      return (
        <div className={styles.binary}>
          <Icon
            big
            material={getEntryIcon({
              name: getBaseName(file.path),
              path: file.path,
              isDirectory: false,
              isSymlink: false,
            })}
          />
          <span>Binary file, no preview</span>
          <Button primary label="Download" onClick={() => void model.download(file.path)} />
        </div>
      );
    }

    return (
      <MonacoEditor
        id={`pod-files-${tabId}-${file.path}`}
        className={styles.monaco}
        value={model.editedContent}
        language={getEditorLanguage(file.path)}
        readOnly={model.isReadOnly}
        onChange={(value) => model.setEditedContent(value)}
        options={{ wordWrap: "on" }}
      />
    );
  };

  return (
    <div className={styles.editor}>
      <div className={styles.editorHeader}>
        <span className={styles.editorPath} title={file.path}>
          {file.path}
        </span>
        {model.isModified && <span className={styles.modified}>Modified</span>}
        <span className={styles.editorMeta}>
          {formatFileSize(file.size)}
          {content?.truncated && " (truncated, read-only)"}
        </span>
        {model.isModified && (
          <>
            <Button
              primary
              label="Save"
              waiting={model.isSaving}
              disabled={model.isSaving}
              onClick={() => void model.save()}
            />
            <Button plain label="Discard" disabled={model.isSaving} onClick={() => model.discardChanges()} />
          </>
        )}
        <Icon material="download" tooltip="Download" onClick={() => void model.download(file.path)} />
        <Icon material="close" tooltip="Close" onClick={() => model.closeFile()} />
      </div>
      <div className={styles.editorBody}>{renderBody()}</div>
    </div>
  );
});
