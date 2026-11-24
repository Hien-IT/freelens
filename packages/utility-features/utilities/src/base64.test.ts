/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { base64 } from "./base64";

describe("base64", () => {
  it("encodes utf-8 to base64", () => {
    expect(base64.encode("hello world")).toBe("aGVsbG8gd29ybGQ=");
  });

  it("decodes base64 to utf-8", () => {
    expect(base64.decode("aGVsbG8gd29ybGQ=")).toBe("hello world");
  });

  it("round-trips multibyte utf-8 characters", () => {
    const value = "Grüße 😀 café";

    expect(base64.decode(base64.encode(value))).toBe(value);
  });

  it("encodes an empty string", () => {
    expect(base64.encode("")).toBe("");
    expect(base64.decode("")).toBe("");
  });

  it("throws when decoding input that is not valid base64-encoded utf-8", () => {
    // Callers (e.g. secret-key.tsx) rely on this to fall back to the raw value.
    expect(() => base64.decode("some-data-for-some-key")).toThrow();
  });

  it("throws when decoding input that Buffer.from would otherwise ignore", () => {
    expect(() => base64.decode("!!!!")).toThrow();
    expect(() => base64.decode("Zm9v$")).toThrow();
    expect(() => base64.decode("Zm9v=")).toThrow();
  });

  it("decodes valid unpadded base64", () => {
    expect(base64.decode("Zg")).toBe("f");
  });
});

describe("base64 compared with Buffer", () => {
  const texts = {
    ascii: "The quick brown fox jumps over the lazy dog",
    unicode: "héllo wörld ✓ 日本 😀",
    "a long text": "ab✓".repeat(50_000),
  };

  it.each(Object.entries(texts))("encodes %s as Buffer does", (_name, text) => {
    expect(base64.encode(text)).toBe(Buffer.from(text, "utf-8").toString("base64"));
  });

  it.each(Object.entries(texts))("decodes %s as Buffer does", (_name, text) => {
    const encoded = Buffer.from(text, "utf-8").toString("base64");

    expect(base64.decode(encoded)).toBe(Buffer.from(encoded, "base64").toString("utf-8"));
  });

  it("refuses bytes that are not utf-8, which Buffer would replace", () => {
    const binary = Buffer.from([0xff, 0xfe, 0x00, 0x80]).toString("base64");

    expect(() => base64.decode(binary)).toThrow();
  });

  it("refuses invalid input", () => {
    expect(() => base64.decode("a")).toThrow();
    expect(() => base64.decode("ab cd")).toThrow();
  });
});
