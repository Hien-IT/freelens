/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { observable } from "mobx";
import { describe, expect, it } from "vitest";
import { fromEnvelope, toEnvelope } from "./wire";

class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}

  get length() {
    return Math.hypot(this.x, this.y);
  }
}

describe("wire", () => {
  describe("toEnvelope", () => {
    it("gives no payload for undefined", () => {
      expect(toEnvelope("some-channel", undefined)).toEqual({});
    });

    it.each([null, 0, "text", true, [1, "two", null], { a: { b: [1] } }])("carries %j as the payload", (value) => {
      expect(toEnvelope("some-channel", value)).toEqual({ payload: value });
    });

    it("lets an object property set to undefined through, which JSON drops", () => {
      expect(JSON.parse(JSON.stringify(toEnvelope("some-channel", { a: undefined, b: 1 })))).toEqual({
        payload: { b: 1 },
      });
    });

    it("lets a class instance through as its own enumerable properties", () => {
      expect(JSON.parse(JSON.stringify(toEnvelope("some-channel", new Point(3, 4))))).toEqual({
        payload: { x: 3, y: 4 },
      });
    });

    it("lets observable objects and arrays through as plain data", () => {
      const value = observable({ list: [1, 2], nested: { a: "b" } });

      expect(JSON.parse(JSON.stringify(toEnvelope("some-channel", value)))).toEqual({
        payload: { list: [1, 2], nested: { a: "b" } },
      });
    });

    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;

    it.each([
      ["a Date", new Date(0)],
      ["a RegExp", /a/],
      ["a Map", new Map([["a", 1]])],
      ["a Set", new Set([1])],
      ["an Error", new Error("boom")],
      ["an ArrayBuffer", new ArrayBuffer(2)],
      ["a typed array", new Uint8Array([1, 2])],
      ["a bigint", 1n],
      ["NaN", Number.NaN],
      ["an infinite number", Number.POSITIVE_INFINITY],
      ["undefined inside an array", [1, undefined]],
      ["an object with toJSON", { toJSON: () => "x" }],
      ["an observable map", observable.map({ a: 1 })],
      ["a cycle", cyclic],
      ["a function", () => {}],
      ["a function as a property", { run: () => {} }],
      ["a symbol", Symbol("s")],
      ["a nested Date", { when: [new Date(0)] }],
    ])("throws a TypeError naming the channel for %s", (_, value) => {
      expect(() => toEnvelope("some-channel", value)).toThrow(TypeError);
      expect(() => toEnvelope("some-channel", value)).toThrow(/"some-channel"/);
    });

    it("lets the same object appear twice without being a cycle", () => {
      const shared = { a: 1 };

      expect(toEnvelope("some-channel", [shared, shared])).toEqual({ payload: [shared, shared] });
    });
  });

  describe("fromEnvelope", () => {
    it("gives undefined for no payload", () => {
      expect(fromEnvelope({})).toBeUndefined();
    });

    it("gives null for a null payload", () => {
      expect(fromEnvelope({ payload: null })).toBeNull();
    });

    it("gives the payload", () => {
      expect(fromEnvelope({ payload: { a: 1 } })).toEqual({ a: 1 });
    });
  });
});
