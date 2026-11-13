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
