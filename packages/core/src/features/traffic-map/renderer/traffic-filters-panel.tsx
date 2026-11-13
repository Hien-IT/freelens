/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { cssNames } from "@freelensapp/utilities";
import { observer } from "mobx-react";
import { useState } from "react";
import { Checkbox } from "../../../renderer/components/checkbox";
import { minVolumeSteps } from "./filters";
import { formatVolume, namespaceColor } from "./graph";
import styles from "./traffic-map.module.scss";

import type { L7Filter } from "./filters";
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
          onClick={() => onToggle(value)}
        >
          {value}
        </button>
      ))}
    </div>
  );
}

const shownNamespaces = 8;

/** The filters of the traffic map, and the search that focuses it on one node. */
export const TrafficFiltersPanel = observer(({ model }: { model: TrafficMapModel }) => {
  const { filters, facets, rateBased } = model;
  const [focusSearch, setFocusSearch] = useState("");
  const [allNamespaces, setAllNamespaces] = useState(false);
  const steps = rateBased ? minVolumeSteps.rate : minVolumeSteps.connections;
  const needle = focusSearch.trim().toLowerCase();
  const candidates = needle ? model.focusCandidates.filter((id) => id.toLowerCase().includes(needle)).slice(0, 20) : [];
  const namespaces = allNamespaces ? facets.namespaces : facets.namespaces.slice(0, shownNamespaces);

  return (
    <aside className={styles.filters}>
      <section>
        <h6>Focus</h6>
        {filters.focus ? (
          <div className={styles.focus}>
            <span className={styles.ellipsis}>{filters.focus}</span>
            <button type="button" className={styles.chip} onClick={() => model.focus(undefined)}>
              Clear
            </button>
          </div>
        ) : (
          <>
            <input
              className={styles.search}
              placeholder="Workload, service or address…"
              value={focusSearch}
              onChange={(event) => setFocusSearch(event.target.value)}
            />
            {candidates.map((id) => (
              <div
                key={id}
                className={styles.candidate}
                onClick={() => {
                  model.focus(id);
                  setFocusSearch("");
                }}
              >
                {id}
              </div>
            ))}
          </>
        )}
      </section>

      <section>
        <h6>Show</h6>
        <Checkbox
          label="Hide system traffic"
          value={filters.hideSystem}
          onChange={(hideSystem) => model.updateFilters({ hideSystem })}
        />
        <Checkbox
          label="Hide outside the cluster"
          value={filters.hideExternal}
          onChange={(hideExternal) => model.updateFilters({ hideExternal })}
        />
        <Checkbox
          label="One Internet node"
          value={filters.collapseInternet}
          onChange={(collapseInternet) => model.updateFilters({ collapseInternet })}
        />
        <Checkbox
          label="Pods, not workloads"
          value={model.groupByPod}
          onChange={(value) => model.setGroupByPod(value)}
        />
      </section>

      <section>
        <h6>Least {rateBased ? "request rate" : "connections"}</h6>
        <Chips
          values={steps.map((step) => (step === 0 ? "Any" : formatVolume(step, rateBased)))}
          selected={[filters.minVolume === 0 ? "Any" : formatVolume(filters.minVolume, rateBased)]}
          onToggle={(label) =>
            model.updateFilters({
              minVolume: steps.find((step) => (step === 0 ? "Any" : formatVolume(step, rateBased)) === label) ?? 0,
            })
          }
        />
      </section>

      {facets.hasL7 && (
        <section>
          <h6>Protocol</h6>
          <Chips
            values={["all", "HTTP", "DNS", "TCP"]}
            selected={[filters.l7]}
            onToggle={(l7) => model.updateFilters({ l7: l7 as L7Filter })}
          />
        </section>
      )}

      {facets.statusClasses.length > 0 && (
        <section>
          <h6>HTTP status</h6>
          <Chips
            values={facets.statusClasses}
            selected={filters.statusClasses}
            onToggle={(value) => model.updateFilters({ statusClasses: toggle(filters.statusClasses, value) })}
          />
        </section>
      )}

      {facets.verdicts.length > 0 && (
        <section>
          <h6>Verdict</h6>
          <Chips
            values={facets.verdicts}
            selected={filters.verdicts}
            onToggle={(value) => model.updateFilters({ verdicts: toggle(filters.verdicts, value) })}
          />
        </section>
      )}

      {facets.namespaces.length > 0 && (
        <section>
          <h6>Namespaces</h6>
          {namespaces.map((namespace) => (
            <div
              key={namespace}
              className={cssNames(styles.namespace, {
                [styles.namespaceHidden]: filters.hiddenNamespaces.includes(namespace),
              })}
              onClick={() => model.updateFilters({ hiddenNamespaces: toggle(filters.hiddenNamespaces, namespace) })}
            >
              <span className={styles.swatch} style={{ background: namespaceColor(namespace) }} />
              <span className={styles.ellipsis}>{namespace}</span>
            </div>
          ))}
          {facets.namespaces.length > shownNamespaces && (
            <a onClick={() => setAllNamespaces(!allNamespaces)}>
              {allNamespaces ? "Show fewer" : `+${facets.namespaces.length - shownNamespaces} more`}
            </a>
          )}
        </section>
      )}

      <button type="button" className={styles.chip} onClick={() => model.resetFilters()}>
        Show all traffic
      </button>
    </aside>
  );
});
