/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Deployment, Ingress, Pod, Service, StatefulSet } from "@freelensapp/kube-object";
import React from "react";
import { DrawerItem } from "../../../../renderer/components/drawer";
import { kindLabel } from "../helpers/config";
import { DefaultTooltip } from "./default-tooltip";
import { DeploymentTooltip } from "./deployment-tooltip";
import { IngressTooltip } from "./ingress-tooltip";
import styles from "./map-tooltip.module.scss";
import { PodTooltip } from "./pod-tooltip";
import { ServiceTooltip } from "./service-tooltip";
import { StatefulsetTooltip } from "./stateful-set-tooltip";
import tooltipStyles from "./tooltip.module.scss";

import type { KubeObject } from "@freelensapp/kube-object";

export interface NodeTooltipProps {
  object: KubeObject;
}

/** The tooltip of the object of a node: the one of its kind, or the default one. */
export function NodeTooltip({ object }: NodeTooltipProps) {
  if (object instanceof Pod) {
    return <PodTooltip obj={object} />;
  }
  if (object instanceof Service) {
    return <ServiceTooltip obj={object} />;
  }
  if (object instanceof Deployment) {
    return <DeploymentTooltip obj={object} />;
  }
  if (object instanceof StatefulSet) {
    return <StatefulsetTooltip obj={object} />;
  }
  if (object instanceof Ingress) {
    return <IngressTooltip obj={object} />;
  }
  return <DefaultTooltip obj={object} />;
}

/** The objects folded into a card, by the label of their kind, in their order. */
function MapTooltipIncludes({ objects }: { objects: readonly KubeObject[] }) {
  const groups = new Map<string, string[]>();
  for (const object of objects) {
    const label = kindLabel(object.kind);
    groups.set(label, [...(groups.get(label) ?? []), object.getName()]);
  }
  return (
    <div className={tooltipStyles.tooltip} data-testid="resource-map-tooltip-includes">
      <hr />
      <div>
        <b>Includes</b>
      </div>
      {[...groups].map(([label, names]) => (
        <DrawerItem key={label} name={label}>
          {names.map((name) => (
            <div key={name}>{name}</div>
          ))}
        </DrawerItem>
      ))}
    </div>
  );
}

export interface MapTooltipProps {
  /** The object of the hovered node, if a node is hovered. */
  object?: KubeObject;
  /** The objects folded into the card of the object, which the tooltip lists under its content. */
  includes?: readonly KubeObject[];
}

/** A box of the container of a tooltip, in px from its top left corner. */
export interface AnchorRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

// The room between the tooltip and the pointer, and between the tooltip and the box it is anchored to.
const pointerOffset = 12;
const anchorGap = 8;

/**
 * The tooltip of the hovered node, in the map's own React tree, where the
 * application's components keep their context. The map renders it inside its
 * container, which is positioned, and either hands the container's mouse moves
 * to `follow`, which places it next to the pointer, or anchors it to the box of
 * the hovered node with `anchor`. Either way it is placed without a render, on
 * the side where it fits in the container: a tooltip past the edge would make
 * the content of a details drawer overflow, and its scrollbar would narrow the
 * map.
 */
export class MapTooltip extends React.Component<MapTooltipProps> {
  private readonly element = React.createRef<HTMLDivElement>();
  // The container and the point of the pointer in it, at its last move.
  private pointer?: { container: HTMLElement; x: number; y: number };
  // The container and the box in it that the tooltip is anchored to.
  private anchored?: { container: HTMLElement; rect: AnchorRect };

  follow = (event: React.MouseEvent<HTMLElement>) => {
    const container = event.currentTarget;
    const bounds = container.getBoundingClientRect();
    this.anchored = undefined;
    this.pointer = { container, x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    this.place();
  };

  /**
   * Anchors the tooltip to a box of the container: aligned with its left side
   * and below it, or above it when there is no room below, where it hides the
   * least of what leaves the box by its sides.
   */
  anchor(container: HTMLElement, rect: AnchorRect) {
    this.pointer = undefined;
    this.anchored = { container, rect };
    this.place();
  }

  // The graph reports the node under the pointer after the move that reached
  // it, so the tooltip shows its content, of another size, once it has been
  // placed: it is placed again for it.
  componentDidUpdate(prevProps: MapTooltipProps) {
    if (prevProps.object !== this.props.object || prevProps.includes !== this.props.includes) this.place();
  }

  private place() {
    const tooltip = this.element.current;
    if (!tooltip) return;
    if (this.anchored) {
      const { container, rect } = this.anchored;
      const below = rect.top + rect.height + anchorGap;
      const above = rect.top - anchorGap - tooltip.offsetHeight;
      const top = below + tooltip.offsetHeight <= container.clientHeight || above < 0 ? below : above;
      const left = Math.min(rect.left, container.clientWidth - tooltip.offsetWidth);
      tooltip.style.left = `${Math.max(0, left)}px`;
      tooltip.style.top = `${Math.max(0, Math.min(top, container.clientHeight - tooltip.offsetHeight))}px`;
    } else if (this.pointer) {
      const { container, x, y } = this.pointer;
      const offset = pointerOffset;
      const left =
        x + offset + tooltip.offsetWidth > container.clientWidth ? x - offset - tooltip.offsetWidth : x + offset;
      const top =
        y + offset + tooltip.offsetHeight > container.clientHeight ? y - offset - tooltip.offsetHeight : y + offset;
      tooltip.style.left = `${Math.max(0, left)}px`;
      tooltip.style.top = `${Math.max(0, top)}px`;
    }
  }

  render() {
    const { object, includes } = this.props;
    return (
      <div
        ref={this.element}
        className={styles.mapTooltip}
        data-testid="resource-map-tooltip"
        style={{ display: object ? "block" : "none" }}
      >
        {object ? <NodeTooltip object={object} /> : null}
        {object && includes?.length ? <MapTooltipIncludes objects={includes} /> : null}
      </div>
    );
  }
}
