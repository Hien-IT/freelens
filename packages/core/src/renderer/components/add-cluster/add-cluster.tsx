/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Button } from "@freelensapp/button";
import { requestFromChannelInjectionToken } from "@freelensapp/messaging";
import { showErrorNotificationInjectable, showSuccessNotificationInjectable } from "@freelensapp/notifications";
import { isDefined, iter } from "@freelensapp/utilities";
import { withInjectables } from "@ogre-tools/injectable-react";
import { debounce } from "es-toolkit/compat";
import { action, computed, observable } from "mobx";
import { observer } from "mobx-react";
import React from "react";
import emitAppEventInjectable from "../../../common/app-event-bus/emit-event.injectable";
import navigateToCatalogInjectable from "../../../common/front-end-routing/routes/catalog/navigate-to-catalog.injectable";
import { addKubeconfigTextChannel, parseKubeconfigTextChannel } from "../../../features/add-cluster/common/channels";
import { SettingLayout } from "../layout/setting-layout";
import { MonacoEditor } from "../monaco-editor";
import styles from "./add-cluster.module.scss";

import type { RequestFromChannel } from "@freelensapp/messaging";
import type { ShowNotification } from "@freelensapp/notifications";

import type { EmitAppEvent } from "../../../common/app-event-bus/emit-event.injectable";
import type { NavigateToCatalog } from "../../../common/front-end-routing/routes/catalog/navigate-to-catalog.injectable";

interface Option {
  error?: string;
}

interface Dependencies {
  requestFromChannel: RequestFromChannel;
  navigateToCatalog: NavigateToCatalog;
  emitAppEvent: EmitAppEvent;
  showSuccessNotification: ShowNotification;
  showErrorNotification: ShowNotification;
}

@observer
class NonInjectedAddCluster extends React.Component<Dependencies> {
  @observable accessor kubeContexts = observable.map<string, Option>();
  @observable accessor customConfig = "";
  @observable accessor isWaiting = false;
  @observable accessor errors: string[] = [];
  // only the answer to the latest text is shown, whatever order the answers come back in
  private latestCheck = 0;

  constructor(props: Dependencies) {
    super(props);
  }

  componentDidMount() {
    this.props.emitAppEvent({ name: "cluster-add", action: "start" });
  }

  @computed get allErrors(): string[] {
    return [...this.errors, ...iter.map(this.kubeContexts.values(), ({ error }) => error)].filter(isDefined);
  }

  // main parses the text, which may hold credentials, and answers only names and errors
  readonly refreshContexts = debounce(async () => {
    const thisCheck = ++this.latestCheck;
    const { contexts, error } = await this.props.requestFromChannel(parseKubeconfigTextChannel, this.customConfig);

    if (thisCheck !== this.latestCheck) {
      return;
    }

    action(() => {
      this.kubeContexts.replace(contexts.map(({ name, error }) => [name, { error }]));

      if (error) {
        this.errors.push(error);
      }

      if (contexts.length === 0) {
        this.errors.push('No contexts defined, either missing the "contexts" field, or it is empty.');
      }
    })();
  }, 500);

  addClusters = action(async () => {
    this.isWaiting = true;
    this.props.emitAppEvent({ name: "cluster-add", action: "click" });

    try {
      await this.props.requestFromChannel(addKubeconfigTextChannel, this.customConfig);

      this.props.showSuccessNotification(`Successfully added ${this.kubeContexts.size} new cluster(s)`);

      return this.props.navigateToCatalog();
    } catch (error) {
      this.props.showErrorNotification(`Failed to add clusters: ${error}`);
    }
  });

  render() {
    return (
      <SettingLayout className={styles.AddClusters} data-testid="add-cluster-page">
        <h2>Add Clusters from Kubeconfig</h2>
        <p>
          {"Clusters added here are  "}
          <b>not</b>
          {" merged into the "}
          <code>~/.kube/config</code>
          {" file. "}
          <a
            href="https://kubernetes.io/docs/concepts/configuration/organize-cluster-access-kubeconfig/"
            rel="noreferrer"
            target="_blank"
          >
            Read more about adding clusters.
          </a>
        </p>
        <div className="flex flex-col">
          <MonacoEditor
            autoFocus
            className={styles.editor}
            value={this.customConfig}
            onChange={(value) => {
              this.customConfig = value;
              this.errors.length = 0;
              this.refreshContexts();
            }}
          />
        </div>
        {this.allErrors.length > 0 && (
          <>
            <h3>KubeConfig Yaml Validation Errors:</h3>
            {this.allErrors.map((error) => (
              <div key={error} className="error">
                {error}
              </div>
            ))}
          </>
        )}
        <div className="actions-panel">
          <Button
            primary
            disabled={this.kubeContexts.size === 0}
            label={this.kubeContexts.size === 1 ? "Add cluster" : "Add clusters"}
            onClick={this.addClusters}
            waiting={this.isWaiting}
            tooltip={this.kubeContexts.size === 0 || "Paste in at least one cluster to add."}
            tooltipOverrideDisabled
          />
        </div>
      </SettingLayout>
    );
  }
}

export const AddCluster = withInjectables<Dependencies>(NonInjectedAddCluster, {
  getProps: (di) => ({
    requestFromChannel: di.inject(requestFromChannelInjectionToken),
    navigateToCatalog: di.inject(navigateToCatalogInjectable),
    emitAppEvent: di.inject(emitAppEventInjectable),
    showSuccessNotification: di.inject(showSuccessNotificationInjectable),
    showErrorNotification: di.inject(showErrorNotificationInjectable),
  }),
});
