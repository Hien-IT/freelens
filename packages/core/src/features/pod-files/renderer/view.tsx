/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Icon } from "@freelensapp/icon";
import { cssNames } from "@freelensapp/utilities";
import { withInjectables } from "@ogre-tools/injectable-react";
import { observer } from "mobx-react";
import React, { useEffect, useRef } from "react";
import { SearchInput } from "../../../renderer/components/input";
import { Select } from "../../../renderer/components/select";
import { getBreadcrumbSegments } from "../common/paths";
import { PodFileEditor } from "./file-editor";
import { PodFileList } from "./file-list";
import styles from "./pod-files.module.scss";
import podFilesModelInjectable from "./pod-files-model.injectable";

import type { DockTab } from "../../../renderer/components/dock/dock/store";
import type { PodFilesModel } from "./pod-files-model";

export interface PodFilesDockTabProps {
  tab: DockTab;
}

interface Dependencies {
  model: PodFilesModel;
}

const Breadcrumb = observer(({ model }: Dependencies) => {
  const segments = getBreadcrumbSegments(model.directory);

  return (
    <div className={styles.breadcrumb} data-testid="pod-files-breadcrumb">
      <span
        className={cssNames(styles.breadcrumbSegment, { [styles.breadcrumbCurrent]: segments.length === 0 })}
        onClick={() => void model.navigate("/")}
      >
        /
      </span>
      {segments.map((segment, index) => (
        <React.Fragment key={segment.path}>
          {index > 0 && <span className={styles.breadcrumbSeparator}>/</span>}
          <span
            className={cssNames(styles.breadcrumbSegment, {
              [styles.breadcrumbCurrent]: index === segments.length - 1,
            })}
            onClick={() => void model.navigate(segment.path)}
          >
            {segment.name}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
});

const NonInjectedPodFilesDockTab = observer(({ tab, model }: PodFilesDockTabProps & Dependencies) => {
  const fileInput = useRef<HTMLInputElement>(null);
  const data = model.data;

  useEffect(() => {
    void model.refresh();
  }, [model]);

  if (!data) {
    return null;
  }

  return (
    <div className={styles.podFiles} data-testid={`pod-files-tab-${tab.id}`}>
      <div className={styles.toolbar}>
        {data.containers.length > 1 && (
          <Select
            id={`pod-files-container-${tab.id}`}
            className={styles.containerSelect}
            options={data.containers.map((name) => ({ value: name, label: name }))}
            value={data.container}
            isClearable={false}
            menuPlacement="bottom"
            onChange={(option) => option && void model.selectContainer(option.value)}
          />
        )}
        <Breadcrumb model={model} />
        <SearchInput
          className={styles.filter}
          placeholder="Filter files..."
          value={model.filter}
          onChange={(value) => model.setFilter(value)}
          onClear={() => model.setFilter("")}
          autoFocus={false}
          bindGlobalFocusHotkey={false}
        />
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);

            event.target.value = "";
            void model.upload(files);
          }}
        />
        <Icon
          material="upload"
          tooltip={`Upload to ${model.directory} (or drop files on the list)`}
          disabled={model.pendingUploads > 0}
          onClick={() => fileInput.current?.click()}
        />
        <Icon material="refresh" tooltip="Refresh" onClick={() => void model.refresh()} />
      </div>
      <div className={styles.body}>
        <PodFileList model={model} />
        <PodFileEditor model={model} tabId={tab.id} />
      </div>
    </div>
  );
});

export const PodFilesDockTab = withInjectables<Dependencies, PodFilesDockTabProps>(NonInjectedPodFilesDockTab, {
  getProps: (di, props) => ({
    ...props,
    model: di.inject(podFilesModelInjectable, props.tab.id),
  }),
});
