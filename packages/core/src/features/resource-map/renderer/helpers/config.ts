/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import cmSvg from "../assets/icons/cm.svg?raw";
import deploySvg from "../assets/icons/deploy.svg?raw";
import dsSvg from "../assets/icons/ds.svg?raw";
import helmSvg from "../assets/icons/helm.svg?raw";
import ingSvg from "../assets/icons/ing.svg?raw";
import podSvg from "../assets/icons/pod.svg?raw";
import pvcSvg from "../assets/icons/pvc.svg?raw";
import secretSvg from "../assets/icons/secret.svg?raw";
import stsSvg from "../assets/icons/sts.svg?raw";
import svcSvg from "../assets/icons/svc.svg?raw";

import type { Pod } from "@freelensapp/kube-object";

// An icon as a data URL, which an <img> and the canvas of the map load
// without a request, in the main frame and in the frame of a cluster alike.
const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

interface ConfigItem {
  /** The name of the kind, for people. */
  label: string;
  color?: string;
  icon?: string;
  size?: number;
  img?: HTMLImageElement;
}

type Config = Record<string, ConfigItem>;

export const config: Config = {
  deployment: {
    label: "Deployment",
    color: "#6771dc",
    icon: svgUrl(deploySvg),
    size: 25,
  },
  daemonset: {
    label: "Daemon Set",
    color: "#a367dc",
    icon: svgUrl(dsSvg),
    size: 25,
  },
  statefulset: {
    label: "Stateful Set",
    color: "#dc67ce",
    icon: svgUrl(stsSvg),
    size: 25,
  },
  service: {
    label: "Service",
    color: "#808af5",
    icon: svgUrl(svcSvg),
    size: 20,
  },
  secret: {
    label: "Secret",
    color: "#ff9933",
    icon: svgUrl(secretSvg),
    size: 20,
  },
  configmap: {
    label: "Config Map",
    color: "#ff9933",
    icon: svgUrl(cmSvg),
    size: 20,
  },
  pod: {
    label: "Pod",
    color: "#80f58e",
    icon: svgUrl(podSvg),
    size: 20,
  },
  ingress: {
    label: "Ingress",
    color: "#67dcbb",
    icon: svgUrl(ingSvg),
    size: 20,
  },
  helmrelease: {
    label: "Helm Release",
    color: "#0f1689",
    icon: svgUrl(helmSvg),
    size: 30,
  },
  persistentvolumeclaim: {
    label: "Persistent Volume Claim",
    color: "#cdff93",
    icon: svgUrl(pvcSvg),
    size: 20,
  },
};

/** The label of a kind for people, or the kind itself for one the maps have no configuration of. */
export const kindLabel = (kind: string) => config[kind.toLowerCase()]?.label ?? kind;

/** How a pod is doing, as the maps colour it. */
export type PodHealth = "running" | "pending" | "failed" | "done";

/** The colour and the legend label of every health of a pod, in the order of the legend. */
export const podHealthStyles: Record<PodHealth, { color: string; label: string }> = {
  running: { color: "#4caf50", label: "Running" },
  pending: { color: "#e6b422", label: "Pending / not ready" },
  failed: { color: "#ce3933", label: "Failed" },
  done: { color: "#9dabb5", label: "Completed / terminating" },
};

// A container waits to restart after crashing, as the private check of the Pod model tells it.
const isCrashLooping = (pod: Pod) =>
  pod.getContainerStatuses().some(({ state }) => state?.waiting?.reason === "CrashLoopBackOff");

/**
 * How a pod is doing, from its model: failed (phase Failed or Unknown,
 * evicted, or a container crash-looping), done (phase Succeeded, or being
 * deleted), pending (phase Pending, or running with containers not ready), or
 * running.
 */
export function podHealth(pod: Pod): PodHealth {
  const phase = pod.getStatusPhase();
  if (phase === "Failed" || phase === "Unknown" || pod.getReason() === "Evicted" || isCrashLooping(pod)) {
    return "failed";
  }
  if (phase === "Succeeded" || pod.metadata.deletionTimestamp) return "done";
  if (phase === "Pending" || pod.hasIssues()) return "pending";
  return "running";
}

/**
 * Loads the icon of every kind into an image, once, for the canvas of the
 * maps to draw.
 */
export function loadConfigImages() {
  Object.values(config).forEach((configItem) => {
    if (configItem.img) return;
    const img = new Image();
    img.src = configItem.icon ?? "";
    configItem.img = img;
  });
}
