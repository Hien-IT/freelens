/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Icon } from "@freelensapp/icon";
import { cssNames } from "@freelensapp/utilities";
import { observer } from "mobx-react";
import { useState } from "react";
import { Checkbox } from "../../../renderer/components/checkbox";
import { minVolumeSteps, volumeUnitTitles } from "./filters";
import { formatVolume, namespaceColor } from "./graph";
import styles from "./traffic-map.module.scss";

import type { KeyboardEvent } from "react";

import type { L7Filter, VolumeUnit } from "./filters";
import type { TrafficMapModel } from "./traffic-map-model";

function toggle(values: readonly string[], value: string): string[] {
  return values.includes(value) ? values.filter((candidate) => candidate !== value) : [...values, value];
}

function Chips({
  values,
  selected,
  onToggle,
}: {
  values: readonly string[];
  selected: readonly string[];
  onToggle(value: string): void;
}) {
  return (
    <div className={styles.chips}>
      {values.map((value) => (
        <button
          key={value}
          type="button"
          className={cssNames(styles.chip, { [styles.chipActive]: selected.includes(value) })}
          aria-pressed={selected.includes(value)}
          onClick={() => onToggle(value)}
        >
          {value}
        </button>
      ))}
    </div>
  );
}

/** A step of the least volume in as few characters as the narrow panel needs: 10K, 100 MiB, 1K/s. */
function stepLabel(step: number, unit: VolumeUnit): string {
  return step === 0 ? "Any" : formatVolume(step, unit).replace(/\.0+(?=\D|$)/, "");
}

/** Enter and Space act on an element that is not a button but behaves as one. */
function onActivate(action: () => void) {
  return (event: KeyboardEvent) => {
    if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      action();
    }
  };
}

const shownNamespaces = 8;

/** The filters of the traffic map, and the search that focuses it on one node. */
export const TrafficFiltersPanel = observer(({ model }: { model: TrafficMapModel }) => {
  const { filters, facets, unit } = model;
  const [focusSearch, setFocusSearch] = useState("");
  const [allNamespaces, setAllNamespaces] = useState(false);
  const steps = minVolumeSteps[unit];
  const needle = focusSearch.trim().toLowerCase();
  const candidates = needle ? model.focusCandidates.filter((id) => id.toLowerCase().includes(needle)).slice(0, 20) : [];
  const namespaces = allNamespaces ? facets.namespaces : facets.namespaces.slice(0, shownNamespaces);
  const unfiltered = model.visibleFlows.length === (model.result?.aggregated.length ?? 0) && !filters.focus;

  return (
    <aside className={styles.filters}>
      <div className={styles.filtersTop}>
        <button type="button" className={styles.resetButton} disabled={unfiltered} onClick={() => model.resetFilters()}>
          Show all traffic
        </button>
      </div>

      <section className={styles.filterSection}>
        <h6 className={styles.sectionTitle}>Focus</h6>
        {filters.focus ? (
          <div className={styles.focusPill} title={filters.focus}>
            <span className={styles.focusId}>{filters.focus}</span>
            <Icon
              material="close"
              smallest
              className={styles.iconButton}
              tooltip="Clear the focus"
              aria-label="Clear the focus"
              onClick={() => model.focus(undefined)}
            />
          </div>
        ) : (
          <>
            <div className={styles.searchField}>
              <Icon material="search" smallest className={styles.searchIcon} />
              <input
                className={styles.searchInput}
                placeholder="Workload, service or address…"
                aria-label="Focus on a workload, service or address"
                value={focusSearch}
                onChange={(event) => setFocusSearch(event.target.value)}
              />
            </div>
            {candidates.length > 0 && (
              <div className={styles.focusCandidates}>
                {candidates.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={styles.focusCandidate}
                    title={id}
                    onClick={() => {
                      model.focus(id);
                      setFocusSearch("");
                    }}
                  >
                    {id}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <section className={styles.filterSection}>
        <h6 className={styles.sectionTitle}>Show</h6>
        <div className={styles.checks}>
          <Checkbox
            label="Hide system traffic"
            value={filters.hideSystem}
            onChange={(hideSystem) => model.updateFilters({ hideSystem })}
          />
          <Checkbox
            label="Hide traffic outside the cluster"
            value={filters.hideExternal}
            onChange={(hideExternal) => model.updateFilters({ hideExternal })}
          />
          <Checkbox
            label="Merge the Internet into one node"
            value={filters.collapseInternet}
            onChange={(collapseInternet) => model.updateFilters({ collapseInternet })}
          />
          <Checkbox
            label="Merge the cluster's nodes into one node"
            value={filters.collapseHosts}
            onChange={(collapseHosts) => model.updateFilters({ collapseHosts })}
          />
          <Checkbox
            label="Show pods instead of workloads"
            value={model.groupByPod}
            onChange={(value) => model.setGroupByPod(value)}
          />
        </div>
      </section>

      <section className={styles.filterSection}>
        <h6 className={styles.sectionTitle}>Minimum {volumeUnitTitles[unit].label.toLowerCase()}</h6>
        <div className={styles.segmented} role="group" aria-label={`Minimum ${volumeUnitTitles[unit].label}`}>
          {steps.map((step) => (
            <button
              key={step}
              type="button"
              className={cssNames(styles.segment, { [styles.segmentActive]: filters.minVolume === step })}
              title={step === 0 ? "Any" : formatVolume(step, unit)}
              aria-pressed={filters.minVolume === step}
              onClick={() => model.updateFilters({ minVolume: step })}
            >
              {stepLabel(step, unit)}
            </button>
          ))}
        </div>
      </section>

      {facets.hasL7 && (
        <section className={styles.filterSection}>
          <h6 className={styles.sectionTitle}>Protocol</h6>
          <Chips
            values={["all", "HTTP", "DNS", "TCP"]}
            selected={[filters.l7]}
            onToggle={(l7) => model.updateFilters({ l7: l7 as L7Filter })}
          />
        </section>
      )}

      {facets.statusClasses.length > 0 && (
        <section className={styles.filterSection}>
          <h6 className={styles.sectionTitle}>HTTP status</h6>
          <Chips
            values={facets.statusClasses}
            selected={filters.statusClasses}
            onToggle={(value) => model.updateFilters({ statusClasses: toggle(filters.statusClasses, value) })}
          />
        </section>
      )}

      {facets.verdicts.length > 0 && (
        <section className={styles.filterSection}>
          <h6 className={styles.sectionTitle}>Verdict</h6>
          <Chips
            values={facets.verdicts}
            selected={filters.verdicts}
            onToggle={(value) => model.updateFilters({ verdicts: toggle(filters.verdicts, value) })}
          />
        </section>
      )}

      {facets.namespaces.length > 0 && (
        <section className={styles.filterSection}>
          <h6 className={styles.sectionTitle}>Namespaces</h6>
          {namespaces.map((namespace) => {
            const hidden = filters.hiddenNamespaces.includes(namespace);
            const toggleNamespace = () =>
              model.updateFilters({ hiddenNamespaces: toggle(filters.hiddenNamespaces, namespace) });

            return (
              <div
                key={namespace}
                role="button"
                tabIndex={0}
                aria-pressed={!hidden}
                className={cssNames(styles.namespace, { [styles.namespaceHidden]: hidden })}
                onClick={toggleNamespace}
                onKeyDown={onActivate(toggleNamespace)}
              >
                <span className={styles.swatch} style={{ background: namespaceColor(namespace) }} />
                <span className={styles.namespaceName} title={namespace}>
                  {namespace}
                </span>
                <button
                  type="button"
                  className={styles.onlyButton}
                  title={`Show only ${namespace}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    model.onlyNamespace(namespace);
                  }}
                >
                  only
                </button>
              </div>
            );
          })}
          {facets.namespaces.length > shownNamespaces && (
            <button type="button" className={styles.linkButton} onClick={() => setAllNamespaces(!allNamespaces)}>
              {allNamespaces ? "Show fewer" : `+${facets.namespaces.length - shownNamespaces} more`}
            </button>
          )}
        </section>
      )}
    </aside>
  );
});
