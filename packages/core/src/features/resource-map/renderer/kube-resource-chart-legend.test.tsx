/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { KubeResourceChartLegend } from "./kube-resource-chart-legend";

afterEach(() => {
  cleanup();
});

describe("KubeResourceChartLegend", () => {
  it("names every kind for people, with none of the keys of the configuration", () => {
    const { container } = render(<KubeResourceChartLegend />);

    const names = [...container.querySelectorAll("span")].map((name) => name.textContent);
    expect(names).toEqual([
      "Deployment",
      "Daemon Set",
      "Stateful Set",
      "Service",
      "Secret",
      "Config Map",
      "Pod",
      "Ingress",
      "Helm Release",
      "Persistent Volume Claim",
    ]);
    expect(screen.queryByText("persistentvolumeclaim")).toBeNull();
    expect(screen.queryByText("helmrelease")).toBeNull();
  });

  it("shows the icon of every kind as an image that needs no request", () => {
    const { container } = render(<KubeResourceChartLegend />);

    const sources = [...container.querySelectorAll("img")].map((image) => image.getAttribute("src"));
    expect(sources).toHaveLength(10);
    sources.forEach((source) => expect(source).toMatch(/^data:image\/svg\+xml;charset=utf-8,%3Csvg/));
  });
});
