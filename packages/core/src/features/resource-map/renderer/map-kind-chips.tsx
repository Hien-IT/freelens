/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { cssNames } from "@freelensapp/utilities";
import { config, kindLabel } from "./helpers/config";
import styles from "./kube-resource-map.module.scss";

import type React from "react";

/** A kind of the map and how many of its cards the map has. */
export interface KindCount {
  kind: string;
  count: number;
}

// The kinds in the order of the columns of the map.
const kindOrder = [
  "Ingress",
  "Service",
  "Deployment",
  "StatefulSet",
  "DaemonSet",
  "Pod",
  "ConfigMap",
  "Secret",
  "PersistentVolumeClaim",
];
const rankOf = (kind: string) => {
  const rank = kindOrder.indexOf(kind);
  return rank < 0 ? kindOrder.length : rank;
};

/** The kinds of `items`, each with the number of its items, in the order of the columns of the map. */
export function kindCounts(items: readonly { kind: string }[]): KindCount[] {
  const counts = new Map<string, number>();
  for (const { kind } of items) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  return [...counts]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => rankOf(a.kind) - rankOf(b.kind) || a.kind.localeCompare(b.kind));
}

export interface MapKindChipsProps {
  kinds: readonly KindCount[];
  hidden: ReadonlySet<string>;
  onToggle(kind: string): void;
  onShowAll(): void;
  /** The cards without an edge, which a chip after the kinds hides or shows. */
  unlinked?: { count: number; shown: boolean; onToggle(): void };
  /**
   * The objects that the map folds into the card that uses them, Services, config and storage, which a chip
   * shows as cards of their own.
   */
  showEvery?: { count: number; shown: boolean; onToggle(): void };
}

/**
 * A chip for every kind of the map, with its icon, its name and the number of
 * its cards: the legend of the map, and its filter, as a click hides the kind
 * or shows it again.
 */
export function MapKindChips({ kinds, hidden, onToggle, onShowAll, unlinked, showEvery }: MapKindChipsProps) {
  return (
    <div className={styles.chips} role="group" aria-label="Kinds on the map">
      {kinds.map(({ kind, count }) => {
        const item = config[kind.toLowerCase()];
        const label = kindLabel(kind);
        const shown = !hidden.has(kind);
        const style = { "--kind-color": item?.color } as React.CSSProperties;
        return (
          <button
            key={kind}
            type="button"
            className={cssNames(styles.chip, { [styles.chipHidden]: !shown })}
            aria-pressed={shown}
            aria-label={`${label} (${count})`}
            title={shown ? `Hide the ${label} cards` : `Show the ${label} cards`}
            onClick={() => onToggle(kind)}
          >
            <span className={styles.chipIcon} style={style}>
              {item?.icon && <img src={item.icon} width={14} height={14} alt="" />}
            </span>
            <span className={styles.chipLabel}>{label}</span>
            <span className={styles.chipCount}>{count}</span>
          </button>
        );
      })}
      {unlinked && unlinked.count > 0 && (
        <button
          type="button"
          className={cssNames(styles.chip, styles.chipPlain, { [styles.chipHidden]: !unlinked.shown })}
          aria-pressed={unlinked.shown}
          aria-label={`Unlinked (${unlinked.count})`}
          title={unlinked.shown ? "Hide the cards without an edge" : "Show the cards without an edge"}
          onClick={unlinked.onToggle}
        >
          <span className={styles.chipLabel}>Unlinked</span>
          <span className={styles.chipCount}>· {unlinked.count}</span>
        </button>
      )}
      {showEvery && showEvery.count > 0 && (
        <button
          type="button"
          className={cssNames(styles.chip, styles.chipPlain, { [styles.chipActive]: showEvery.shown })}
          aria-pressed={showEvery.shown}
          aria-label={`Show every object (${showEvery.count})`}
          title={
            showEvery.shown
              ? "Fold the Services, config and storage that one card uses into that card"
              : "Show the Services, config and storage that one card uses as cards of their own"
          }
          onClick={showEvery.onToggle}
        >
          <span className={styles.chipLabel}>Show every object</span>
          <span className={styles.chipCount}>· {showEvery.count}</span>
        </button>
      )}
      {(kinds.some(({ kind }) => hidden.has(kind)) || unlinked?.shown === false) && (
        <button type="button" className={styles.linkButton} onClick={onShowAll}>
          Show all
        </button>
      )}
    </div>
  );
}

/** A Helm release of the map, as its chip shows it. */
export interface ReleaseChip {
  key: string;
  name: string;
  count: number;
  color: string;
}

export interface MapReleaseChipsProps {
  releases: readonly ReleaseChip[];
  /** The key of the release that the map focuses. */
  focused?: string;
  onFocus(key: string | undefined): void;
  /** Opens the focused release. */
  onOpen(): void;
}

/**
 * A chip for every Helm release of the map, in the colour of the stripe of its
 * cards: a click focuses the release, and a second one lets it go.
 */
export function MapReleaseChips({ releases, focused, onFocus, onOpen }: MapReleaseChipsProps) {
  if (!releases.length) return null;
  return (
    <div className={styles.chips} role="group" aria-label="Helm releases on the map">
      {releases.map(({ key, name, count, color }) => {
        const pressed = key === focused;
        return (
          <button
            key={key}
            type="button"
            className={cssNames(styles.chip, styles.chipPlain, { [styles.chipActive]: pressed })}
            aria-pressed={pressed}
            aria-label={`Helm release ${name} (${count})`}
            title={pressed ? `Stop focusing ${name}` : `Focus the cards of ${name}`}
            onClick={() => onFocus(pressed ? undefined : key)}
          >
            <span className={styles.releaseSwatch} style={{ background: color }} />
            <span className={styles.chipLabel}>⎈ {name}</span>
            <span className={styles.chipCount}>{count}</span>
          </button>
        );
      })}
      {focused && (
        <button type="button" className={styles.linkButton} onClick={onOpen}>
          Open release
        </button>
      )}
    </div>
  );
}
