/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NonInjectedResourceMapDetails,
  NonInjectedResourceMapPage,
  NonInjectedResourceMapWorkloadsOverviewItem,
} from "./resource-map-entry-points";
import { fakeLogger } from "./test-utils/fake-logger";
import { kubeObject } from "./test-utils/kube-objects";

import type { KubeObject } from "@freelensapp/kube-object";

import type { ResourceMapDependencies } from "./dependencies";

const maps = vi.hoisted(() => ({ broken: false }));

// The maps themselves need the stores and a canvas; the tests are about the boundaries around them.
vi.mock("./kube-resource-page", () => ({
  KubeResourcePage: () => {
    if (maps.broken) throw new Error("broken page");
    return <p>resource map page</p>;
  },
  KubeResourceOverviewDetail: () => {
    if (maps.broken) throw new Error("broken map");
    return <p>resource map</p>;
  },
}));

// A map of a details panel that throws for a broken object.
const chart = vi.hoisted(() => (name: string) => ({ object }: { object: KubeObject & { broken?: boolean } }) => {
  if (object.broken) throw new Error("broken object");
  return `${name} ${object.getName()}`;
});

vi.mock("./kube-controller-chart", () => ({ KubeControllerChart: chart("controller map of") }));
vi.mock("./kube-pod-chart", () => ({ KubePodChart: chart("pod map of") }));
vi.mock("./kube-service-chart", () => ({ KubeServiceChart: chart("service map of") }));
vi.mock("./kube-ingress-chart", () => ({ KubeIngressChart: chart("ingress map of") }));

let logger: ReturnType<typeof fakeLogger>;
let dependencies: ResourceMapDependencies;

beforeEach(() => {
  logger = fakeLogger();
  dependencies = { logger } as unknown as ResourceMapDependencies;
  // React reports an error that a boundary caught on the console as well.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  maps.broken = false;
  vi.restoreAllMocks();
});

const object = (kind: string, name: string, broken = false) =>
  Object.assign(kubeObject(kind, { name, namespace: "shop" }), { broken });

describe("the Resource Map in the Workloads Overview", () => {
  it("renders the map", () => {
    render(<NonInjectedResourceMapWorkloadsOverviewItem dependencies={dependencies} />);

    expect(screen.getByText("resource map")).toBeDefined();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("keeps an error of the map inside the item, logs it, and leaves the rest of the overview rendered", () => {
    maps.broken = true;

    render(
      <>
        <NonInjectedResourceMapWorkloadsOverviewItem dependencies={dependencies} />
        <p>workloads</p>
      </>,
    );

    expect(screen.getByText("Error: broken map")).toBeDefined();
    expect(screen.getByText("workloads")).toBeDefined();
    expect(logger.error).toHaveBeenCalledWith("[RESOURCE-MAP]: Error: broken map", expect.any(String));
  });
});

describe("the Resource Map page", () => {
  it("keeps an error of the page inside the page", () => {
    maps.broken = true;

    render(
      <>
        <NonInjectedResourceMapPage dependencies={dependencies} />
        <p>sidebar</p>
      </>,
    );

    expect(screen.getByText("Error: broken page")).toBeDefined();
    expect(screen.getByText("sidebar")).toBeDefined();
  });
});

describe("the Resource Map in a details panel", () => {
  it.each([
    ["Deployment", "controller map of web"],
    ["DaemonSet", "controller map of web"],
    ["StatefulSet", "controller map of web"],
    ["Pod", "pod map of web"],
    ["Service", "service map of web"],
    ["Ingress", "ingress map of web"],
  ])("draws the map of a %s", (kind, text) => {
    render(<NonInjectedResourceMapDetails object={object(kind, "web")} dependencies={dependencies} />);

    expect(screen.getByText(text)).toBeDefined();
  });

  it("draws nothing for a kind without a map", () => {
    const { container } = render(
      <NonInjectedResourceMapDetails object={object("ConfigMap", "web")} dependencies={dependencies} />,
    );

    expect(container.textContent).toBe("");
  });

  it("keeps an error of a map inside the panel, and renders it again for a new object", () => {
    const { rerender } = render(
      <>
        <NonInjectedResourceMapDetails object={object("Deployment", "web", true)} dependencies={dependencies} />
        <p>other panel</p>
      </>,
    );

    expect(screen.getByText("Error: broken object")).toBeDefined();
    expect(screen.getByText("other panel")).toBeDefined();

    rerender(
      <>
        <NonInjectedResourceMapDetails object={object("Deployment", "web")} dependencies={dependencies} />
        <p>other panel</p>
      </>,
    );

    expect(screen.getByText("controller map of web")).toBeDefined();
  });
});
