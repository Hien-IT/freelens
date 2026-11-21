/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { kindCounts, MapKindChips, MapReleaseChips } from "./map-kind-chips";

afterEach(() => {
  cleanup();
});

const items = (...kinds: string[]) => kinds.map((kind) => ({ kind }));

describe("kindCounts", () => {
  it("counts the cards of every kind, in the order of the columns of the map, an unknown kind last", () => {
    expect(
      kindCounts(items("Secret", "Pod", "Custom", "Deployment", "Pod", "Ingress", "PersistentVolumeClaim")),
    ).toEqual([
      { kind: "Ingress", count: 1 },
      { kind: "Deployment", count: 1 },
      { kind: "Pod", count: 2 },
      { kind: "Secret", count: 1 },
      { kind: "PersistentVolumeClaim", count: 1 },
      { kind: "Custom", count: 1 },
    ]);
  });
});

describe("MapKindChips", () => {
  const kinds = kindCounts(items("Deployment", "Pod", "Pod", "StatefulSet", "PersistentVolumeClaim"));

  it("names every kind for people, with its count, and none of the keys of the configuration", () => {
    render(<MapKindChips kinds={kinds} hidden={new Set()} onToggle={vi.fn()} onShowAll={vi.fn()} />);

    const names = screen.getAllByRole("button").map((chip) => chip.getAttribute("aria-label"));
    expect(names).toEqual(["Deployment (1)", "Stateful Set (1)", "Pod (2)", "Persistent Volume Claim (1)"]);
    expect(screen.queryByText("persistentvolumeclaim")).toBeNull();
  });

  it("shows the icon of every kind as an image that needs no request", () => {
    const { container } = render(
      <MapKindChips kinds={kinds} hidden={new Set()} onToggle={vi.fn()} onShowAll={vi.fn()} />,
    );

    const sources = [...container.querySelectorAll("img")].map((image) => image.getAttribute("src"));
    expect(sources).toHaveLength(4);
    sources.forEach((source) => expect(source).toMatch(/^data:image\/svg\+xml;charset=utf-8,%3Csvg/));
  });

  it("keeps the chip of a hidden kind, not pressed, offers to show them all, and hands the clicks on", () => {
    const onToggle = vi.fn();
    const onShowAll = vi.fn();
    render(<MapKindChips kinds={kinds} hidden={new Set(["Pod"])} onToggle={onToggle} onShowAll={onShowAll} />);

    expect(screen.getByRole("button", { name: "Pod (2)" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Deployment (1)" }).getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Pod (2)" }));
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));

    expect(onToggle).toHaveBeenCalledWith("Pod");
    expect(onShowAll).toHaveBeenCalledTimes(1);
  });

  it("offers no Show all while no kind of the map is hidden", () => {
    render(<MapKindChips kinds={kinds} hidden={new Set(["Ingress"])} onToggle={vi.fn()} onShowAll={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "Show all" })).toBeNull();
  });

  it("toggles the cards without an edge with a chip of their own, which a Show all brings back", () => {
    const onToggle = vi.fn();
    render(
      <MapKindChips
        kinds={kinds}
        hidden={new Set()}
        onToggle={vi.fn()}
        onShowAll={vi.fn()}
        unlinked={{ count: 3, shown: false, onToggle }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Unlinked (3)" }));

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Unlinked (3)" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Show all" })).toBeDefined();
  });
});

describe("MapReleaseChips", () => {
  const releases = [
    { key: "shop/payments", name: "payments", count: 4, color: "#2563eb" },
    { key: "shop/storefront", name: "storefront", count: 9, color: "#16a34a" },
  ];

  it("shows a chip per release with its count, and nothing for a map without one", () => {
    const { container, rerender } = render(<MapReleaseChips releases={releases} onFocus={vi.fn()} onOpen={vi.fn()} />);

    expect(screen.getAllByRole("button").map((chip) => chip.getAttribute("aria-label"))).toEqual([
      "Helm release payments (4)",
      "Helm release storefront (9)",
    ]);

    rerender(<MapReleaseChips releases={[]} onFocus={vi.fn()} onOpen={vi.fn()} />);

    expect(container.textContent).toBe("");
  });

  it("focuses a release, lets it go on a second click, and opens the focused one", () => {
    const onFocus = vi.fn();
    const onOpen = vi.fn();
    render(<MapReleaseChips releases={releases} focused="shop/storefront" onFocus={onFocus} onOpen={onOpen} />);

    fireEvent.click(screen.getByRole("button", { name: "Helm release payments (4)" }));
    fireEvent.click(screen.getByRole("button", { name: "Helm release storefront (9)" }));
    fireEvent.click(screen.getByRole("button", { name: "Open release" }));

    expect(onFocus.mock.calls).toEqual([["shop/payments"], [undefined]]);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
