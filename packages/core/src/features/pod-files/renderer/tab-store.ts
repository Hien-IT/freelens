/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { DockTabStore } from "../../../renderer/components/dock/dock-tab-store/dock-tab.store";

import type { DockTabStoreDependencies } from "../../../renderer/components/dock/dock-tab-store/dock-tab.store";

export interface PodFilesTabData {
  readonly namespace: string;
  readonly pod: string;
  readonly container: string;
  /** The running containers of the pod when the tab was opened. */
  readonly containers: string[];
  /** The directory shown, an absolute path ending with `/`. */
  readonly directory: string;
}

export class PodFilesTabStore extends DockTabStore<PodFilesTabData> {
  constructor(dependencies: DockTabStoreDependencies) {
    super(dependencies, { storageKey: "pod_files" });
  }
}
