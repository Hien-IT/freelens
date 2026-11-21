/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { describe, expect, it, vi } from "vitest";
import {
  boxesOverlap,
  drawLabels,
  hexToRgba,
  hoverFocus,
  labelCandidates,
  linkColor,
  middleEllipsis,
  nodeEmphasis,
  noFocus,
  paintNode,
  placeLabels,
} from "./draw";

import type { ChartDataSeries, LinkObject } from "./types";

const node = (kind: string, name: string, more: Partial<ChartDataSeries> = {}) =>
  ({ id: `${kind}/shop/${name}`, kind, name, value: 20, color: "#80f58e", ...more }) as ChartDataSeries;

const colors = {
  background: "#1e2124",
  text: "#ffffff",
  secondaryText: "#a0a0a0",
  card: "#1f2123",
  border: "#4c5053",
  selected: "#00a7a0",
};

describe("middleEllipsis", () => {
  it("keeps a name of 28 characters or fewer whole", () => {
    expect(middleEllipsis("web-7d9c5b8f6d-x2x4p")).toBe("web-7d9c5b8f6d-x2x4p");
    expect(middleEllipsis("a".repeat(28))).toBe("a".repeat(28));
  });

  it("cuts the middle of a longer name, keeping its start and its end, to 28 characters", () => {
    const name = "storefront-checkout-worker-7d9c5b8f6d-x2x4p";

    const short = middleEllipsis(name);

    expect(short).toBe("storefront-che…c5b8f6d-x2x4p");
    expect(short).toHaveLength(28);
  });
});

describe("boxes of names", () => {
  const box = (left: number, top: number, width = 10, height = 10) => ({
    left,
    top,
    right: left + width,
    bottom: top + height,
  });

  it("overlap when they share an area, not when they only touch", () => {
    expect(boxesOverlap(box(0, 0), box(5, 5))).toBe(true);
    expect(boxesOverlap(box(0, 0), box(10, 0))).toBe(false);
    expect(boxesOverlap(box(0, 0), box(0, 10))).toBe(false);
    expect(boxesOverlap(box(0, 0), box(20, 20))).toBe(false);
  });

  it("are placed in their order, each unless it overlaps one placed before it", () => {
    const candidates = [
      { id: "a", box: box(0, 0) },
      { id: "b", box: box(5, 5) },
      { id: "c", box: box(12, 0) },
      { id: "d", box: box(8, 12) },
    ];

    expect(placeLabels(candidates).map(({ id }) => id)).toEqual(["a", "c", "d"]);
  });
});

describe("hexToRgba", () => {
  it("gives a colour of six or three digits an alpha", () => {
    expect(hexToRgba("#4caf50", 0.35)).toBe("rgba(76, 175, 80, 0.35)");
    expect(hexToRgba("#FFF", 1)).toBe("rgba(255, 255, 255, 1)");
  });

  it("leaves any other colour as it is", () => {
    expect(hexToRgba("rgb(1, 2, 3)", 0.5)).toBe("rgb(1, 2, 3)");
    expect(hexToRgba("#12345", 0.5)).toBe("#12345");
  });
});

describe("the names of the nodes", () => {
  const release = node("HelmRelease", "storefront");
  const deployment = node("Deployment", "web");
  const ingress = node("Ingress", "web");
  const service = node("Service", "web");
  const pod = node("Pod", "web-1");
  const secret = node("Secret", "credentials");
  const nodes = [secret, pod, service, ingress, deployment, release];
  const ids = (list: ChartDataSeries[]) => list.map(({ id }) => id);

  it("are placed by the rank of their nodes: Helm releases, workloads, Ingresses, Services, the rest", () => {
    expect(ids(labelCandidates(nodes, noFocus, 1))).toEqual(ids([release, deployment, ingress, service, pod, secret]));
  });

  it("put the hovered node first, then its neighbours, and none of the faded nodes", () => {
    const links: LinkObject[] = [
      { source: pod, target: service },
      { source: secret, target: pod },
    ];

    expect(ids(labelCandidates(nodes, hoverFocus(pod, links), 1))).toEqual(ids([pod, secret, service]));
  });

  it("are only those of the hovered node, its neighbours, the Helm releases and the workloads below a zoom of 0.75", () => {
    const links: LinkObject[] = [{ source: secret, target: release }];

    expect(ids(labelCandidates(nodes, noFocus, 0.5))).toEqual(ids([release, deployment]));
    expect(ids(labelCandidates(nodes, hoverFocus(secret, links), 0.5))).toEqual(ids([secret, release]));
  });

  it("are drawn at the same size on the screen at every zoom, on a halo, and none over another", () => {
    const near = node("Pod", "web-2", { x: 2, y: 0 });
    const far = node("Pod", "web-3", { x: 400, y: 0 });
    const drawn: { text: string; font: string }[] = [];
    const ctx = {
      font: "",
      save: vi.fn(),
      restore: vi.fn(),
      strokeText: vi.fn(),
      measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
      fillText(text: string) {
        drawn.push({ text, font: ctx.font });
      },
    };
    const widths = new Map<string, number>();
    const options = {
      nodes: [{ ...pod, x: 0, y: 0 }, near, far],
      focus: noFocus,
      colors,
      fontFamily: "Roboto",
      widths,
    };

    drawLabels(ctx as unknown as CanvasRenderingContext2D, 2, options);
    drawLabels(ctx as unknown as CanvasRenderingContext2D, 2, options);

    expect(drawn).toEqual([
      { text: "web-1", font: "5.5px Roboto" },
      { text: "web-3", font: "5.5px Roboto" },
      { text: "web-1", font: "5.5px Roboto" },
      { text: "web-3", font: "5.5px Roboto" },
    ]);
    expect(ctx.strokeText).toHaveBeenCalledTimes(4);
    // Every name is measured once.
    expect(ctx.measureText).toHaveBeenCalledTimes(3);
    expect(ctx.save).toHaveBeenCalledTimes(ctx.restore.mock.calls.length);
  });
});

describe("the focus of the map", () => {
  const pod = node("Pod", "web-1");
  const service = node("Service", "web");
  const secret = node("Secret", "credentials");
  const toService: LinkObject = { source: pod, target: service };
  const toSecret: LinkObject = { source: pod, target: secret };

  it("brings forward the hovered node, its neighbours and its links, and fades the rest", () => {
    const focus = hoverFocus(service, [toService, toSecret]);

    expect([pod, service, secret].map((each) => nodeEmphasis(each, focus))).toEqual(["highlight", "highlight", "dim"]);
    expect(linkColor(toService, focus)).toBe("rgba(128, 245, 142, 1)");
    expect(linkColor(toSecret, focus)).toBe("rgba(128, 245, 142, 0.08)");
  });

  it("fades nothing while no node is hovered", () => {
    expect(nodeEmphasis(pod, noFocus)).toBe("normal");
    expect(linkColor(toService, noFocus)).toBe("rgba(128, 245, 142, 0.35)");
  });
});

describe("paintNode", () => {
  function paint(emphasis: "normal" | "highlight" | "dim", ring = false) {
    const arcs: { r: number; alpha: number }[] = [];
    const ctx = {
      globalAlpha: 1,
      beginPath() {},
      closePath() {},
      fill() {},
      stroke() {},
      drawImage: vi.fn(() => {
        throw new Error("broken image");
      }),
      arc(_x: number, _y: number, r: number) {
        arcs.push({ r, alpha: ctx.globalAlpha });
      },
    };
    const onIconError = vi.fn();
    const image = {} as HTMLImageElement;

    paintNode(ctx as unknown as CanvasRenderingContext2D, node("Pod", "web-1", { image }), {
      emphasis,
      ring,
      colors,
      onIconError,
    });
    return { arcs, alpha: ctx.globalAlpha, onIconError };
  }

  it("fades a node behind the others, and gives the context its alpha back", () => {
    const { arcs, alpha } = paint("dim", true);

    expect(arcs.map((arc) => arc.alpha)).toEqual([0.15, 0.15]);
    expect(alpha).toBe(1);
  });

  it("draws a node that stands out larger, with a ring around it, and its circle last", () => {
    const normal = paint("normal").arcs;
    const raised = paint("highlight").arcs;

    expect(raised).toHaveLength(normal.length + 1);
    expect(raised.at(-1)?.r).toBeGreaterThan(normal.at(-1)?.r ?? Number.POSITIVE_INFINITY);
    expect(raised[0].r).toBeGreaterThan(raised.at(-1)?.r ?? Number.POSITIVE_INFINITY);
  });

  it("hands on an icon that cannot be drawn", () => {
    expect(paint("normal").onIconError).toHaveBeenCalledWith(new Error("broken image"));
  });
});
