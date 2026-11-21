/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Icon } from "@freelensapp/icon";
import { zoomStep } from "./helpers/graph-methods";
import styles from "./kube-resource-map.module.scss";

export interface MapZoomControlsProps {
  /** Zooms the graph by a factor, in or out. */
  zoomBy(factor: number): void;
  /** Fits the graph to its canvas. */
  fit(): void;
}

/** The zoom buttons of a map, at the bottom right of its canvas. */
export function MapZoomControls({ zoomBy, fit }: MapZoomControlsProps) {
  return (
    <div className={styles.zoomControls}>
      <Icon
        material="add"
        small
        className={styles.zoomButton}
        tooltip="Zoom in"
        role="button"
        aria-label="Zoom in"
        onClick={() => zoomBy(zoomStep)}
      />
      <Icon
        material="remove"
        small
        className={styles.zoomButton}
        tooltip="Zoom out"
        role="button"
        aria-label="Zoom out"
        onClick={() => zoomBy(1 / zoomStep)}
      />
      <Icon
        material="fit_screen"
        small
        className={styles.zoomButton}
        tooltip="Fit the map to the view"
        role="button"
        aria-label="Fit the map to the view"
        onClick={fit}
      />
    </div>
  );
}
