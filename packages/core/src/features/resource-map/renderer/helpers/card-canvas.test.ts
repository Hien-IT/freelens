/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { describe, expect, it } from "vitest";
import { edgeStyle, fitTail, paintCard, podDotsThatFit } from "./card-canvas";

import type { KubeObject } from "@freelensapp/kube-object";

import type { CardPod, MapCard } from "./card-graph";

// Every character 6 px wide, the ellipsis too.
const measure = (text: string) => text.length * 6;
const fitted = (text: string, characters: number) => fitTail(measure, text, characters * 6);

describe("fitTail", () => {
  it("keeps a name that fits whole", () => {
    expect(fitted("terminal-backend-afc-terminal-cccd", 34)).toBe("terminal-backend-afc-terminal-cccd");
  });

  it("drops the leading words that do not fit, and keeps the longest run of the last ones", () => {
    expect(fitted("terminal-backend-afc-terminal-cccd", 22)).toBe("…afc-terminal-cccd");
    expect(fitted("terminal-backend-afc-terminal-cccd", 17)).toBe("…terminal-cccd");
    expect(fitted("payment-api-qr-shopeepay", 14)).toBe("…qr-shopeepay");
    expect(fitted("ingress.shop.example.com", 13)).toBe("…example.com");
  });

  it("cuts a last word that does not fit alone from its start", () => {
    expect(fitted("pos-backend-afc-order-cachewarmerdaemon", 10)).toBe("…merdaemon");
    expect(fitted("supercalifragilisticexpialidocious", 8)).toBe("…docious");
  });

  it("keeps the hash suffix of a pod, its last words", () => {
    expect(fitted("terminal-backend-afc-terminal-cccd-7d9c5b8f6d-x2x4p", 18)).toBe("…7d9c5b8f6d-x2x4p");
    expect(fitted("terminal-backend-afc-terminal-cccd-7d9c5b8f6d-x2x4p", 10)).toBe("…x2x4p");
  });
});

describe("edgeStyle", () => {
  it("fades an edge out of focus to a tenth, and stands out an edge in it", () => {
    expect(edgeStyle("dim", 10)).toEqual({ alpha: 0.1, width: 1.5 });
    expect(edgeStyle("highlight", 10)).toEqual({ alpha: 1, width: 2.5 });
  });
});

describe("podDotsThatFit", () => {
  const more = (count: number) => String(count).length * 6 + 6;

  it("gives every pod a dot, up to six, when the line has room", () => {
    expect(podDotsThatFit(3, 200, 18, more)).toBe(3);
    expect(podDotsThatFit(9, 200, 18, more)).toBe(6);
  });

  it("gives fewer dots on a short line, and none when not even one fits", () => {
    // 18 + 6 for 9/9, 12 + 4 for +8, 8 for one dot.
    expect(podDotsThatFit(9, 48, 18, more)).toBe(1);
    expect(podDotsThatFit(9, 30, 18, more)).toBe(0);
  });
});

describe("paintCard", () => {
  const colors = {
    background: "#1e2124",
    text: "#ffffff",
    secondaryText: "#a0a0a0",
    card: "#1f2123",
    border: "#4c5053",
    selected: "#00a7a0",
  };
  const pods = (count: number): CardPod[] =>
    Array.from({ length: count }, (_, index) => ({
      name: `web-${index}`,
      status: "running",
      color: "#4caf50",
      object: {} as CardPod["object"],
    }));
  const card = (kind: string, name: string, more: Partial<MapCard> = {}): MapCard => ({
    id: `${kind}/shop/${name}`,
    kind,
    name,
    namespace: "shop",
    object: {} as KubeObject,
    column: 2,
    pods: [],
    consumers: 0,
    linked: true,
    ...more,
  });

  // What a card paints: its texts, and the dots of its pods, the arcs of 3 px.
  function paint(painted: MapCard, held: MapCard[] = []) {
    const texts: string[] = [];
    let dots = 0;
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (target, key) => {
        if (key === "measureText") return (text: string) => ({ width: text.length * 6 });
        if (key === "fillText") return (text: string) => texts.push(text);
        if (key === "arc") return (_x: number, _y: number, r: number) => r === 3 && dots++;
        return key in target ? target[key as string] : () => {};
      },
      set: (target, key, value) => {
        target[key as string] = value;
        return true;
      },
    });
    paintCard(ctx as unknown as CanvasRenderingContext2D, painted, 0, 0, {
      emphasis: "normal",
      colors,
      fontFamily: "Roboto",
      showNamespace: false,
      held,
      fitted: new Map(),
      onIconError: () => {},
    });
    return { texts, dots };
  }

  it("writes the kind in full and how many objects the card holds, and gives way with the dots of its pods", () => {
    const held = [card("Service", "web"), card("ConfigMap", "web-config"), card("Secret", "web-secret")];

    const { texts, dots } = paint(card("Deployment", "web", { pods: pods(9) }), held);

    expect(texts).toEqual(["web", "Deployment · +3", "9/9", "+8"]);
    expect(dots).toBe(1);
  });

  it("writes a long kind in full, and leaves out the count of consumers that does not fit beside it", () => {
    const { texts } = paint(card("PersistentVolumeClaim", "data-db-0", { column: 3, consumers: 2 }));

    expect(texts).toEqual(["data-db-0", "Persistent Volume Claim"]);
  });
});
