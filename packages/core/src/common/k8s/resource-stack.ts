/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { hasTypedProperty, isObject } from "@freelensapp/utilities";
import hb from "handlebars";
import * as yaml from "js-yaml";
import { getDiForExtensionApi } from "../../extensions/extension-api-di";
import { defaultYamlDumpOptions } from "../kube-helpers/yaml-dump-options";
import productNameInjectable from "../vars/product-name.injectable";

import type { Logger } from "@freelensapp/logger";
import type { AsyncResult } from "@freelensapp/utilities";

import type { KubernetesCluster } from "../catalog-entities";
import type { KubectlApplyAll, KubectlDeleteAll } from "../kube-helpers/channels";
import type { ResourceFile } from "./read-resource-folder";

export interface ResourceApplyingStack {
  kubectlApplyFolder(folderPath: string, templateContext?: any, extraArgs?: string[]): Promise<string>;
  kubectlDeleteFolder(folderPath: string, templateContext?: any, extraArgs?: string[]): Promise<string>;
}

export interface ResourceStackDependencies {
  readonly logger: Logger;
  kubectlApplyAll: KubectlApplyAll;
  kubectlDeleteAll: KubectlDeleteAll;
  /** Main reads the folder; the renderer asks main for it. */
  readFolder: (folderPath: string) => Promise<ResourceFile[]>;
}

export class ResourceStack {
  constructor(
    protected readonly dependencies: ResourceStackDependencies,
    protected readonly cluster: KubernetesCluster,
    protected readonly name: string,
  ) {}

  /**
   *
   * @param folderPath folder path that is searched for files defining kubernetes resources.
   * @param templateContext sets the template parameters that are to be applied to any templated kubernetes resources that are to be applied.
   */
  async kubectlApplyFolder(folderPath: string, templateContext?: any, extraArgs?: string[]): Promise<string> {
    const resources = await this.renderTemplates(folderPath, templateContext);
    const result = await this.applyResources(resources, extraArgs);

    if (result.callWasSuccessful) {
      return result.response;
    }

    this.dependencies.logger.warn(`[RESOURCE-STACK]: failed to apply resources: ${result.error}`);

    throw new Error(result.error);
  }

  /**
   *
   * @param folderPath folder path that is searched for files defining kubernetes resources.
   * @param templateContext sets the template parameters that are to be applied to any templated kubernetes resources that are to be applied.
   */
  async kubectlDeleteFolder(folderPath: string, templateContext?: any, extraArgs?: string[]): Promise<string> {
    const resources = await this.renderTemplates(folderPath, templateContext);
    const result = await this.deleteResources(resources, extraArgs);

    if (result.callWasSuccessful) {
      return result.response;
    }

    this.dependencies.logger.warn(`[RESOURCE-STACK]: failed to delete resources: ${result.error}`);

    return "";
  }

  protected async applyResources(resources: string[], extraArgs: string[] = []): AsyncResult<string, string> {
    const kubectlArgs = [...extraArgs, ...this.getAdditionalArgs(extraArgs)];

    return this.dependencies.kubectlApplyAll({
      clusterId: this.cluster.getId(),
      resources,
      extraArgs: kubectlArgs,
    });
  }

  protected async deleteResources(resources: string[], extraArgs: string[] = []): AsyncResult<string, string> {
    const kubectlArgs = [...extraArgs, ...this.getAdditionalArgs(extraArgs)];

    return this.dependencies.kubectlDeleteAll({
      clusterId: this.cluster.getId(),
      resources,
      extraArgs: kubectlArgs,
    });
  }

  protected getAdditionalArgs(kubectlArgs: string[]): string[] {
    if (!kubectlArgs.includes("-l") && !kubectlArgs.includes("--label")) {
      return ["-l", `app.kubernetes.io/name=${this.name}`];
    }

    return [];
  }

  protected async renderTemplates(folderPath: string, templateContext: any): Promise<string[]> {
    const resources: string[] = [];
    const di = getDiForExtensionApi();
    const productName = di.inject(productNameInjectable);

    this.dependencies.logger.info(`[RESOURCE-STACK]: render templates from ${folderPath}`);
    for (const { name: filename, contents: raw } of await this.dependencies.readFolder(folderPath)) {
      const data = (filename.endsWith(".hb") ? hb.compile(raw)(templateContext) : raw).trim();

      if (!data) {
        continue;
      }

      for (const entry of yaml.loadAll(data)) {
        if (typeof entry !== "object" || !entry) {
          continue;
        }

        if (hasTypedProperty(entry, "metadata", isObject)) {
          const labels = (entry.metadata.labels ??= {}) as Partial<Record<string, string>>;

          labels["app.kubernetes.io/name"] = this.name;
          labels["app.kubernetes.io/managed-by"] = productName;
          labels["app.kubernetes.io/created-by"] = "resource-stack";
        }

        resources.push(yaml.dump(entry, defaultYamlDumpOptions));
      }
    }

    return resources;
  }
}
